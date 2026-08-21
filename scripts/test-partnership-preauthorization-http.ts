import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";

import { createInternalAuthUser } from "@/lib/auth/internal-user";
import type { OrderActor } from "@/lib/orders/domain";
import { deletePrivateOrderFile, readPrivateOrderFile, statPrivateOrderFile } from "@/lib/orders/storage";
import { prisma } from "@/lib/prisma";
import type { RightsDraftInput } from "@/lib/rights/input";
import { loadAndAssertRightsQaEnvironment } from "@/lib/rights/qa-guard";
import { confirmRightsCoordinates, createRightsDraft } from "@/lib/rights/service";

const MEMBER_EMAIL = "lnx-v072-p02-http-member@example.invalid";
const OTHER_EMAIL = "lnx-v072-p02-http-other@example.invalid";
const ADMIN_EMAIL = "lnx-v072-p02-http-admin@example.invalid";
const EMAILS = [MEMBER_EMAIL, OTHER_EMAIL, ADMIN_EMAIL] as const;
const ORDER_NUMBER = "LNX-2072-000091";
const SIGN_IN_KEYS = ["127.0.0.91|/sign-in/email", "127.0.0.92|/sign-in/email", "127.0.0.93|/sign-in/email"] as const;

function actor(user: { id: string; email: string; displayName: string | null; role: "ADMIN" | "MEMBER" | "CUSTOMER" }): OrderActor {
  return { id: user.id, email: user.email, name: user.displayName ?? "QA", role: user.role, status: "ACTIVE", emailVerified: true };
}

function input(): RightsDraftInput {
  return {
    type: "EXPLOITATION_PARTNERSHIP",
    party: { partyType: "INDIVIDUAL", firstName: "Ariane", lastName: "P02", artistName: "Ariane P02", companyName: "", legalForm: "", legalRepresentative: "", streetAddress: "91 rue du Test", postalCode: "75001", city: "Paris", country: "FR", siret: "", vatNumber: "", contractEmail: MEMBER_EMAIL, phone: "" },
    project: { workTitle: "Partenariat HTTP P02", publicationName: "Partenariat HTTP P02", artistName: "Ariane P02", distributor: "Distributeur fictif", platforms: ["SPOTIFY", "APPLE_MUSIC", "DEEZER"], otherPlatforms: "", targetDate: "", monetized: true, territory: "France", duration: "À définir avec LNX Beats", clips: "", socialNetworks: "TikTok et Instagram", advertising: false, contentId: false, modifications: "Aucune modification sans accord.", credits: "LNX Beats — création musicale" },
    contributions: [{ kind: "STORY_BRIEF_ONLY", description: "Histoire et intentions fictives de la fixture HTTP P02.", claimedPercentage: null, evidenceNote: "" }],
    partnership: { lyricsAuthor: "LNX Beats", lyricsProvided: "Histoire fictive fournie, sans paroles finales.", lyricRewrites: "", lyricsClaimedPercentage: null, melody: "", harmony: "", structure: "", arrangement: "", instrumental: "", compositionClaimedPercentage: null, artisticDirection: "", voice: "", mixMaster: "", instruments: "", production: "", toolsUsed: "Échanges fictifs avec LNX Beats.", aiKnown: false, humanCreativeContribution: "Histoire et intentions générales fictives.", sacemMember: false, sacemIdentifier: "", otherCollective: "", relatedWorks: "", desiredSplit: "Répartition éventuelle à étudier selon les contributions reconnues." },
  };
}

async function cleanup() {
  const users = await prisma.user.findMany({ where: { email: { in: [...EMAILS] } }, select: { id: true } });
  const userIds = users.map(({ id }) => id);
  const orders = await prisma.order.findMany({ where: { orderNumber: ORDER_NUMBER }, select: { id: true } });
  const orderIds = orders.map(({ id }) => id);
  const requests = await prisma.rightsRequest.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } });
  const requestIds = requests.map(({ id }) => id);
  const documents = await prisma.contractDocument.findMany({
    where: { rightsRequestId: { in: requestIds } },
    select: { assetId: true, request: { select: { orderId: true } }, asset: { select: { storageKey: true, storageBackend: true, storageProvider: true, visibility: true } } },
  });
  for (const document of documents) {
    if (document.asset.storageKey.startsWith(`orders/${document.request.orderId}/documents/`)) await deletePrivateOrderFile(document.asset);
  }
  const orderAssets = await prisma.orderAsset.findMany({ where: { orderId: { in: orderIds } }, select: { assetId: true } });
  const assetIds = [...new Set([...documents.map(({ assetId }) => assetId), ...orderAssets.map(({ assetId }) => assetId)])];
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
    await transaction.rateLimit.deleteMany({ where: { key: { in: [...SIGN_IN_KEYS, ...userIds.flatMap((id) => [`rights:${id}`, `orders:${id}`])] } } });
    await transaction.session.deleteMany({ where: { userId: { in: userIds } } });
    await transaction.account.deleteMany({ where: { userId: { in: userIds } } });
    await transaction.user.deleteMany({ where: { id: { in: userIds } } });
  });
}

async function assertClean(stage: string) {
  const counts = [
    await prisma.user.count({ where: { email: { in: [...EMAILS] } } }),
    await prisma.order.count({ where: { orderNumber: ORDER_NUMBER } }),
    await prisma.rateLimit.count({ where: { key: { in: [...SIGN_IN_KEYS] } } }),
  ];
  assert.deepEqual(counts, [0, 0, 0], `${stage}: HTTP P02 fixture residue remains.`);
}

function sessionCookie(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const values = headers.getSetCookie?.() ?? [headers.get("set-cookie") ?? ""];
  const raw = values.find((value) => /^(?:__Secure-)?lnx-studio\.session_token=/.test(value));
  assert.ok(raw, "The real sign-in endpoint must issue a session cookie.");
  return raw.split(";", 1)[0]!;
}

async function login(baseUrl: string, email: string, password: string, ip: string) {
  const response = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/json", origin: baseUrl, "x-forwarded-for": ip },
    body: JSON.stringify({ email, password, rememberMe: true }),
  });
  assert.equal(response.status, 200);
  return sessionCookie(response);
}

async function revision(baseUrl: string, requestNumber: string, cookie?: string, origin = baseUrl) {
  return fetch(`${baseUrl}/api/rights/${encodeURIComponent(requestNumber)}/preauthorization/revise`, {
    method: "POST",
    redirect: "manual",
    headers: { origin, ...(cookie ? { cookie } : {}) },
  });
}

async function createDeliveredOrder(userId: string) {
  const orderId = randomUUID();
  const assetId = randomUUID();
  const now = new Date();
  await prisma.$transaction(async (transaction) => {
    await transaction.order.create({ data: { id: orderId, orderNumber: ORDER_NUMBER, userId, customerEmail: MEMBER_EMAIL, customerName: "Ariane P02", status: "DELIVERED", title: "Partenariat HTTP P02", brief: "Fixture HTTP jetable V0.7.2.", usage: "PERSONAL", totalCents: 5_000, personalUseTermsVersion: "2026-08-personal-v1", personalUseTermsHashSha256: "9".repeat(64), personalUseTermsAcceptedAt: now, submittedAt: now, deliveredAt: now } });
    await transaction.payment.create({ data: { orderId, provider: "STRIPE", mode: "TEST", status: "SUCCEEDED", amountCents: 5_000, currency: "EUR", pricingVersion: "2026-08-v1", idempotencyKey: "v072-p02-http-initial-payment", providerCheckoutId: "cs_test_v072_p02_http", providerPaymentId: "pi_test_v072_p02_http", paymentMethod: "CARD", paidAt: now } });
    await transaction.asset.create({ data: { id: assetId, type: "AUDIO", storageKey: "qa-v072-p02-http/delivery.wav", storageBackend: "OBJECT", storageProvider: "r2", visibility: "PRIVATE", checksumSha256: "8".repeat(64), filename: "delivery-http-p02.wav", mimeType: "audio/wav", sizeBytes: 1_024n, rightsStatus: "RESTRICTED", confidence: "CONFIRMED" } });
    await transaction.orderAsset.create({ data: { orderId, assetId, role: "DELIVERY" } });
  });
  return orderId;
}

async function run() {
  const { baseUrl } = await loadAndAssertRightsQaEnvironment();
  await cleanup();
  await assertClean("precondition");
  const password = process.env.LNX_AUTH_QA_PASSWORD as string;
  try {
    const memberUser = await createInternalAuthUser({ email: MEMBER_EMAIL, password, displayName: "Ariane P02", role: "MEMBER" });
    await createInternalAuthUser({ email: OTHER_EMAIL, password, displayName: "Other P02", role: "MEMBER" });
    await createInternalAuthUser({ email: ADMIN_EMAIL, password, displayName: "Admin P02", role: "ADMIN" });
    const orderId = await createDeliveredOrder(memberUser.id);
    const created = await createRightsDraft(actor(memberUser), ORDER_NUMBER, input());
    await confirmRightsCoordinates(actor(memberUser), created.requestNumber);
    const original = await prisma.contractDocument.findFirstOrThrow({ where: { request: { requestNumber: created.requestNumber }, kind: "PREAUTHORIZATION", documentVersion: 1 }, include: { asset: true } });
    const originalRecord = await prisma.contractDocument.findUniqueOrThrow({ where: { id: original.id } });
    const originalBytes = await readPrivateOrderFile(original.asset);
    const originalMetadata = await statPrivateOrderFile(original.asset);
    assert.equal(originalMetadata.checksumSha256, original.documentHashSha256);

    const [memberCookie, otherCookie, adminCookie] = await Promise.all([
      login(baseUrl, MEMBER_EMAIL, password, "127.0.0.91"),
      login(baseUrl, OTHER_EMAIL, password, "127.0.0.92"),
      login(baseUrl, ADMIN_EMAIL, password, "127.0.0.93"),
    ]);
    assert.equal((await revision(baseUrl, created.requestNumber)).status, 401);
    assert.equal((await revision(baseUrl, created.requestNumber, memberCookie, "http://127.0.0.1:31720")).status, 403);
    assert.equal((await revision(baseUrl, created.requestNumber, otherCookie)).status, 404);
    const responses = await Promise.all(Array.from({ length: 4 }, () => revision(baseUrl, created.requestNumber, memberCookie)));
    assert.ok(responses.every(({ status }) => status === 200));

    const documents = await prisma.contractDocument.findMany({ where: { request: { requestNumber: created.requestNumber }, kind: "PREAUTHORIZATION" }, orderBy: { documentVersion: "asc" }, include: { asset: true } });
    assert.equal(documents.length, 2);
    assert.deepEqual(documents.map(({ contractNumber, documentVersion, status }) => ({ contractNumber, documentVersion, status })), [
      { contractNumber: `${created.requestNumber}-P01`, documentVersion: 1, status: "DRAFT" },
      { contractNumber: `${created.requestNumber}-P02`, documentVersion: 2, status: "DRAFT" },
    ]);
    assert.deepEqual(await prisma.contractDocument.findUniqueOrThrow({ where: { id: original.id } }), originalRecord);
    assert.deepEqual(await readPrivateOrderFile(documents[0]!.asset), originalBytes);
    assert.equal(createHash("sha256").update(originalBytes).digest("hex"), original.documentHashSha256);
    assert.equal((await statPrivateOrderFile(documents[1]!.asset)).checksumSha256, documents[1]!.documentHashSha256);
    assert.equal(documents[1]!.supersedesDocumentId, original.id);
    assert.equal(await prisma.rightsRequestEvent.count({ where: { rightsRequestId: original.rightsRequestId, idempotencyKey: `rights:${original.rightsRequestId}:preauthorization:2` } }), 1);
    assert.equal(await prisma.orderAsset.count({ where: { orderId, role: "CONTRACT" } }), 2);
    assert.equal(await prisma.rightsGrant.count({ where: { rightsRequestId: original.rightsRequestId } }), 0);
    assert.equal(await prisma.contractAcceptance.count({ where: { rightsRequestId: original.rightsRequestId } }), 0);
    assert.equal(await prisma.payment.count({ where: { orderId } }), 1);

    const documentUrl = `${baseUrl}/api/rights/documents/${documents[1]!.id}`;
    const ownerGet = await fetch(documentUrl, { headers: { cookie: memberCookie } });
    assert.equal(ownerGet.status, 200);
    assert.equal(ownerGet.headers.get("cache-control"), "private, no-store");
    assert.match(ownerGet.headers.get("content-type") ?? "", /application\/pdf/);
    assert.equal(createHash("sha256").update(Buffer.from(await ownerGet.arrayBuffer())).digest("hex"), documents[1]!.documentHashSha256);
    assert.equal((await fetch(documentUrl, { method: "HEAD", headers: { cookie: memberCookie } })).status, 200);
    assert.equal((await fetch(documentUrl, { headers: { cookie: adminCookie } })).status, 200);
    assert.equal((await fetch(documentUrl, { headers: { cookie: otherCookie } })).status, 404);
    assert.equal((await fetch(documentUrl)).status, 401);
    assert.equal(await prisma.rightsRequest.count({ where: { requestNumber: created.requestNumber } }), 1);
    assert.equal((await prisma.rightsRequest.findUniqueOrThrow({ where: { requestNumber: created.requestNumber }, select: { status: true } })).status, "PREAUTHORIZATION_GENERATED");
    assert.ok((await prisma.contractTemplate.findMany()).every(({ status }) => status === "DRAFT"));
    console.info("Partnership P02 real Next entrypoint passed: 4 concurrent submissions, 1 immutable revision, private owner/Admin access, no rights payment.");
  } finally {
    await cleanup();
    await assertClean("postcondition");
  }
}

run().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Partnership P02 HTTP runtime failed.");
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
