import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";

import { createInternalAuthUser } from "@/lib/auth/internal-user";
import type { OrderActor } from "@/lib/orders/domain";
import { deletePrivateOrderFile, readPrivateOrderFile, statPrivateOrderFile } from "@/lib/orders/storage";
import { handleAdminRightsDocumentGeneration } from "@/lib/rights/admin-generation-entrypoint";
import { assertRightsSplit, rightsPaymentEnabled } from "@/lib/rights/domain";
import type { RightsDraftInput } from "@/lib/rights/input";
import { loadAndAssertRightsQaEnvironment } from "@/lib/rights/qa-guard";
import { cancelRightsRequest, confirmRightsCoordinates, createRightsDraft, deleteRightsDraft, generatePartnershipPreauthorizationRevision, type PreauthorizationDependencies } from "@/lib/rights/service";
import {
  acceptRightsContract,
  adminValidateRightsContract,
  generateRightsDocument,
  requestRightsInformation,
  respondRightsInformation,
  saveRightsGrant,
  saveSplitProposal,
  startRightsReview,
  updateAiContributionAssessment,
} from "@/lib/rights/workflow";
import { prisma } from "@/lib/prisma";

const emails = ["lnx-v072-member@example.invalid", "lnx-v072-other@example.invalid", "lnx-v072-admin@example.invalid"] as const;
const runtimeOrderNumbers = ["LNX-2072-000001", "LNX-2072-000002", "LNX-2072-000003", "LNX-2072-000004"] as const;

class EntryPointRedirect extends Error {
  constructor(readonly location: string) {
    super(`Redirect: ${location}`);
  }
}

function generationForm(requestNumber: string, expectedDocumentVersion: number) {
  const form = new FormData();
  form.set("requestNumber", requestNumber);
  form.set("kind", "CONTRACT");
  form.set("expectedDocumentVersion", String(expectedDocumentVersion));
  return form;
}

function actor(user: { id: string; email: string; displayName: string | null; role: "ADMIN" | "MEMBER" | "CUSTOMER" }): OrderActor {
  return { id: user.id, email: user.email, name: user.displayName ?? "QA", role: user.role, status: "ACTIVE", emailVerified: true };
}

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { in: [...emails] } }, select: { id: true } });
  const userIds = users.map(({ id }) => id);
  const orders = await prisma.order.findMany({ where: { orderNumber: { in: [...runtimeOrderNumbers] } }, select: { id: true } });
  const orderIds = orders.map(({ id }) => id);
  const requests = await prisma.rightsRequest.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } });
  const requestIds = requests.map(({ id }) => id);
  const documents = await prisma.contractDocument.findMany({
    where: { rightsRequestId: { in: requestIds } },
    select: {
      assetId: true,
      request: { select: { orderId: true } },
      asset: { select: { storageKey: true, storageBackend: true, storageProvider: true, visibility: true } },
    },
  });
  const orderAssets = await prisma.orderAsset.findMany({ where: { orderId: { in: orderIds } }, select: { assetId: true } });
  const assetIds = [...new Set([...documents.map(({ assetId }) => assetId), ...orderAssets.map(({ assetId }) => assetId)])];
  for (const document of documents) {
    if (!document.asset.storageKey.startsWith(`orders/${document.request.orderId}/documents/`)) continue;
    await deletePrivateOrderFile(document.asset);
  }
  await prisma.$transaction(async (transaction) => {
    await transaction.contractAcceptance.deleteMany({ where: { rightsRequestId: { in: requestIds } } });
    await transaction.contractDocument.deleteMany({ where: { rightsRequestId: { in: requestIds } } });
    await transaction.rightsSplitProposal.deleteMany({ where: { rightsRequestId: { in: requestIds } } });
    await transaction.rightsGrant.deleteMany({ where: { rightsRequestId: { in: requestIds } } });
    await transaction.rightsMessage.deleteMany({ where: { rightsRequestId: { in: requestIds } } });
    await transaction.rightsRequestEvent.deleteMany({ where: { rightsRequestId: { in: requestIds } } });
    await transaction.rightsContribution.deleteMany({ where: { rightsRequestId: { in: requestIds } } });
    await transaction.contractPartySnapshot.deleteMany({ where: { rightsRequestId: { in: requestIds } } });
    await transaction.rightsRequest.deleteMany({ where: { id: { in: requestIds } } });
    await transaction.orderNotification.deleteMany({ where: { orderId: { in: orderIds } } });
    await transaction.providerEvent.deleteMany({ where: { payment: { orderId: { in: orderIds } } } });
    await transaction.payment.deleteMany({ where: { orderId: { in: orderIds } } });
    await transaction.orderAsset.deleteMany({ where: { orderId: { in: orderIds } } });
    await transaction.orderEvent.deleteMany({ where: { orderId: { in: orderIds } } });
    await transaction.commercialLicense.deleteMany({ where: { orderId: { in: orderIds } } });
    await transaction.order.deleteMany({ where: { id: { in: orderIds } } });
    await transaction.asset.deleteMany({ where: { id: { in: assetIds } } });
    await transaction.rateLimit.deleteMany({ where: { key: { in: userIds.flatMap((id) => [`rights:${id}`, `orders:${id}`]) } } });
    await transaction.session.deleteMany({ where: { userId: { in: userIds } } });
    await transaction.account.deleteMany({ where: { userId: { in: userIds } } });
    await transaction.user.deleteMany({ where: { id: { in: userIds } } });
  });
}

async function assertClean(stage: string) {
  const users = await prisma.user.findMany({ where: { email: { in: [...emails] } }, select: { id: true } });
  const userIds = users.map(({ id }) => id);
  const orders = await prisma.order.findMany({ where: { orderNumber: { in: [...runtimeOrderNumbers] } }, select: { id: true } });
  const orderIds = orders.map(({ id }) => id);
  const counts = [
    await prisma.rightsRequest.count({ where: { orderId: { in: orderIds } } }),
    await prisma.contractDocument.count({ where: { request: { orderId: { in: orderIds } } } }),
    await prisma.contractAcceptance.count({ where: { orderId: { in: orderIds } } }),
    await prisma.rightsGrant.count({ where: { request: { orderId: { in: orderIds } } } }),
    await prisma.rightsSplitProposal.count({ where: { request: { orderId: { in: orderIds } } } }),
    await prisma.order.count({ where: { id: { in: orderIds } } }),
    await prisma.payment.count({ where: { orderId: { in: orderIds } } }),
    await prisma.providerEvent.count({ where: { payment: { orderId: { in: orderIds } } } }),
    await prisma.orderNotification.count({ where: { orderId: { in: orderIds } } }),
    await prisma.user.count({ where: { id: { in: userIds } } }),
    await prisma.rateLimit.count({ where: { key: { in: userIds.flatMap((id) => [`rights:${id}`, `orders:${id}`]) } } }),
  ];
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

function safariHumanRegressionInput(): RightsDraftInput {
  const base = input("EXPLOITATION_PARTNERSHIP");
  return {
    ...base,
    party: { ...base.party, firstName: "Camille", lastName: "Navigateur", artistName: "Camille Navigateur" },
    project: {
      ...base.project,
      workTitle: "Élégie d’été",
      publicationName: "Élégie d’été",
      artistName: "Camille Navigateur",
      distributor: "distrokid",
      platforms: ["SPOTIFY", "APPLE_MUSIC", "DEEZER"],
      territory: "France",
      duration: "À définir avec LNX Beats",
      credits: "LNX Beats — création musicale",
    },
    contributions: [{
      kind: "STORY_BRIEF_ONLY",
      description: "Le client a fourni l’histoire de départ, le thème et les intentions générales du projet.",
      claimedPercentage: null,
      evidenceNote: "Déclaration à vérifier, sans reconnaissance juridique automatique.",
    }],
    partnership: {
      ...base.partnership!,
      lyricsAuthor: "LNX Beats",
      lyricsProvided: "Le client a fourni l’histoire, le thème et les intentions générales, mais pas les paroles finales.",
      lyricRewrites: "",
      toolsUsed: "Échanges avec LNX Beats pour définir le brief, le thème et les intentions du projet.",
      aiKnown: false,
      humanCreativeContribution: "Le client a imaginé l’histoire de départ, le sujet et les intentions générales. LNX Beats a réalisé la création musicale et la mise en forme artistique finale.",
      desiredSplit: "Répartition éventuelle à étudier selon les contributions créatives réellement reconnues.",
    },
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

async function run() {
  await loadAndAssertRightsQaEnvironment();
  await cleanup();
  await assertClean("precondition");
  const passed: string[] = [];
  const password = process.env.LNX_AUTH_QA_PASSWORD as string;
  try {
    const memberUser = await createInternalAuthUser({ email: emails[0], password, displayName: "Camille Test", role: "MEMBER" });
    const otherUser = await createInternalAuthUser({ email: emails[1], password, displayName: "Other Test", role: "MEMBER" });
    const adminUser = await createInternalAuthUser({ email: emails[2], password, displayName: "LNX Admin QA", role: "ADMIN" });
    const member = actor(memberUser); const other = actor(otherUser); const admin = actor(adminUser);
    const publicationOrder = await createDeliveredOrder(member.id, member.email, 1);
    const partnershipOrder = await createDeliveredOrder(member.id, member.email, 2);
    const generationOrder = await createDeliveredOrder(member.id, member.email, 3);

    await assert.rejects(createRightsDraft(other, publicationOrder.orderNumber, input("PUBLICATION_LICENSE")), (error: unknown) => error instanceof Error && "code" in error && error.code === "ORDER_NOT_FOUND");
    assert.equal(await prisma.rightsRequest.count({ where: { orderId: publicationOrder.orderId } }), 0);
    passed.push("ownership and IDOR protection");

    const firstDraft = await createRightsDraft(member, publicationOrder.orderNumber, input("PUBLICATION_LICENSE"));
    const retriedDraft = await createRightsDraft(member, publicationOrder.orderNumber, input("PUBLICATION_LICENSE"));
    const concurrent = [firstDraft, retriedDraft];
    assert.equal(new Set(concurrent.map((item) => item.requestNumber)).size, 1);
    assert.equal(await prisma.rightsRequest.count({ where: { orderId: publicationOrder.orderId, type: "PUBLICATION_LICENSE" } }), 1);
    assert.equal(concurrent[0]?.requestedPriceCents, 15_000);
    passed.push("server price and draft retry idempotence");

    const partnership = await createRightsDraft(member, partnershipOrder.orderNumber, input("EXPLOITATION_PARTNERSHIP"));
    const partnershipRecord = await prisma.rightsRequest.findUniqueOrThrow({ where: { requestNumber: partnership.requestNumber }, select: { id: true } });
    assert.equal(partnership.requestedPriceCents, 150_000);
    const storedKeys = new Set<string>();
    const deletedKeys = new Set<string>();
    const delayedStorage: PreauthorizationDependencies = {
      validateStorage: fakeStorage.validateStorage,
      async write(input) {
        assert.match(input.storageKey, /^orders\/[0-9a-f-]{36}\/documents\/[0-9a-f-]{36}\.pdf$/i);
        assert.ok(input.bytes.length > 1_000);
        await new Promise((resolve) => setTimeout(resolve, 25));
        storedKeys.add(input.storageKey);
        return { storageKey: input.storageKey, storageBackend: "OBJECT", storageProvider: "r2", visibility: "PRIVATE", checksumSha256: input.checksumSha256 };
      },
      async delete(input) { deletedKeys.add(input.storageKey); },
    };
    const confirmations = await Promise.all(Array.from({ length: 4 }, () => confirmRightsCoordinates(member, partnership.requestNumber, delayedStorage)));
    const confirmed = confirmations[0]!;
    assert.ok(confirmations.every((item) => item.status === "PREAUTHORIZATION_GENERATED"));
    assert.equal(confirmed.party?.confirmedAt !== null, true);
    assert.equal(confirmed.documents[0]?.kind, "PREAUTHORIZATION");
    assert.equal(await prisma.contractDocument.count({ where: { rightsRequestId: partnershipRecord.id, kind: "PREAUTHORIZATION" } }), 1);
    assert.equal(await prisma.rightsRequestEvent.count({ where: { rightsRequestId: partnershipRecord.id, type: "PREAUTHORIZATION_GENERATED" } }), 1);
    assert.equal(await prisma.orderNotification.count({ where: { orderId: partnershipOrder.orderId, kind: "CUSTOMER_RIGHTS_PREAUTHORIZATION_READY" } }), 1);
    assert.equal(await prisma.orderAsset.count({ where: { orderId: partnershipOrder.orderId, role: "CONTRACT" } }), 1);
    assert.equal(storedKeys.size, 1);
    assert.equal(deletedKeys.size, 0);
    const retried = await confirmRightsCoordinates(member, partnership.requestNumber, delayedStorage);
    assert.equal(retried.status, "PREAUTHORIZATION_GENERATED");
    assert.equal(storedKeys.size, 1);
    passed.push("concurrent confirmation, idempotent retry and private preauthorization");

    const immutableP01 = await prisma.contractDocument.findFirstOrThrow({
      where: { rightsRequestId: partnershipRecord.id, kind: "PREAUTHORIZATION", documentVersion: 1 },
      select: {
        id: true,
        contractNumber: true,
        templateId: true,
        templateVersion: true,
        documentVersion: true,
        kind: true,
        status: true,
        generatedAt: true,
        priceSnapshotCents: true,
        currency: true,
        sourceSnapshot: true,
        documentHashSha256: true,
        assetId: true,
        supersedesDocumentId: true,
        createdAt: true,
      },
    });
    const revisions = await Promise.all(Array.from({ length: 4 }, () => generatePartnershipPreauthorizationRevision(member, partnership.requestNumber, delayedStorage)));
    assert.ok(revisions.every((item) => item.documents.some((document) => document.contractNumber === `${partnership.requestNumber}-P02`)));
    const partnershipDocuments = await prisma.contractDocument.findMany({
      where: { rightsRequestId: partnershipRecord.id, kind: "PREAUTHORIZATION" },
      orderBy: { documentVersion: "asc" },
    });
    assert.deepEqual(partnershipDocuments.map(({ contractNumber, documentVersion, status }) => ({ contractNumber, documentVersion, status })), [
      { contractNumber: `${partnership.requestNumber}-P01`, documentVersion: 1, status: "DRAFT" },
      { contractNumber: `${partnership.requestNumber}-P02`, documentVersion: 2, status: "DRAFT" },
    ]);
    assert.equal(partnershipDocuments[1]!.supersedesDocumentId, immutableP01.id);
    assert.deepEqual(await prisma.contractDocument.findUniqueOrThrow({
      where: { id: immutableP01.id },
      select: {
        id: true,
        contractNumber: true,
        templateId: true,
        templateVersion: true,
        documentVersion: true,
        kind: true,
        status: true,
        generatedAt: true,
        priceSnapshotCents: true,
        currency: true,
        sourceSnapshot: true,
        documentHashSha256: true,
        assetId: true,
        supersedesDocumentId: true,
        createdAt: true,
      },
    }), immutableP01);
    assert.equal(await prisma.rightsRequestEvent.count({ where: { rightsRequestId: partnershipRecord.id, idempotencyKey: `rights:${partnershipRecord.id}:preauthorization:2` } }), 1);
    assert.equal(await prisma.orderAsset.count({ where: { orderId: partnershipOrder.orderId, role: "CONTRACT" } }), 2);
    assert.equal(storedKeys.size, 2);
    assert.equal(deletedKeys.size, 0);
    await generatePartnershipPreauthorizationRevision(member, partnership.requestNumber, delayedStorage);
    assert.equal(await prisma.contractDocument.count({ where: { rightsRequestId: partnershipRecord.id, kind: "PREAUTHORIZATION" } }), 2);
    assert.equal(storedKeys.size, 2);
    assert.equal(await prisma.payment.count({ where: { orderId: partnershipOrder.orderId } }), 1);
    passed.push("concurrent P02 revision, immutable P01 and no rights payment side effect");

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

    const generationRequest = await createRightsDraft(member, generationOrder.orderNumber, safariHumanRegressionInput());
    const generationRecord = await prisma.rightsRequest.findUniqueOrThrow({ where: { requestNumber: generationRequest.requestNumber }, select: { id: true } });
    await confirmRightsCoordinates(member, generationRequest.requestNumber, fakeStorage);
    await requestRightsInformation(admin, generationRequest.requestNumber, "Précisez la destination contractuelle.", ["project", "platforms", "territory", "duration"]);
    await respondRightsInformation(member, generationRequest.requestNumber, "Destination et paramètres fictifs confirmés pour la QA.");
    await startRightsReview(admin, generationRequest.requestNumber);
    await updateAiContributionAssessment(admin, generationRequest.requestNumber, "HUMAN_CONTRIBUTION_DOCUMENTED");
    await saveRightsGrant(admin, generationRequest.requestNumber, { kind: "PUBLICATION", authorized: true, exclusive: false, destination: "Publication et monétisation de la création sur les plateformes expressément autorisées.", platforms: ["Spotify", "Apple Music", "Deezer"], territory: "France", duration: "2 ans", monetization: true, adaptation: false, advertising: false, audiovisualSync: false, contentId: false, sublicense: false, credit: "LNX Beats — création musicale", restrictions: "Aucune utilisation publicitaire, synchronisation audiovisuelle, Content ID, adaptation ou sous-licence sans autorisation contractuelle distincte de LNX Beats." });
    await saveSplitProposal(admin, generationRequest.requestNumber, {
      clientSharePercent: 30,
      lnxSharePercent: 70,
      nature: "Proposition de répartition contractuelle à étudier",
      contributionRationale: "Le client a fourni l’histoire de départ, le thème et les intentions générales du projet. LNX Beats a réalisé la création musicale, la mise en forme artistique finale et les éléments de production.",
      proposedRoles: ["Apport narratif et concept initial", "création musicale", "production artistique"],
      comment: "Proposition commerciale non contraignante, soumise à validation contractuelle et juridique.",
    });
    const entrypointLocations: string[] = [];
    async function runGenerationEntrypoint(expectedDocumentVersion: number) {
      try {
        await handleAdminRightsDocumentGeneration(generationForm(generationRequest.requestNumber, expectedDocumentVersion), {
          async authenticateAdmin() {
            const authenticated = await prisma.user.findUniqueOrThrow({ where: { id: admin.id } });
            assert.equal(authenticated.role, "ADMIN");
            assert.equal(authenticated.status, "ACTIVE");
            assert.ok(authenticated.emailVerified);
            return actor(authenticated);
          },
          generate: generateRightsDocument,
          refresh(value) { assert.equal(value, generationRequest.requestNumber); },
          dispatchNotifications() { assert.fail("A DRAFT document must not dispatch a ready notification."); },
          redirect(location): never { throw new EntryPointRedirect(location); },
          logUnexpectedFailure() { assert.fail("The real entrypoint must not map a generation failure."); },
        });
      } catch (error) {
        assert.ok(error instanceof EntryPointRedirect);
        entrypointLocations.push(error.location);
      }
    }
    await Promise.all(Array.from({ length: 4 }, () => runGenerationEntrypoint(1)));
    assert.deepEqual(entrypointLocations, Array.from({ length: 4 }, () => `/admin/droits/${generationRequest.requestNumber}?etat=projet-draft-genere`));
    const generatedDocuments = await prisma.contractDocument.findMany({
      where: { rightsRequestId: generationRecord.id, kind: "CONTRACT" },
      include: { asset: true, template: true },
    });
    assert.equal(generatedDocuments.length, 1);
    const generatedDocument = generatedDocuments[0]!;
    assert.equal(generatedDocument.template.status, "DRAFT");
    assert.equal(generatedDocument.status, "DRAFT");
    const sourceSnapshot = generatedDocument.sourceSnapshot as {
      request?: { workTitle?: string };
      party?: { firstName?: string | null; lastName?: string | null };
      grants?: Array<{ destination?: string | null; platforms?: unknown; territory?: string | null; duration?: string | null; credit?: string | null; restrictions?: string | null }>;
      splitProposal?: { version?: number; clientSharePercent?: number; lnxSharePercent?: number; nature?: string };
      legalWarnings?: { legalReviewRequired?: boolean };
    };
    assert.equal(sourceSnapshot.legalWarnings?.legalReviewRequired, true);
    assert.equal(sourceSnapshot.request?.workTitle, "Élégie d’été");
    assert.deepEqual([sourceSnapshot.party?.firstName, sourceSnapshot.party?.lastName], ["Camille", "Navigateur"]);
    assert.deepEqual(sourceSnapshot.grants?.[0], {
      ...sourceSnapshot.grants?.[0],
      destination: "Publication et monétisation de la création sur les plateformes expressément autorisées.",
      platforms: ["Spotify", "Apple Music", "Deezer"],
      territory: "France",
      duration: "2 ans",
      credit: "LNX Beats — création musicale",
      restrictions: "Aucune utilisation publicitaire, synchronisation audiovisuelle, Content ID, adaptation ou sous-licence sans autorisation contractuelle distincte de LNX Beats.",
    });
    assert.deepEqual(sourceSnapshot.splitProposal && {
      version: sourceSnapshot.splitProposal.version,
      clientSharePercent: sourceSnapshot.splitProposal.clientSharePercent,
      lnxSharePercent: sourceSnapshot.splitProposal.lnxSharePercent,
      nature: sourceSnapshot.splitProposal.nature,
    }, {
      version: 1,
      clientSharePercent: 30,
      lnxSharePercent: 70,
      nature: "Proposition de répartition contractuelle à étudier",
    });
    assert.equal(generatedDocument.asset.visibility, "PRIVATE");
    assert.equal(generatedDocument.asset.storageBackend, "OBJECT");
    assert.equal(generatedDocument.asset.storageProvider, "r2");
    const storedPdf = await readPrivateOrderFile(generatedDocument.asset);
    const storedMetadata = await statPrivateOrderFile(generatedDocument.asset);
    assert.equal(createHash("sha256").update(storedPdf).digest("hex"), generatedDocument.documentHashSha256);
    assert.equal(storedMetadata.checksumSha256, generatedDocument.documentHashSha256);
    assert.match(storedPdf.toString("latin1"), /^%PDF-/);
    const immutableC01 = await prisma.contractDocument.findUniqueOrThrow({
      where: { id: generatedDocument.id },
      select: {
        contractNumber: true,
        documentVersion: true,
        status: true,
        generatedAt: true,
        documentHashSha256: true,
        sourceSnapshot: true,
        supersedesDocumentId: true,
        createdAt: true,
        assetId: true,
      },
    });
    const immutableC01Bytes = Buffer.from(storedPdf);
    assert.equal((await prisma.rightsRequest.findUniqueOrThrow({ where: { id: generationRecord.id }, select: { status: true } })).status, "CONTRACT_PREPARATION");
    assert.equal(await prisma.rightsRequestEvent.count({ where: { rightsRequestId: generationRecord.id, type: "DOCUMENT_GENERATED" } }), 1);
    entrypointLocations.length = 0;
    await Promise.all(Array.from({ length: 4 }, () => runGenerationEntrypoint(2)));
    assert.deepEqual(entrypointLocations, Array.from({ length: 4 }, () => `/admin/droits/${generationRequest.requestNumber}?etat=projet-draft-genere`));
    const versionedDocuments = await prisma.contractDocument.findMany({
      where: { rightsRequestId: generationRecord.id, kind: "CONTRACT" },
      orderBy: { documentVersion: "asc" },
      include: { asset: true },
    });
    assert.equal(versionedDocuments.length, 2);
    assert.equal(versionedDocuments[0]!.contractNumber, `${generationRequest.requestNumber}-C01`);
    assert.equal(versionedDocuments[0]!.status, "DRAFT");
    assert.equal(versionedDocuments[1]!.contractNumber, `${generationRequest.requestNumber}-C02`);
    assert.equal(versionedDocuments[1]!.status, "DRAFT");
    assert.equal(versionedDocuments[1]!.supersedesDocumentId, versionedDocuments[0]!.id);
    const c01AfterC02 = await prisma.contractDocument.findUniqueOrThrow({
      where: { id: generatedDocument.id },
      select: {
        contractNumber: true,
        documentVersion: true,
        status: true,
        generatedAt: true,
        documentHashSha256: true,
        sourceSnapshot: true,
        supersedesDocumentId: true,
        createdAt: true,
        assetId: true,
      },
    });
    assert.deepEqual(c01AfterC02, immutableC01);
    const c01BytesAfterC02 = await readPrivateOrderFile(versionedDocuments[0]!.asset);
    assert.deepEqual(c01BytesAfterC02, immutableC01Bytes);
    assert.equal(createHash("sha256").update(c01BytesAfterC02).digest("hex"), immutableC01.documentHashSha256);
    assert.equal(await prisma.rightsRequestEvent.count({ where: { rightsRequestId: generationRecord.id, type: "DOCUMENT_GENERATED" } }), 1);
    assert.equal(await prisma.rightsRequestEvent.count({ where: { rightsRequestId: generationRecord.id, type: "DOCUMENT_SUPERSEDED" } }), 1);
    const immutableC02 = await prisma.contractDocument.findUniqueOrThrow({
      where: { id: versionedDocuments[1]!.id },
      select: {
        contractNumber: true,
        documentVersion: true,
        status: true,
        generatedAt: true,
        documentHashSha256: true,
        sourceSnapshot: true,
        supersedesDocumentId: true,
        createdAt: true,
        assetId: true,
      },
    });
    const immutableC02Bytes = Buffer.from(await readPrivateOrderFile(versionedDocuments[1]!.asset));
    const c02Snapshot = immutableC02.sourceSnapshot as { splitProposal?: { version?: number; clientSharePercent?: number; lnxSharePercent?: number } };
    assert.deepEqual(c02Snapshot.splitProposal && {
      version: c02Snapshot.splitProposal.version,
      clientSharePercent: c02Snapshot.splitProposal.clientSharePercent,
      lnxSharePercent: c02Snapshot.splitProposal.lnxSharePercent,
    }, { version: 1, clientSharePercent: 30, lnxSharePercent: 70 });
    await writeFile("/private/tmp/lnx-v072-partnership-c02-fixture.pdf", immutableC02Bytes, { mode: 0o600 });
    await saveSplitProposal(admin, generationRequest.requestNumber, {
      clientSharePercent: 40,
      lnxSharePercent: 60,
      nature: "Proposition contractuelle révisée",
      contributionRationale: "Révision technique destinée à vérifier l’immuabilité de la version précédente.",
      proposedRoles: ["Apport narratif", "création musicale"],
      comment: "La version précédente doit rester inchangée.",
    });
    entrypointLocations.length = 0;
    await Promise.all(Array.from({ length: 2 }, () => runGenerationEntrypoint(3)));
    assert.deepEqual(entrypointLocations, Array.from({ length: 2 }, () => `/admin/droits/${generationRequest.requestNumber}?etat=projet-draft-genere`));
    const threeVersionDocuments = await prisma.contractDocument.findMany({
      where: { rightsRequestId: generationRecord.id, kind: "CONTRACT" },
      orderBy: { documentVersion: "asc" },
      include: { asset: true },
    });
    assert.equal(threeVersionDocuments.length, 3);
    assert.deepEqual(threeVersionDocuments.map(({ contractNumber, status }) => ({ contractNumber, status })), [
      { contractNumber: `${generationRequest.requestNumber}-C01`, status: "DRAFT" },
      { contractNumber: `${generationRequest.requestNumber}-C02`, status: "DRAFT" },
      { contractNumber: `${generationRequest.requestNumber}-C03`, status: "DRAFT" },
    ]);
    assert.equal(threeVersionDocuments[2]!.supersedesDocumentId, threeVersionDocuments[1]!.id);
    const c01AfterC03 = await prisma.contractDocument.findUniqueOrThrow({
        where: { id: threeVersionDocuments[0]!.id },
        select: {
          contractNumber: true,
          documentVersion: true,
          status: true,
          generatedAt: true,
          documentHashSha256: true,
          sourceSnapshot: true,
          supersedesDocumentId: true,
          createdAt: true,
          assetId: true,
        },
      });
    const c02AfterC03 = await prisma.contractDocument.findUniqueOrThrow({
        where: { id: threeVersionDocuments[1]!.id },
        select: {
          contractNumber: true,
          documentVersion: true,
          status: true,
          generatedAt: true,
          documentHashSha256: true,
          sourceSnapshot: true,
          supersedesDocumentId: true,
          createdAt: true,
          assetId: true,
        },
      });
    assert.deepEqual(c01AfterC03, immutableC01);
    assert.deepEqual(c02AfterC03, immutableC02);
    const c01BytesAfterC03 = await readPrivateOrderFile(threeVersionDocuments[0]!.asset);
    const c02BytesAfterC03 = await readPrivateOrderFile(threeVersionDocuments[1]!.asset);
    assert.deepEqual(c01BytesAfterC03, immutableC01Bytes);
    assert.deepEqual(c02BytesAfterC03, immutableC02Bytes);
    assert.equal(createHash("sha256").update(c01BytesAfterC03).digest("hex"), immutableC01.documentHashSha256);
    assert.equal(createHash("sha256").update(c02BytesAfterC03).digest("hex"), immutableC02.documentHashSha256);
    assert.equal(await prisma.rightsRequestEvent.count({ where: { rightsRequestId: generationRecord.id, type: "DOCUMENT_GENERATED" } }), 1);
    assert.equal(await prisma.rightsRequestEvent.count({ where: { rightsRequestId: generationRecord.id, type: "DOCUMENT_SUPERSEDED" } }), 2);
    entrypointLocations.length = 0;
    await runGenerationEntrypoint(5);
    assert.equal(entrypointLocations.at(-1), `/admin/droits/${generationRequest.requestNumber}?etat=generation-page-obsolete`);
    assert.equal(await prisma.contractDocument.count({ where: { rightsRequestId: generationRecord.id, kind: "CONTRACT" } }), 3);
    const privateDocuments = await prisma.orderAsset.findMany({
      where: { orderId: generationOrder.orderId, role: "CONTRACT" },
      include: { asset: { select: { _count: { select: { contractDocuments: true } } } } },
    });
    assert.equal(privateDocuments.length, 4);
    assert.ok(privateDocuments.every(({ asset }) => asset._count.contractDocuments === 1));
    assert.equal(await prisma.orderNotification.count({ where: { orderId: generationOrder.orderId, kind: "CUSTOMER_RIGHTS_CONTRACT_READY" } }), 0);
    assert.equal(await prisma.payment.count({ where: { orderId: generationOrder.orderId } }), 1);
    const c03Snapshot = threeVersionDocuments[2]!.sourceSnapshot as { splitProposal?: { version?: number; clientSharePercent?: number; lnxSharePercent?: number } };
    assert.deepEqual(c03Snapshot.splitProposal && {
      version: c03Snapshot.splitProposal.version,
      clientSharePercent: c03Snapshot.splitProposal.clientSharePercent,
      lnxSharePercent: c03Snapshot.splitProposal.lnxSharePercent,
    }, { version: 2, clientSharePercent: 40, lnxSharePercent: 60 });
    passed.push("partnership C01/C02 immutability, concurrent C02/C03 idempotence, split snapshots, private R2 and hash integrity");

    const proof = { sessionReferenceHash: createHash("sha256").update("qa-session").digest("hex"), userAgentHash: createHash("sha256").update("qa-agent").digest("hex") };
    await assert.rejects(
      acceptRightsContract(member, generationRequest.requestNumber, { typedFullName: "Camille Navigateur", password, accepted: true, ...proof }, fakeStorage),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "CONTRACT_NOT_READY",
    );
    await assert.rejects(adminValidateRightsContract(admin, generationRequest.requestNumber, "LNX Admin QA", true));
    assert.equal(await prisma.contractAcceptance.count({ where: { rightsRequestId: generationRecord.id } }), 0);
    assert.equal(rightsPaymentEnabled(), false);
    assert.equal(await prisma.payment.count({ where: { orderId: generationOrder.orderId } }), 1);
    await assert.rejects(prisma.rightsRequest.update({ where: { id: generationRecord.id }, data: { status: "ACTIVE" } }));
    passed.push("DRAFT contract cannot be accepted, validated, activated or paid");

    await deleteRightsDraft(member, concurrent[0]!.requestNumber);
    assert.equal(await prisma.rightsRequest.count({ where: { orderId: publicationOrder.orderId } }), 0);
    const cancellableOrder = await createDeliveredOrder(member.id, member.email, 4);
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

run().catch((error: unknown) => {
  if (error instanceof Error) {
    const localFrames = error.stack?.split("\n").filter((line) => line.includes("scripts/test-contracts-runtime.ts") || line.includes("lib/rights/")).slice(0, 6) ?? [];
    console.error([error.message, ...localFrames].join("\n"));
  } else console.error("Contracts runtime failed.");
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
