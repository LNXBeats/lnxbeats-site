import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";

import { createInternalAuthUser } from "@/lib/auth/internal-user";
import type { OrderActor } from "@/lib/orders/domain";
import { assertRightsSplit, rightsPaymentEnabled } from "@/lib/rights/domain";
import type { RightsDraftInput } from "@/lib/rights/input";
import { loadAndAssertRightsQaEnvironment } from "@/lib/rights/qa-guard";
import { cancelRightsRequest, confirmRightsCoordinates, createRightsDraft, deleteRightsDraft, type PreauthorizationDependencies } from "@/lib/rights/service";
import {
  acceptRightsContract,
  adminValidateRightsContract,
  requestRightsInformation,
  respondRightsInformation,
  saveRightsGrant,
  saveSplitProposal,
  startRightsReview,
  updateAiContributionAssessment,
} from "@/lib/rights/workflow";
import { prisma } from "@/lib/prisma";

const emails = ["lnx-v072-member@example.invalid", "lnx-v072-other@example.invalid", "lnx-v072-admin@example.invalid"] as const;

function actor(user: { id: string; email: string; displayName: string | null; role: "ADMIN" | "MEMBER" | "CUSTOMER" }): OrderActor {
  return { id: user.id, email: user.email, name: user.displayName ?? "QA", role: user.role, status: "ACTIVE", emailVerified: true };
}

async function cleanup() {
  await prisma.$transaction(async (transaction) => {
    await transaction.contractAcceptance.deleteMany();
    await transaction.contractDocument.deleteMany();
    await transaction.rightsSplitProposal.deleteMany();
    await transaction.rightsGrant.deleteMany();
    await transaction.rightsMessage.deleteMany();
    await transaction.rightsRequestEvent.deleteMany();
    await transaction.rightsContribution.deleteMany();
    await transaction.contractPartySnapshot.deleteMany();
    await transaction.rightsRequest.deleteMany();
    await transaction.orderNotification.deleteMany();
    await transaction.providerEvent.deleteMany();
    await transaction.payment.deleteMany();
    await transaction.orderAsset.deleteMany();
    await transaction.orderEvent.deleteMany();
    await transaction.commercialLicense.deleteMany();
    await transaction.order.deleteMany();
    await transaction.asset.deleteMany();
    await transaction.customer.deleteMany();
    await transaction.rateLimit.deleteMany();
    await transaction.session.deleteMany();
    await transaction.account.deleteMany();
    await transaction.user.deleteMany({ where: { email: { endsWith: "@example.invalid" } } });
  });
}

async function assertClean(stage: string) {
  const counts = await Promise.all([
    prisma.rightsRequest.count(), prisma.contractDocument.count(), prisma.contractAcceptance.count(), prisma.rightsGrant.count(), prisma.rightsSplitProposal.count(),
    prisma.order.count(), prisma.payment.count(), prisma.providerEvent.count(), prisma.orderNotification.count(), prisma.asset.count(),
    prisma.user.count({ where: { email: { endsWith: "@example.invalid" } } }), prisma.rateLimit.count(),
  ]);
  assert.ok(counts.every((count) => count === 0), `${stage}: disposable contract data remains.`);
}

function input(type: "PUBLICATION_LICENSE" | "EXPLOITATION_PARTNERSHIP"): RightsDraftInput {
  return {
    type,
    party: { partyType: "INDIVIDUAL", firstName: "Camille", lastName: "Test", artistName: "Camille QA", companyName: "", legalForm: "", legalRepresentative: "", streetAddress: "1 rue du Test", postalCode: "75001", city: "Paris", country: "FR", siret: "", vatNumber: "", contractEmail: emails[0], phone: "" },
    project: { workTitle: type === "PUBLICATION_LICENSE" ? "Licence QA" : "Partenariat QA", publicationName: "Projet QA", artistName: "Camille QA", distributor: "Distributeur fictif", platforms: ["SPOTIFY", "YOUTUBE"], otherPlatforms: "", targetDate: "2027-01-15", monetized: true, territory: "France", duration: "Deux ans", clips: "Clip envisagé", socialNetworks: "Réseaux organiques", advertising: false, contentId: false, modifications: "Aucune sans accord", credits: "LNX Beats" },
    contributions: [{ kind: "LYRICS_PARTIAL", description: "Quelques paroles fictives fournies pour la QA.", claimedPercentage: 20, evidenceNote: "Donnée fictive." }],
    partnership: type === "EXPLOITATION_PARTNERSHIP" ? { lyricsAuthor: "Camille Test", lyricsProvided: "Extraits fictifs", lyricRewrites: "Réécriture à étudier", lyricsClaimedPercentage: 20, melody: "", harmony: "", structure: "", arrangement: "", instrumental: "", compositionClaimedPercentage: null, artisticDirection: "Choix fictifs", voice: "Voix de référence fictive", mixMaster: "", instruments: "", production: "", toolsUsed: "Outils locaux et logiciel de musique", aiKnown: true, humanCreativeContribution: "Choix, réécriture et direction humaine à étudier au cas par cas", sacemMember: false, sacemIdentifier: "", otherCollective: "", relatedWorks: "", desiredSplit: "Souhait client non contraignant" } : null,
  };
}

const fakeStorage: PreauthorizationDependencies = {
  validateStorage: () => ({ backend: "OBJECT", provider: "r2" }),
  async write({ storageKey, checksumSha256 }) { return { storageKey, storageBackend: "OBJECT", storageProvider: "r2", visibility: "PRIVATE", checksumSha256 }; },
  async delete() {},
};

async function createDeliveredOrder(userId: string, email: string, sequence: number) {
  const orderId = randomUUID();
  const assetId = randomUUID();
  const now = new Date();
  const orderNumber = `LNX-2072-${String(sequence).padStart(6, "0")}`;
  await prisma.$transaction(async (transaction) => {
    await transaction.order.create({ data: { id: orderId, orderNumber, userId, customerEmail: email, customerName: "Camille Test", status: "DELIVERED", title: `Création QA ${sequence}`, brief: "Brief fictif exclusivement réservé à la base jetable V0.7.2.", usage: "PERSONAL", totalCents: 5_000, personalUseTermsVersion: "2026-08-personal-v1", personalUseTermsHashSha256: "1".repeat(64), personalUseTermsAcceptedAt: now, submittedAt: now, deliveredAt: now } });
    await transaction.payment.create({ data: { orderId, provider: "STRIPE", mode: "TEST", status: "SUCCEEDED", amountCents: 5_000, currency: "EUR", pricingVersion: "2026-08-v1", idempotencyKey: `v072-initial-payment-${sequence}`, providerCheckoutId: `cs_test_v072_${sequence}`, providerPaymentId: `pi_test_v072_${sequence}`, paymentMethod: "CARD", paidAt: now } });
    await transaction.asset.create({ data: { id: assetId, type: "AUDIO", storageKey: `qa-v072/delivery-${sequence}.wav`, storageBackend: "OBJECT", storageProvider: "r2", visibility: "PRIVATE", checksumSha256: "2".repeat(64), filename: `delivery-${sequence}.wav`, mimeType: "audio/wav", sizeBytes: 1_024n, rightsStatus: "RESTRICTED", confidence: "CONFIRMED" } });
    await transaction.orderAsset.create({ data: { orderId, assetId, role: "DELIVERY" } });
  });
  return { orderId, orderNumber };
}

async function createReadyContract(requestNumber: string, orderId: string) {
  const request = await prisma.rightsRequest.findUniqueOrThrow({ where: { requestNumber } });
  const template = await prisma.contractTemplate.findFirstOrThrow({ where: { type: request.type } });
  const asset = await prisma.asset.create({ data: { type: "DOCUMENT", storageKey: `qa-v072/contracts/${randomUUID()}.pdf`, storageBackend: "OBJECT", storageProvider: "r2", visibility: "PRIVATE", checksumSha256: "3".repeat(64), filename: `${requestNumber}-C01.pdf`, mimeType: "application/pdf", sizeBytes: 2_048n, rightsStatus: "RESTRICTED", confidence: "CONFIRMED" } });
  await prisma.orderAsset.create({ data: { orderId, assetId: asset.id, role: "CONTRACT", position: 1 } });
  const document = await prisma.contractDocument.create({ data: { contractNumber: `${requestNumber}-C01`, rightsRequestId: request.id, templateId: template.id, templateVersion: template.version, documentVersion: 1, kind: "CONTRACT", status: "READY_FOR_CLIENT", generatedAt: new Date(), priceSnapshotCents: request.requestedPriceCents, currency: "EUR", sourceSnapshot: { fixture: true, noPayment: true }, documentHashSha256: "3".repeat(64), assetId: asset.id } });
  await prisma.rightsRequest.update({ where: { id: request.id }, data: { status: "CONTRACT_READY" } });
  return { request, document };
}

async function run() {
  await loadAndAssertRightsQaEnvironment();
  await cleanup();
  await assertClean("precondition");
  const passed: string[] = [];
  const password = process.env.LNX_AUTH_QA_PASSWORD as string;
  try {
    const [memberUser, otherUser, adminUser] = await Promise.all([
      createInternalAuthUser({ email: emails[0], password, displayName: "Camille Test", role: "MEMBER" }),
      createInternalAuthUser({ email: emails[1], password, displayName: "Other Test", role: "MEMBER" }),
      createInternalAuthUser({ email: emails[2], password, displayName: "LNX Admin QA", role: "ADMIN" }),
    ]);
    const member = actor(memberUser); const other = actor(otherUser); const admin = actor(adminUser);
    const publicationOrder = await createDeliveredOrder(member.id, member.email, 1);
    const partnershipOrder = await createDeliveredOrder(member.id, member.email, 2);

    await assert.rejects(createRightsDraft(other, publicationOrder.orderNumber, input("PUBLICATION_LICENSE")), (error: unknown) => error instanceof Error && "code" in error && error.code === "ORDER_NOT_FOUND");
    assert.equal(await prisma.rightsRequest.count(), 0);
    passed.push("ownership and IDOR protection");

    const concurrent = await Promise.all(Array.from({ length: 8 }, () => createRightsDraft(member, publicationOrder.orderNumber, input("PUBLICATION_LICENSE"))));
    assert.equal(new Set(concurrent.map((item) => item.requestNumber)).size, 1);
    assert.equal(await prisma.rightsRequest.count({ where: { orderId: publicationOrder.orderId, type: "PUBLICATION_LICENSE" } }), 1);
    assert.equal(concurrent[0]?.requestedPriceCents, 15_000);
    passed.push("server price and concurrent draft idempotence");

    const partnership = await createRightsDraft(member, partnershipOrder.orderNumber, input("EXPLOITATION_PARTNERSHIP"));
    const partnershipRecord = await prisma.rightsRequest.findUniqueOrThrow({ where: { requestNumber: partnership.requestNumber }, select: { id: true } });
    assert.equal(partnership.requestedPriceCents, 150_000);
    const confirmed = await confirmRightsCoordinates(member, partnership.requestNumber, fakeStorage);
    assert.equal(confirmed.status, "PREAUTHORIZATION_GENERATED");
    assert.equal(confirmed.party?.confirmedAt !== null, true);
    assert.equal(confirmed.documents[0]?.kind, "PREAUTHORIZATION");
    passed.push("confirmed contact snapshot and private preauthorization");

    await startRightsReview(admin, partnership.requestNumber);
    await requestRightsInformation(admin, partnership.requestNumber, "Précisez la contribution humaine.", ["aiContribution", "composition"]);
    await requestRightsInformation(admin, partnership.requestNumber, "Précisez la contribution humaine.", ["aiContribution", "composition"]);
    assert.equal(await prisma.rightsMessage.count({ where: { rightsRequestId: partnershipRecord.id, kind: "ADMIN_REQUEST" } }), 1);
    assert.equal((await prisma.rightsRequest.findUniqueOrThrow({ where: { requestNumber: partnership.requestNumber } })).status, "INFORMATION_REQUIRED");
    await respondRightsInformation(member, partnership.requestNumber, "Réponse fictive documentant les choix créatifs humains.");
    await startRightsReview(admin, partnership.requestNumber);
    await updateAiContributionAssessment(admin, partnership.requestNumber, "HUMAN_CONTRIBUTION_DOCUMENTED");
    passed.push("information exchange, history and AI assessment");

    await saveRightsGrant(admin, partnership.requestNumber, { kind: "PUBLICATION", authorized: true, exclusive: false, destination: "Diffusion du projet validé", platforms: ["Spotify", "YouTube"], territory: "France", duration: "Deux ans", monetization: true, adaptation: false, advertising: false, audiovisualSync: false, contentId: false, sublicense: false, credit: "LNX Beats", restrictions: "Sous réserve du contrat final." });
    await saveRightsGrant(admin, partnership.requestNumber, { kind: "PUBLICATION", authorized: true, exclusive: false, destination: "Diffusion du projet validé", platforms: ["Spotify", "YouTube"], territory: "France", duration: "Deux ans", monetization: true, adaptation: false, advertising: false, audiovisualSync: false, contentId: false, sublicense: false, credit: "LNX Beats", restrictions: "Sous réserve du contrat final." });
    await assert.rejects(saveSplitProposal(admin, partnership.requestNumber, { clientSharePercent: 70, lnxSharePercent: 31, nature: "Test", comment: "", contributionRationale: "Test", proposedRoles: [] }));
    await saveSplitProposal(admin, partnership.requestNumber, { clientSharePercent: 70, lnxSharePercent: 30, nature: "Proposition commerciale QA", comment: "Non contraignante", contributionRationale: "Contributions fictives à revoir.", proposedRoles: ["auteur envisagé", "compositeur envisagé"] });
    await saveSplitProposal(admin, partnership.requestNumber, { clientSharePercent: 70, lnxSharePercent: 30, nature: "Proposition commerciale QA", comment: "Non contraignante", contributionRationale: "Contributions fictives à revoir.", proposedRoles: ["auteur envisagé", "compositeur envisagé"] });
    assert.equal(assertRightsSplit(70, 30), true);
    assert.equal(await prisma.rightsGrant.count({ where: { rightsRequestId: partnershipRecord.id, kind: "PUBLICATION" } }), 1);
    assert.equal(await prisma.rightsSplitProposal.count({ where: { rightsRequestId: partnershipRecord.id } }), 1);
    passed.push("structured grants and deliberate 70/30 proposal");

    const ready = await createReadyContract(partnership.requestNumber, partnershipOrder.orderId);
    await prisma.rightsRequestEvent.create({ data: { rightsRequestId: ready.request.id, type: "DOCUMENT_VIEWED", idempotencyKey: `rights:${ready.request.id}:document:${ready.document.id}:viewed:${member.id}`, actorUserId: member.id, note: "Consultation QA." } });
    const proof = { sessionReferenceHash: createHash("sha256").update("qa-session").digest("hex"), userAgentHash: createHash("sha256").update("qa-agent").digest("hex") };
    await assert.rejects(acceptRightsContract(member, partnership.requestNumber, { typedFullName: "Camille Test", password: "bad-password-value", accepted: true, ...proof }, fakeStorage));
    await acceptRightsContract(member, partnership.requestNumber, { typedFullName: "Camille Test", password, accepted: true, ...proof }, fakeStorage);
    await acceptRightsContract(member, partnership.requestNumber, { typedFullName: "Camille Test", password, accepted: true, ...proof }, fakeStorage);
    assert.equal(await prisma.contractAcceptance.count({ where: { contractDocumentId: ready.document.id, kind: "CLIENT" } }), 1);
    const acceptanceReceipts = await prisma.contractDocument.findMany({ where: { rightsRequestId: ready.request.id, kind: "ACCEPTANCE_RECEIPT" }, include: { asset: true } });
    assert.equal(acceptanceReceipts.length, 1);
    assert.equal(acceptanceReceipts[0]?.asset.visibility, "PRIVATE");
    assert.equal(acceptanceReceipts[0]?.asset.storageProvider, "r2");
    await adminValidateRightsContract(admin, partnership.requestNumber, "LNX Admin QA", true);
    const finalRequest = await prisma.rightsRequest.findUniqueOrThrow({ where: { requestNumber: partnership.requestNumber } });
    assert.equal(finalRequest.status, "READY_FOR_PAYMENT");
    assert.equal(rightsPaymentEnabled(), false);
    assert.equal(await prisma.payment.count({ where: { orderId: partnershipOrder.orderId } }), 1);
    await assert.rejects(prisma.rightsRequest.update({ where: { id: finalRequest.id }, data: { status: "ACTIVE" } }));
    await assert.rejects(prisma.contractDocument.delete({ where: { id: ready.document.id } }));
    passed.push("reauthenticated idempotent double acceptance and no activation/payment");

    await deleteRightsDraft(member, concurrent[0]!.requestNumber);
    assert.equal(await prisma.rightsRequest.count({ where: { orderId: publicationOrder.orderId } }), 0);
    const cancellableOrder = await createDeliveredOrder(member.id, member.email, 3);
    const cancellableRequest = await createRightsDraft(member, cancellableOrder.orderNumber, input("PUBLICATION_LICENSE"));
    await confirmRightsCoordinates(member, cancellableRequest.requestNumber, fakeStorage);
    await cancelRightsRequest(member, cancellableRequest.requestNumber);
    await cancelRightsRequest(member, cancellableRequest.requestNumber);
    const cancelled = await prisma.rightsRequest.findUniqueOrThrow({ where: { requestNumber: cancellableRequest.requestNumber } });
    assert.equal(cancelled.status, "CANCELLED");
    assert.equal(await prisma.rightsRequestEvent.count({ where: { rightsRequestId: cancelled.id, type: "REQUEST_CANCELLED" } }), 1);
    passed.push("bounded draft deletion and idempotent submitted cancellation");

    const notifications = await prisma.orderNotification.findMany({ where: { orderId: partnershipOrder.orderId } });
    assert.equal(new Set(notifications.map((item) => item.idempotencyKey)).size, notifications.length);
    assert.ok(notifications.every((item) => item.status === "PENDING"));
    passed.push("captured notification outbox idempotence");

    const templates = await prisma.contractTemplate.findMany();
    assert.equal(templates.length, 3);
    assert.ok(templates.every((item) => item.status === "DRAFT"));
    await assert.rejects(prisma.contractTemplate.update({ where: { id: templates[0]!.id }, data: { status: "APPROVED", approvedByAdminId: member.id, approvedAt: new Date(), legalReviewReference: "QA—not a legal review" } }));
    passed.push("legal template gate and draft-only QA");

    console.info(`V0.7.2 contracts runtime passed (${passed.length} groups):`);
    for (const label of passed) console.info(`- ${label}`);
  } finally {
    await cleanup();
    await assertClean("postcondition");
  }
}

run().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Contracts runtime failed."); process.exitCode = 1; }).finally(() => prisma.$disconnect());
