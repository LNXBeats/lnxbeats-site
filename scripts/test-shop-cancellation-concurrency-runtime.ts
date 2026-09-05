import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { issueCreditNoteForRefund } from "@/lib/billing/service";
import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";
import {
  processVerifiedPaypalFinancialEvent,
  processVerifiedStripeFinancialEvent,
} from "@/lib/payments/provider-financial-events";
import { paypalRefundApplicationReference } from "@/lib/payments/paypal-client";
import { prisma } from "@/lib/prisma";
import {
  applyShopReturnRefundEvidenceInTransaction,
  createMemberShopReturn,
  decideShopReturn,
  inspectShopReturn,
  markShopReturnReceived,
  reconcileShopReturnRefund,
  requestShopReturnRefund,
  restockShopReturn,
  ShopRefundGatewayError,
  startShopReturnReview,
  type ShopRefundEvidence,
  type ShopRefundGateway,
} from "@/lib/shop/after-sales-service";
import { ShopAfterSalesError } from "@/lib/shop/after-sales-domain";
import { ShopCustomerRequestError } from "@/lib/shop/customer-request-domain";
import {
  createShopCustomerRequest,
  decideShopCustomerRequest,
  reconcileShopCustomerRequestRefund,
} from "@/lib/shop/customer-request-service";
import {
  markShopOrderPreparing,
  markShopOrderReadyToShip,
  markShopOrderShipped,
  recordShopOrderTracking,
  ShopFulfillmentError,
} from "@/lib/shop/fulfillment-service";
import { SHOP_LEGAL_QA_TERMS_HASH } from "@/lib/shop/legal";
import {
  applyShopCustomerCancellationEvidence,
} from "@/lib/shop/refund-finalization-service";
import {
  lockShopOrderForMutation,
  lockShopProductStockForMutation,
  lockShopRefundCapacity,
  SHOP_ORDER_MUTATION_LOCK_PREFIX,
} from "@/lib/shop/order-coordination";
import { lockShopRefundAttemptForMutation } from "@/lib/shop/refund-coordination";
import {
  createShopShippingProviderAttempt,
  ShopShippingProviderError,
} from "@/lib/shop/shipping-provider-service";
import type {
  ShippingProviderAdapter,
  ShippingProviderCreateInput,
  ShippingProviderResult,
} from "@/lib/shop/shipping-provider";

export const RUNTIME_NOW = new Date("2026-09-05T12:00:00.000Z");
export const noRuntimeGuard = () => undefined;

const RUNTIME_DATABASE_TARGET = "lnx-studio-v110-cancellation-concurrency-test";
const RUNTIME_DATABASE_NAME = "lnx_shop_cancellation_concurrency";
const RUNTIME_NATIVE_DIRECTORY_NAME = "runtime-lnx-studio-v110-cancellation-concurrency-test";
const RUNTIME_NATIVE_PROOF_BASENAME = "runtime-proof.json";

type MemberActor = Readonly<{
  id: string;
  role: "MEMBER";
  status: "ACTIVE";
  emailVerified: true;
}>;

type AdminActor = Readonly<{
  id: string;
  role: "ADMIN";
  status: "ACTIVE";
  emailVerified: true;
}>;

export type CancellationRuntimeFixture = Readonly<{
  member: MemberActor;
  adminA: AdminActor;
  adminB: AdminActor;
  productId: string;
  productTitle: string;
  shippingRateVersionId: string;
  packagingProfileId: string;
}>;

export type CancellationFixtureOrder = Readonly<{
  id: string;
  orderNumber: string;
  paymentId: string;
  provider: "STRIPE" | "PAYPAL";
  providerPaymentId: string;
  amountCents: number;
  invoiceId: string;
}>;

type FulfillmentFixtureState = "PENDING" | "PREPARING" | "READY_TO_SHIP" | "READY_TRACKED";

type Deferred<T> = Readonly<{
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}>;

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function digest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function requiredConnectionString() {
  const value = process.env.DATABASE_URL ?? "";
  assertSafeLocalPostgresUrl(value);
  return value;
}

export function isolatedCancellationRuntimeClient(applicationName: string) {
  const connectionString = requiredConnectionString();
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString,
      application_name: `lnx-cancel-${applicationName}`,
      max: 1,
    }),
  });
}

const runtimeServiceClient = isolatedCancellationRuntimeClient("service");

function actorEmail(kind: string) {
  return `lnx-v110-cancellation-${kind}@example.invalid`;
}

async function assertDisposableRuntime() {
  const database = assertSafeLocalPostgresUrl(process.env.DATABASE_URL ?? "");
  const configuredProofFile = process.env.LNX_NATIVE_POSTGRES_PROOF_FILE ?? "";
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.LNX_DATABASE_TARGET, RUNTIME_DATABASE_TARGET);
  assert.ok(configuredProofFile.startsWith("/private/tmp/"), "the native PostgreSQL proof must be under /private/tmp");
  const proofFile = await realpath(configuredProofFile);
  assert.equal(configuredProofFile, proofFile, "the native PostgreSQL proof path must be canonical");
  assert.equal(basename(proofFile), RUNTIME_NATIVE_PROOF_BASENAME);
  const runtimeDirectory = dirname(proofFile);
  assert.equal(basename(runtimeDirectory), RUNTIME_NATIVE_DIRECTORY_NAME);
  const runtimeDataDirectory = join(runtimeDirectory, "data");
  assert.ok(!process.env.LNX_PRISMA_DEV_SERVER_FILE, "Prisma Dev/PGlite is forbidden for this concurrency runtime");
  assert.ok(!process.env.RAILWAY_ENVIRONMENT && !process.env.RAILWAY_ENVIRONMENT_NAME);
  assert.equal(database.hostname, "127.0.0.1");
  assert.notEqual(database.port, "5432");
  assert.equal(decodeURIComponent(database.pathname), `/${RUNTIME_DATABASE_NAME}`);
  assert.equal(process.env.NOTIFICATION_EMAIL_TRANSPORT, "capture");
  assert.equal(process.env.EMAIL_PROVIDER, "capture");
  for (const name of [
    "STRIPE_SECRET_KEY",
    "STRIPE_WEBHOOK_SECRET",
    "PAYPAL_CLIENT_SECRET",
    "PAYPAL_WEBHOOK_ID",
    "RESEND_API_KEY",
  ]) assert.ok(!process.env[name], `${name} must be absent from the disposable runtime`);
  const proof = JSON.parse(await readFile(proofFile, "utf8")) as {
    formatVersion?: number;
    target?: string;
    engine?: string;
    host?: string;
    port?: number;
    database?: string;
    dataDirectory?: string;
    postmasterPid?: number;
    postmasterStartedAt?: string;
    connectionString?: string;
  };
  assert.equal(proof.formatVersion, 1);
  assert.equal(proof.target, RUNTIME_DATABASE_TARGET);
  assert.equal(proof.engine, "postgresql-native");
  assert.equal(proof.host, "127.0.0.1");
  assert.equal(proof.database, RUNTIME_DATABASE_NAME);
  assert.equal(proof.dataDirectory, runtimeDataDirectory);
  assert.equal(await realpath(proof.dataDirectory), runtimeDataDirectory);
  assert.ok(Number.isInteger(proof.postmasterPid) && Number(proof.postmasterPid) > 0, "the native PostgreSQL proof requires a live postmaster pid");
  process.kill(Number(proof.postmasterPid), 0);
  const postmasterPidFile = await readFile(join(runtimeDataDirectory, "postmaster.pid"), "utf8");
  const postmasterPidLines = postmasterPidFile.split("\n");
  assert.equal(Number(postmasterPidLines[0]), proof.postmasterPid);
  const proofConnectionString = proof.connectionString ?? "";
  const proofDatabase = assertSafeLocalPostgresUrl(proofConnectionString, "native PostgreSQL proof connection string");
  assert.equal(proofDatabase.hostname, "127.0.0.1");
  assert.equal(decodeURIComponent(proofDatabase.pathname), `/${RUNTIME_DATABASE_NAME}`);
  assert.equal(Number(proof.port), Number(database.port));
  assert.equal(process.env.DATABASE_URL, proofConnectionString);
  assert.equal(proofDatabase.port, database.port);
  assert.ok(proof.postmasterStartedAt && !Number.isNaN(new Date(proof.postmasterStartedAt).getTime()));
  const identity = await prisma.$queryRaw<Array<{
    backendPid: number;
    database: string;
    schema: string;
    serverAddress: string;
    serverPort: number;
    dataDirectory: string;
    postmasterStartedEpochSeconds: string;
    serverVersion: number;
  }>>`
    SELECT
      pg_backend_pid()::int AS "backendPid",
      current_database() AS database,
      current_schema() AS schema,
      host(inet_server_addr()) AS "serverAddress",
      inet_server_port()::int AS "serverPort",
      current_setting('data_directory') AS "dataDirectory",
      floor(extract(epoch FROM pg_postmaster_start_time()))::text AS "postmasterStartedEpochSeconds",
      current_setting('server_version_num')::int AS "serverVersion"
  `;
  assert.equal(identity[0]?.database, RUNTIME_DATABASE_NAME);
  assert.equal(identity[0]?.schema, "public");
  assert.equal(identity[0]?.serverAddress, "127.0.0.1");
  assert.equal(identity[0]?.serverPort, proof.port);
  assert.equal(await realpath(identity[0]!.dataDirectory), runtimeDataDirectory);
  const proofStartedEpochSeconds = String(Math.floor(new Date(proof.postmasterStartedAt!).getTime() / 1_000));
  assert.equal(postmasterPidLines[2], proofStartedEpochSeconds);
  assert.equal(identity[0]?.postmasterStartedEpochSeconds, proofStartedEpochSeconds);
  assert.ok((identity[0]?.serverVersion ?? 0) >= 140000, "PostgreSQL 14 or newer is required");
  const independentConnection = await runtimeServiceClient.$queryRaw<Array<{
    backendPid: number;
    database: string;
    serverPort: number;
  }>>`
    SELECT
      pg_backend_pid()::int AS "backendPid",
      current_database() AS database,
      inet_server_port()::int AS "serverPort"
  `;
  assert.equal(independentConnection[0]?.database, RUNTIME_DATABASE_NAME);
  assert.equal(independentConnection[0]?.serverPort, proof.port);
  assert.notEqual(
    independentConnection[0]?.backendPid,
    identity[0]?.backendPid,
    "the runtime requires two independent PostgreSQL backend sessions",
  );
  const migrations = await prisma.$queryRaw<Array<{ applied: number; total: number }>>`
    SELECT
      count(*) FILTER (WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL)::int AS applied,
      count(*)::int AS total
    FROM "_prisma_migrations"
  `;
  assert.deepEqual(migrations[0], { applied: 29, total: 29 });
  assert.equal(await prisma.user.count(), 0, "the concurrency runtime requires a fresh disposable database");
  return {
    target: RUNTIME_DATABASE_TARGET,
    engine: "postgresql-native" as const,
    database: RUNTIME_DATABASE_NAME,
    databasePort: database.port,
    postmasterPid: Number(proof.postmasterPid),
    backendPids: [identity[0]!.backendPid, independentConnection[0]!.backendPid],
    serverVersion: identity[0]!.serverVersion,
    migrations: migrations[0]!.applied,
  } as const;
}

export async function createCancellationRuntimeFixture(): Promise<CancellationRuntimeFixture> {
  const createdAt = new Date(RUNTIME_NOW.getTime() - 60_000);
  const [member, adminA, adminB] = await Promise.all([
    prisma.user.create({ data: {
      email: actorEmail("member"), displayName: "Membre annulation runtime", role: "MEMBER",
      status: "ACTIVE", emailVerified: true, emailVerifiedAt: createdAt, createdAt,
    } }),
    prisma.user.create({ data: {
      email: actorEmail("admin-a"), displayName: "Admin A annulation runtime", role: "ADMIN",
      status: "ACTIVE", emailVerified: true, emailVerifiedAt: createdAt, createdAt,
    } }),
    prisma.user.create({ data: {
      email: actorEmail("admin-b"), displayName: "Admin B annulation runtime", role: "ADMIN",
      status: "ACTIVE", emailVerified: true, emailVerifiedAt: createdAt, createdAt,
    } }),
  ]);
  const product = await prisma.product.create({ data: {
    slug: "lnx-v110-cancellation-runtime-cd",
    title: "CD fictif — concurrence annulation",
    description: "Fixture PostgreSQL locale jetable, sans donnée Production.",
    status: "PUBLISHED",
    priceCents: 700,
    currency: "EUR",
    trackInventory: true,
    stock: 40,
    shippingRequired: true,
    shippingPriceCents: 0,
    shippingWeightGrams: 25,
    publishedAt: createdAt,
    createdByAdminId: adminA.id,
    updatedByAdminId: adminA.id,
    createdAt,
  } });
  const packaging = await prisma.packagingProfile.create({ data: {
    version: "cancellation-runtime-package-v1",
    name: "Emballage annulation runtime",
    status: "ACTIVE",
    physicalWeightGrams: 60,
    maximumItemQuantity: 20,
    customerBillableWeightIncluded: false,
    activatedAt: createdAt,
    createdAt,
  } });
  const rate = await prisma.shippingRateVersion.create({ data: {
    version: "cancellation-runtime-rate-v1",
    status: "ACTIVE",
    scope: "INTERNAL_QA",
    service: "STANDARD_TRACKED_SIGNATURE",
    currency: "EUR",
    countryCode: "FR",
    minimumBillableWeightGrams: 250,
    packagingWeightGrams: 60,
    billableWeightPolicy: "PRODUCTS_ONLY",
    packagingProfileId: packaging.id,
    sourceLabel: "Fixture annulation locale",
    activatedAt: createdAt,
    createdAt,
    tiers: { create: [{ position: 0, maxWeightGrams: 250, priceCents: 549, createdAt }] },
  } });
  return {
    member: { id: member.id, role: "MEMBER", status: "ACTIVE", emailVerified: true },
    adminA: { id: adminA.id, role: "ADMIN", status: "ACTIVE", emailVerified: true },
    adminB: { id: adminB.id, role: "ADMIN", status: "ACTIVE", emailVerified: true },
    productId: product.id,
    productTitle: product.title,
    shippingRateVersionId: rate.id,
    packagingProfileId: packaging.id,
  };
}

export async function createCancellationFixtureOrder(
  fixture: CancellationRuntimeFixture,
  sequence: number,
  input: Readonly<{
    provider?: "STRIPE" | "PAYPAL";
    fulfillment?: FulfillmentFixtureState;
  }> = {},
): Promise<CancellationFixtureOrder> {
  const provider = input.provider ?? "PAYPAL";
  const fulfillment = input.fulfillment ?? "PENDING";
  const orderNumber = `LNX-SHOP-2099-${sequence.toString().padStart(6, "0")}`;
  const createdAt = new Date(RUNTIME_NOW.getTime() - 30_000);
  const paidAt = new Date(createdAt.getTime() + 1_000);
  const preparingAt = fulfillment === "PENDING" ? null : new Date(paidAt.getTime() + 1_000);
  const readyToShipAt = fulfillment === "PENDING" || fulfillment === "PREPARING"
    ? null
    : new Date(paidAt.getTime() + 2_000);
  const tracked = fulfillment === "READY_TRACKED";
  const order = await prisma.shopOrder.create({ data: {
    orderNumber,
    userId: fixture.member.id,
    creationToken: randomUUID(),
    requestFingerprintSha256: digest(orderNumber),
    status: "OPEN",
    paymentStatus: "PAID",
    fulfillmentStatus: fulfillment === "READY_TRACKED" ? "READY_TO_SHIP" : fulfillment,
    currency: "EUR",
    subtotalCents: 700,
    shippingCents: 549,
    totalCents: 1_249,
    shippingRequired: true,
    shippingFirstName: "Membre",
    shippingLastName: "Annulation Runtime",
    shippingAddressLine1: "5 rue du Test local",
    shippingPostalCode: "75005",
    shippingCity: "Paris",
    shippingCountryCode: "FR",
    shippingRateVersionId: fixture.shippingRateVersionId,
    shippingQuoteVersion: "cancellation-runtime-rate-v1",
    shippingMethod: "STANDARD_TRACKED_SIGNATURE",
    shippingWeightGrams: 25,
    shippingPackagingGrams: 60,
    shippingPhysicalGrams: 85,
    shippingBillableGrams: 25,
    shippingTierMaxGrams: 250,
    packagingProfileId: fixture.packagingProfileId,
    packagingProfileVersion: "cancellation-runtime-package-v1",
    shippingWeightPolicy: "PRODUCTS_ONLY",
    termsVersion: "shop-cgv-cancellation-runtime-v1",
    termsHashSha256: SHOP_LEGAL_QA_TERMS_HASH,
    termsAcceptedAt: createdAt,
    reservationExpiresAt: new Date(createdAt.getTime() + 30 * 60_000),
    paidAt,
    preparingAt,
    readyToShipAt,
    shippingCarrier: tracked ? "Transporteur QA" : null,
    trackingNumber: tracked ? `QA-CANCEL-${sequence}` : null,
    trackingUrl: tracked ? `https://tracking.example.invalid/QA-CANCEL-${sequence}` : null,
    trackingSource: tracked ? "MANUAL" : null,
    trackingRecordedAt: tracked ? new Date(paidAt.getTime() + 3_000) : null,
    trackingRevision: tracked ? 1 : 0,
    createdAt,
    updatedAt: createdAt,
    items: { create: [{
      productId: fixture.productId,
      position: 0,
      productTitle: fixture.productTitle,
      inventoryTracked: true,
      unitPriceCents: 700,
      quantity: 1,
      lineTotalCents: 700,
      shippingRequired: true,
      unitShippingCents: 0,
      lineShippingCents: 0,
      unitShippingWeightGrams: 25,
      lineShippingWeightGrams: 25,
      currency: "EUR",
      createdAt,
    }] },
  } });
  await prisma.stockReservation.create({ data: {
    shopOrderId: order.id,
    productId: fixture.productId,
    quantity: 1,
    status: "CONFIRMED",
    expiresAt: order.reservationExpiresAt,
    confirmedAt: paidAt,
    createdAt,
  } });
  const providerPaymentId = provider === "PAYPAL"
    ? `PAYPAL-CAPTURE-CANCEL-${sequence}`
    : `pi_cancel_runtime_${sequence}`;
  const payment = await prisma.payment.create({ data: {
    shopOrderId: order.id,
    provider,
    mode: "TEST",
    status: "SUCCEEDED",
    amountCents: 1_249,
    currency: "EUR",
    pricingVersion: "shop-order-snapshot-v1",
    idempotencyKey: `cancellation-runtime-payment:${sequence}`,
    providerCheckoutId: `cancellation_runtime_checkout_${provider}_${sequence}`,
    providerPaymentId,
    paymentMethod: provider === "PAYPAL" ? "PAYPAL" : "CARD",
    paidAt,
    createdAt,
  } });
  const invoice = await prisma.invoice.create({ data: {
    invoiceNumber: `LNX-20990905-${sequence}`,
    sequenceNumber: BigInt(sequence),
    issuedAt: paidAt,
    documentType: "SHOP",
    operationCategory: "GOODS",
    shopOrderId: order.id,
    paymentId: payment.id,
    orderNumberSnapshot: order.orderNumber,
    customerType: "INDIVIDUAL",
    customerNameSearch: "Membre Annulation Runtime",
    customerEmailSearch: actorEmail("member"),
    sellerSnapshot: { name: "LNX Beats QA" },
    customerSnapshot: {
      firstName: "Membre", lastName: "Annulation Runtime", addressLine1: "5 rue du Test local",
      postalCode: "75005", city: "Paris", countryCode: "FR", email: actorEmail("member"),
    },
    lineItemsSnapshot: [{ title: fixture.productTitle, quantity: 1, unitPriceCents: 700 }],
    currency: "EUR",
    subtotalCents: 700,
    shippingCents: 549,
    totalCents: 1_249,
    vatRegime: "FRANCHISE_EN_BASE_TVA",
    vatAmountCents: 0,
    vatLegalNotice: "TVA non applicable — fixture QA",
    paymentMethodLabel: provider === "PAYPAL" ? "PayPal test" : "Carte test",
    paidAt,
    termsVersion: order.termsVersion,
    termsHashSha256: order.termsHashSha256,
    snapshotHashSha256: digest(`invoice:${sequence}`),
    createdAt,
  } });
  return {
    id: order.id,
    orderNumber,
    paymentId: payment.id,
    provider,
    providerPaymentId,
    amountCents: payment.amountCents,
    invoiceId: invoice.id,
  };
}

export async function createCancellationRequest(
  fixture: CancellationRuntimeFixture,
  order: CancellationFixtureOrder,
  client: PrismaClient = runtimeServiceClient,
) {
  return createShopCustomerRequest(fixture.member, {
    orderNumber: order.orderNumber,
    type: "PAID_ORDER_CANCELLATION",
    reason: "Annulation client fictive avant expédition pour preuve PostgreSQL locale.",
    address: null,
  }, RUNTIME_NOW, client);
}

export function shopRefundEvidence(
  input: Readonly<{
    attemptId: string;
    provider: "STRIPE" | "PAYPAL";
    providerPaymentId: string;
    amountCents: number;
  }>,
  status: "PENDING" | "SUCCEEDED" | "FAILED" = "SUCCEEDED",
  options: Readonly<{
    applicationCorrelation?: "MATCH" | "MISSING" | "MISMATCH";
    providerRefundId?: string;
  }> = {},
): ShopRefundEvidence {
  return {
    provider: input.provider,
    providerRefundId: options.providerRefundId
      ?? `refund_${input.provider.toLowerCase()}_${input.attemptId}`,
    providerPaymentId: input.providerPaymentId,
    status,
    amountCents: input.amountCents,
    currency: "EUR",
    occurredAt: new Date(RUNTIME_NOW.getTime() + 10_000),
    applicationCorrelation: options.applicationCorrelation ?? "MATCH",
  };
}

type ShopReturnRefundFixture = Readonly<{
  order: CancellationFixtureOrder;
  requestId: string;
  requestNumber: string;
  attemptId: string;
  providerIdempotencyKey: string;
  amountCents: number;
}>;

async function createAuthorizedShopReturnForRefund(
  fixture: CancellationRuntimeFixture,
  sequence: number,
  provider: "STRIPE" | "PAYPAL",
) {
  const order = await createCancellationFixtureOrder(fixture, sequence, { provider });
  const created = await createMemberShopReturn(fixture.member, {
    orderNumber: order.orderNumber,
    type: "NON_CONFORMING",
    comment: "Dossier SAV fictif pour course de revue financière.",
    quantities: new Map([[fixture.productId, 1]]),
  }, RUNTIME_NOW, { client: runtimeServiceClient, assertEnabled: noRuntimeGuard });
  await startShopReturnReview(
    fixture.adminA,
    created.requestNumber,
    RUNTIME_NOW,
    { client: runtimeServiceClient, assertEnabled: noRuntimeGuard },
  );
  await decideShopReturn(fixture.adminA, {
    requestNumber: created.requestNumber,
    decision: "APPROVE",
    authorizedQuantities: new Map([[fixture.productId, 1]]),
    physicalReturnRequired: false,
    returnCostDecision: "MERCHANT",
    instructions: null,
    comment: "Autorisation locale sans remboursement immédiat.",
  }, RUNTIME_NOW, {
    client: runtimeServiceClient,
    assertEnabled: noRuntimeGuard,
    immediateRefund: false,
  });
  return { order, requestId: created.id, requestNumber: created.requestNumber } as const;
}

async function createAuthorizedShopReturnForOrder(
  fixture: CancellationRuntimeFixture,
  order: CancellationFixtureOrder,
  input: Readonly<{ physicalReturnRequired: boolean }> = { physicalReturnRequired: false },
) {
  const created = await createMemberShopReturn(fixture.member, {
    orderNumber: order.orderNumber,
    type: "NON_CONFORMING",
    comment: "Dossier SAV fictif lié à la course d'annulation de la même commande.",
    quantities: new Map([[fixture.productId, 1]]),
  }, RUNTIME_NOW, { client: runtimeServiceClient, assertEnabled: noRuntimeGuard });
  await startShopReturnReview(
    fixture.adminA,
    created.requestNumber,
    RUNTIME_NOW,
    { client: runtimeServiceClient, assertEnabled: noRuntimeGuard },
  );
  await decideShopReturn(fixture.adminA, {
    requestNumber: created.requestNumber,
    decision: "APPROVE",
    authorizedQuantities: new Map([[fixture.productId, 1]]),
    physicalReturnRequired: input.physicalReturnRequired,
    returnCostDecision: "CUSTOMER",
    instructions: input.physicalReturnRequired ? "Retour PostgreSQL local uniquement." : null,
    comment: "Autorisation SAV fictive locale.",
  }, RUNTIME_NOW, {
    client: runtimeServiceClient,
    assertEnabled: noRuntimeGuard,
    immediateRefund: false,
  });
  return created;
}

async function makeShopReturnRestockable(
  fixture: CancellationRuntimeFixture,
  requestNumberValue: string,
) {
  await markShopReturnReceived(
    fixture.adminA,
    requestNumberValue,
    new Map([[fixture.productId, 1]]),
    RUNTIME_NOW,
    { client: runtimeServiceClient, assertEnabled: noRuntimeGuard },
  );
  await inspectShopReturn(fixture.adminA, {
    requestNumber: requestNumberValue,
    lines: new Map([[fixture.productId, {
      condition: "SEALED" as const,
      decision: "RESTOCKABLE" as const,
      restockableQuantity: 1,
      refundableQuantity: 1,
      comment: "Unité fictive restockable.",
    }]]),
  }, RUNTIME_NOW, { client: runtimeServiceClient, assertEnabled: noRuntimeGuard });
}

async function createShopReturnRefundFixture(
  fixture: CancellationRuntimeFixture,
  sequence: number,
  provider: "STRIPE" | "PAYPAL",
  options: Readonly<{
    order?: CancellationFixtureOrder;
    amountCents?: number;
  }> = {},
): Promise<ShopReturnRefundFixture> {
  const order = options.order ?? await createCancellationFixtureOrder(fixture, sequence, { provider });
  assert.equal(order.provider, provider);
  const requestNumber = `LNX-SAV-2099-${sequence.toString(16).toUpperCase().padStart(12, "0")}`;
  const amountCents = options.amountCents ?? 700;
  const request = await prisma.shopReturnRequest.create({ data: {
    requestNumber,
    shopOrderId: order.id,
    userId: fixture.member.id,
    type: "WITHDRAWAL",
    status: "REFUND_PENDING",
    customerComment: "Retour fictif local pour corrélation webhook.",
    adminComment: "Autorisation fictive locale.",
    physicalReturnRequired: false,
    returnCostDecision: "CUSTOMER",
    refundStatus: "PENDING",
    itemsRefundCents: amountCents,
    shippingRefundCents: 0,
    totalRefundCents: amountCents,
    requestedAt: new Date(RUNTIME_NOW.getTime() - 20_000),
    reviewedAt: new Date(RUNTIME_NOW.getTime() - 15_000),
    reviewedByUserId: fixture.adminA.id,
    authorizedAt: new Date(RUNTIME_NOW.getTime() - 15_000),
    refundRequestedAt: RUNTIME_NOW,
    createdAt: new Date(RUNTIME_NOW.getTime() - 20_000),
  } });
  const attemptId = randomUUID();
  const providerIdempotencyKey = `shop-return:${request.id}:provider-refund:v1`;
  await prisma.refundAttempt.create({ data: {
    id: attemptId,
    paymentId: order.paymentId,
    provider,
    source: "ADMIN",
    amountCents,
    currency: "EUR",
    requestedByUserId: fixture.adminA.id,
    shopReturnRequestId: request.id,
    localIdempotencyKey: `shop-return:${request.id}:refund:v1`,
    providerIdempotencyKey,
    status: "PROCESSING",
    attempts: 1,
    lastAttemptAt: RUNTIME_NOW,
  } });
  await prisma.payment.update({ where: { id: order.paymentId }, data: { status: "REFUND_PENDING" } });
  await prisma.paymentAuditEvent.create({ data: {
    paymentId: order.paymentId,
    refundAttemptId: attemptId,
    actorUserId: fixture.adminA.id,
    actorRole: "ADMIN",
    provider,
    action: "REFUND_REQUESTED",
    amountCents,
    result: "PENDING",
  } });
  await prisma.shopReturnAuditEvent.create({ data: {
    shopReturnRequestId: request.id,
    actorUserId: fixture.adminA.id,
    action: "REFUND_REQUESTED",
    idempotencyKey: `shop-return:${request.id}:refund-requested:v1`,
  } });
  return {
    order,
    requestId: request.id,
    requestNumber,
    attemptId,
    providerIdempotencyKey,
    amountCents,
  };
}

function shopReturnWebhookIdentity(fixture: ShopReturnRefundFixture): RefundWebhookIdentity {
  return {
    attemptId: fixture.attemptId,
    paymentId: fixture.order.paymentId,
    provider: fixture.order.provider,
    providerPaymentId: fixture.order.providerPaymentId,
    providerIdempotencyKey: fixture.providerIdempotencyKey,
    amountCents: fixture.amountCents,
  };
}

async function assertSingleShopReturnRefundEffects(fixture: ShopReturnRefundFixture) {
  const [attempt, request, payment, creditNotes, notifications, stockAdjustments] = await Promise.all([
    prisma.refundAttempt.findUniqueOrThrow({ where: { id: fixture.attemptId } }),
    prisma.shopReturnRequest.findUniqueOrThrow({ where: { id: fixture.requestId } }),
    prisma.payment.findUniqueOrThrow({ where: { id: fixture.order.paymentId } }),
    prisma.creditNote.findMany({ where: { shopReturnRequestId: fixture.requestId } }),
    prisma.orderNotification.count({ where: {
      shopReturnRequestId: fixture.requestId,
      kind: "CUSTOMER_SHOP_REFUND_CONFIRMED",
    } }),
    prisma.productStockAdjustment.count({ where: { shopReturnRequestId: fixture.requestId } }),
  ]);
  assert.deepEqual([attempt.status, request.status, request.refundStatus], ["SUCCEEDED", "REFUNDED", "SUCCEEDED"]);
  assert.deepEqual([payment.status, payment.refundedAmountCents], ["PARTIALLY_REFUNDED", fixture.amountCents]);
  assert.equal(creditNotes.length, 1);
  assert.equal(creditNotes[0]!.amountCents, fixture.amountCents);
  assert.equal(notifications, 1);
  assert.equal(stockAdjustments, 0, "SAV refund finalization must remain independent from restock");
}

type RefundWebhookIdentity = Readonly<{
  attemptId: string;
  paymentId: string;
  provider: "STRIPE" | "PAYPAL";
  providerPaymentId: string;
  providerIdempotencyKey: string;
  amountCents: number;
}>;

function stripeRefundWebhook(
  identity: RefundWebhookIdentity,
  eventId: string,
  input: Readonly<{
    status?: "pending" | "succeeded" | "failed";
    amountCents?: number;
    includeApplicationMetadata?: boolean;
    providerRefundId?: string;
  }> = {},
) {
  const status = input.status ?? "succeeded";
  return {
    id: eventId,
    type: status === "failed" ? "refund.failed" : "refund.updated",
    livemode: false,
    created: Math.floor((RUNTIME_NOW.getTime() + 20_000) / 1_000),
    data: { object: {
      id: input.providerRefundId ?? shopRefundEvidence(identity).providerRefundId,
      object: "refund",
      payment_intent: identity.providerPaymentId,
      amount: input.amountCents ?? identity.amountCents,
      currency: "eur",
      status,
      ...(input.includeApplicationMetadata === false ? {} : {
        metadata: {
          paymentId: identity.paymentId,
          refundAttemptId: identity.attemptId,
        },
      }),
    } },
  } as const;
}

function paypalRefundWebhook(
  identity: RefundWebhookIdentity,
  eventId: string,
  eventType: "PAYMENT.CAPTURE.REFUNDED" | "PAYMENT.REFUND.PENDING" | "PAYMENT.REFUND.FAILED",
  input: Readonly<{
    amountCents?: number;
    includeApplicationReference?: boolean;
    applicationReference?: string;
    providerRefundId?: string;
  }> = {},
) {
  const amountCents = input.amountCents ?? identity.amountCents;
  const status = eventType === "PAYMENT.CAPTURE.REFUNDED"
    ? "COMPLETED"
    : eventType === "PAYMENT.REFUND.PENDING"
      ? "PENDING"
      : "FAILED";
  return {
    id: eventId,
    event_type: eventType,
    create_time: new Date(RUNTIME_NOW.getTime() + 20_000).toISOString(),
    resource: {
      id: input.providerRefundId ?? shopRefundEvidence(identity).providerRefundId,
      status,
      ...(input.includeApplicationReference === false ? {} : {
        invoice_id: input.applicationReference
          ?? paypalRefundApplicationReference(identity.providerIdempotencyKey),
      }),
      amount: {
        currency_code: "EUR",
        value: `${Math.floor(amountCents / 100)}.${String(amountCents % 100).padStart(2, "0")}`,
      },
      update_time: new Date(RUNTIME_NOW.getTime() + 20_000).toISOString(),
      links: [{
        rel: "up",
        method: "GET",
        href: `https://api-m.sandbox.paypal.com/v2/payments/captures/${encodeURIComponent(identity.providerPaymentId)}`,
      }],
    },
  } as const;
}

async function processFixtureRefundEvent(
  provider: "STRIPE" | "PAYPAL",
  event: ReturnType<typeof stripeRefundWebhook> | ReturnType<typeof paypalRefundWebhook>,
) {
  return provider === "STRIPE"
    ? processVerifiedStripeFinancialEvent(event as ReturnType<typeof stripeRefundWebhook>)
    : processVerifiedPaypalFinancialEvent(event as ReturnType<typeof paypalRefundWebhook>);
}

function refundWebhookIdentity(
  input: Parameters<ShopRefundGateway["request"]>[0],
): RefundWebhookIdentity {
  return {
    attemptId: input.attemptId,
    paymentId: input.paymentId,
    provider: input.provider,
    providerPaymentId: input.providerPaymentId,
    providerIdempotencyKey: input.idempotencyKey,
    amountCents: input.amountCents,
  };
}

function delayedRefundGateway() {
  const entered = deferred<Parameters<ShopRefundGateway["request"]>[0]>();
  const released = deferred<"SUCCEEDED" | "PENDING" | "FAILED">();
  let requestCalls = 0;
  let retrieveCalls = 0;
  const gateway: ShopRefundGateway = {
    async request(input) {
      requestCalls += 1;
      entered.resolve(input);
      return shopRefundEvidence(input, await released.promise);
    },
    async retrieve(input) {
      retrieveCalls += 1;
      return shopRefundEvidence(input, "SUCCEEDED");
    },
  };
  return {
    gateway,
    entered: entered.promise,
    release(status: "SUCCEEDED" | "PENDING" | "FAILED" = "SUCCEEDED") {
      released.resolve(status);
    },
    counts() { return { requestCalls, retrieveCalls }; },
  };
}

function delayedAmbiguousRefundGateway() {
  const entered = deferred<Parameters<ShopRefundGateway["request"]>[0]>();
  const released = deferred<void>();
  let requestCalls = 0;
  const gateway: ShopRefundGateway = {
    async request(input) {
      requestCalls += 1;
      entered.resolve(input);
      await released.promise;
      throw new ShopRefundGatewayError("AMBIGUOUS");
    },
    async retrieve() {
      throw new Error("retrieve must not be called");
    },
  };
  return {
    gateway,
    entered: entered.promise,
    release() { released.resolve(); },
    calls: () => requestCalls,
  };
}

function immediateRefundGateway(
  behavior: "SUCCEEDED" | "PENDING" | "FAILED" | "AMBIGUOUS" = "SUCCEEDED",
) {
  let requestCalls = 0;
  let retrieveCalls = 0;
  const gateway: ShopRefundGateway = {
    async request(input) {
      requestCalls += 1;
      if (behavior === "AMBIGUOUS") throw new ShopRefundGatewayError("AMBIGUOUS");
      return shopRefundEvidence(input, behavior);
    },
    async retrieve(input) {
      retrieveCalls += 1;
      if (behavior === "AMBIGUOUS") throw new ShopRefundGatewayError("AMBIGUOUS");
      return shopRefundEvidence(input, behavior === "PENDING" ? "SUCCEEDED" : behavior);
    },
  };
  return { gateway, counts: () => ({ requestCalls, retrieveCalls }) };
}

function delayedShippingProvider() {
  const entered = deferred<ShippingProviderCreateInput>();
  const released = deferred<void>();
  let createCalls = 0;
  const result = (input: ShippingProviderCreateInput): ShippingProviderResult => ({
    status: "SUCCEEDED",
    providerShipmentId: `SHIP-${digest(input.idempotencyKey).slice(0, 20).toUpperCase()}`,
    tracking: {
      carrier: "Transporteur QA",
      number: `TRACK-${digest(input.orderNumber).slice(0, 20).toUpperCase()}`,
      url: `https://tracking.example.invalid/${digest(input.orderNumber).slice(0, 20)}`,
    },
    errorCode: null,
  });
  const provider: ShippingProviderAdapter = {
    name: "FAKE_LOCAL",
    async createShipment(input) {
      createCalls += 1;
      entered.resolve(input);
      await released.promise;
      return result(input);
    },
    async reconcileShipment(input) {
      return result({
        orderNumber: input.orderNumber,
        idempotencyKey: input.idempotencyKey,
        scenario: input.scenario,
        service: "STANDARD_TRACKED_SIGNATURE",
        billableGrams: 250,
        destination: { countryCode: "FR", postalCode: "75005" },
      });
    },
  };
  return {
    provider,
    entered: entered.promise,
    release() { released.resolve(); },
    calls: () => createCalls,
  };
}

function observedAdvisoryLockClient(client: PrismaClient, attempted: Deferred<void>) {
  return new Proxy(client, {
    get(target, property) {
      if (property === "$transaction") {
        return async (
          operation: (transactionClient: Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0]) => Promise<unknown>,
          options?: Parameters<PrismaClient["$transaction"]>[1],
        ) => {
          // This barrier proves that a second, independent Prisma worker has
          // entered its own transaction while the winning transaction's
          // advisory lock is still proven held with pg_try_advisory_xact_lock.
          attempted.resolve();
          return target.$transaction(operation, options);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
  }) as unknown as PrismaClient;
}

async function assertOrderLockHeld(observer: PrismaClient, shopOrderId: string) {
  const key = `${SHOP_ORDER_MUTATION_LOCK_PREFIX}:${shopOrderId}`;
  const available = await observer.$transaction(async (transaction) => {
    const rows = await transaction.$queryRaw<Array<{ acquired: boolean }>>`
      SELECT pg_try_advisory_xact_lock(hashtext(${key})) AS acquired
    `;
    return rows[0]?.acquired;
  });
  assert.equal(available, false, "the shipping worker must hold the shared PostgreSQL order lock");
}

async function assertRefundAttemptLockHeld(observer: PrismaClient, refundAttemptId: string) {
  const key = `shop-after-sales:refund:${refundAttemptId}`;
  const available = await observer.$transaction(async (transaction) => {
    const rows = await transaction.$queryRaw<Array<{ acquired: boolean }>>`
      SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS acquired
    `;
    return rows[0]?.acquired;
  });
  assert.equal(available, false, "the refund worker must hold the shared PostgreSQL attempt lock");
}

async function waitForAdvisoryWaiter(observer: PrismaClient, minimum = 1) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const rows = await observer.$queryRaw<Array<{ waiting: bigint }>>`
      SELECT COUNT(*)::bigint AS waiting
      FROM pg_locks
      WHERE locktype = 'advisory' AND granted = false
    `;
    if ((rows[0]?.waiting ?? 0n) >= BigInt(minimum)) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`expected ${minimum} PostgreSQL worker(s) waiting on advisory locks`);
}

async function assertProductStockLockHeld(observer: PrismaClient, productId: string) {
  const key = `shop-product:${productId}`;
  const available = await observer.$transaction(async (transaction) => {
    const rows = await transaction.$queryRaw<Array<{ acquired: boolean }>>`
      SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS acquired
    `;
    return rows[0]?.acquired;
  });
  assert.equal(available, false, "the blocker must hold the shared Shop product stock lock");
}

async function assertProductStockLockAvailable(observer: PrismaClient, productId: string) {
  const key = `shop-product:${productId}`;
  const available = await observer.$transaction(async (transaction) => {
    const rows = await transaction.$queryRaw<Array<{ acquired: boolean }>>`
      SELECT pg_try_advisory_xact_lock(hashtextextended(${key}, 0)) AS acquired
    `;
    return rows[0]?.acquired;
  });
  assert.equal(available, true, "no worker may acquire a later product lock before the shared first key");
}

async function expectFulfillmentBarrier(operation: () => Promise<unknown>) {
  await assert.rejects(
    operation,
    (error: unknown) => error instanceof ShopFulfillmentError && error.code === "CANCELLATION_IN_PROGRESS",
  );
}

async function assertSingleCancellationEffects(
  fixture: CancellationRuntimeFixture,
  order: CancellationFixtureOrder,
  requestId: string,
  stockBefore: number,
) {
  const [state, attempt, notes, adjustments, product, notifications] = await Promise.all([
    prisma.shopOrder.findUniqueOrThrow({ where: { id: order.id } }),
    prisma.refundAttempt.findUniqueOrThrow({ where: { shopCustomerRequestId: requestId } }),
    prisma.creditNote.findMany({ where: { invoiceId: order.invoiceId } }),
    prisma.productStockAdjustment.findMany({ where: { shopCustomerRequestId: requestId } }),
    prisma.product.findUniqueOrThrow({ where: { id: fixture.productId } }),
    prisma.orderNotification.count({
      where: { shopOrderId: order.id, kind: "CUSTOMER_SHOP_CANCELLATION_APPROVED" },
    }),
  ]);
  assert.deepEqual(
    [state.status, state.paymentStatus, state.fulfillmentStatus],
    ["CANCELLED", "CANCELLED", "CANCELLED"],
  );
  assert.deepEqual(
    [state.preparingAt, state.readyToShipAt, state.shippedAt, state.shippingCarrier,
      state.trackingNumber, state.trackingUrl, state.trackingSource, state.trackingRecordedAt,
      state.trackingRevision],
    [null, null, null, null, null, null, null, null, 0],
  );
  assert.equal(attempt.status, "SUCCEEDED");
  assert.ok(attempt.providerRefundId);
  assert.equal(notes.length, 1);
  assert.equal(notes[0]!.reasonCode, "WITHDRAWAL");
  assert.match(notes[0]!.reasonText ?? "", /Annulation demandée par le client avant expédition/);
  assert.equal(adjustments.length, 1);
  assert.equal(adjustments[0]!.delta, 1);
  assert.equal(product.stock, stockBefore + 1);
  assert.equal(notifications, 1);
}

async function shippingWinsScenario(fixture: CancellationRuntimeFixture) {
  const order = await createCancellationFixtureOrder(fixture, 990001, { fulfillment: "READY_TRACKED" });
  const request = await createCancellationRequest(fixture, order);
  const shippingClient = isolatedCancellationRuntimeClient("shipping-winner");
  const cancellationClient = isolatedCancellationRuntimeClient("shipping-loser");
  const cancellationLockAttempted = deferred<void>();
  const observedCancellationClient = observedAdvisoryLockClient(cancellationClient, cancellationLockAttempted);
  const observer = isolatedCancellationRuntimeClient("shipping-observer");
  const releaseClient = isolatedCancellationRuntimeClient("shipping-release-barrier");
  const transactionFinished = deferred<void>();
  const releaseBarrierKey = `lnx-cancel-runtime:shipping-release:${order.id}`;
  const refund = immediateRefundGateway("SUCCEEDED");
  let barrierHeld = false;
  try {
    await releaseClient.$queryRaw`
      SELECT pg_advisory_lock(hashtext(${releaseBarrierKey})) IS NULL AS locked
    `;
    barrierHeld = true;
    const shipping = markShopOrderShipped(
      order.orderNumber,
      fixture.adminA.id,
      new Date(RUNTIME_NOW.getTime() + 5_000),
      {
        client: shippingClient,
        assertEnabled: noRuntimeGuard,
        beforeCommitForTesting: async (transaction) => {
          transactionFinished.resolve();
          await transaction.$queryRaw`
            SELECT pg_advisory_xact_lock(hashtext(${releaseBarrierKey})) IS NULL AS locked
          `;
        },
      },
    ).then(
      (value) => ({ value, error: null as unknown }),
      (error: unknown) => ({ value: null, error }),
    );
    await transactionFinished.promise;
    await assertOrderLockHeld(observer, order.id);
    const cancellationOutcome = decideShopCustomerRequest(
      fixture.adminB,
      request.requestNumber,
      "APPROVE",
      "Annulation concurrente après remise au transporteur.",
      refund.gateway,
      RUNTIME_NOW,
      observedCancellationClient,
    ).then(
      (value) => ({ value, error: null as unknown }),
      (error: unknown) => ({ value: null, error }),
    );
    await cancellationLockAttempted.promise;
    await waitForAdvisoryWaiter(observer);
    assert.equal(refund.counts().requestCalls, 0);
    const released = await releaseClient.$queryRaw<Array<{ released: boolean }>>`
      SELECT pg_advisory_unlock(hashtext(${releaseBarrierKey})) AS released
    `;
    assert.equal(released[0]?.released, true);
    barrierHeld = false;
    const shipment = await shipping;
    if (shipment.error) throw shipment.error;
    assert.equal(shipment.value?.fulfillmentStatus, "SHIPPED");
    const cancellation = await cancellationOutcome;
    assert.ok(
      cancellation.error instanceof ShopCustomerRequestError
      && cancellation.error.code === "ORDER_NOT_ELIGIBLE",
    );
    assert.equal(await prisma.refundAttempt.count({ where: { shopCustomerRequestId: request.id } }), 0);
    return "PASS" as const;
  } finally {
    if (barrierHeld) {
      await releaseClient.$queryRaw`
        SELECT pg_advisory_unlock(hashtext(${releaseBarrierKey})) AS released
      `;
    }
    await Promise.all([
      shippingClient.$disconnect(),
      cancellationClient.$disconnect(),
      observer.$disconnect(),
      releaseClient.$disconnect(),
    ]);
  }
}

async function cancellationWinsScenario(fixture: CancellationRuntimeFixture) {
  const order = await createCancellationFixtureOrder(fixture, 990002, {
    provider: "PAYPAL",
    fulfillment: "READY_TO_SHIP",
  });
  const request = await createCancellationRequest(fixture, order);
  const cancellationClient = isolatedCancellationRuntimeClient("cancellation-winner");
  const logisticsClient = isolatedCancellationRuntimeClient("cancellation-logistics-loser");
  const refund = delayedRefundGateway();
  const shipping = delayedShippingProvider();
  const stockBefore = (await prisma.product.findUniqueOrThrow({ where: { id: fixture.productId } })).stock!;
  try {
    const cancellation = decideShopCustomerRequest(
      fixture.adminA,
      request.requestNumber,
      "APPROVE",
      "Annulation totale avant expédition, livraison comprise.",
      refund.gateway,
      RUNTIME_NOW,
      cancellationClient,
    );
    await refund.entered;
    assert.equal((await prisma.refundAttempt.findUniqueOrThrow({
      where: { shopCustomerRequestId: request.id },
    })).status, "PROCESSING");

    await expectFulfillmentBarrier(() => markShopOrderPreparing(
      order.orderNumber, fixture.adminB.id, RUNTIME_NOW,
      { client: logisticsClient, assertEnabled: noRuntimeGuard },
    ));
    await expectFulfillmentBarrier(() => markShopOrderReadyToShip(
      order.orderNumber, fixture.adminB.id, RUNTIME_NOW,
      { client: logisticsClient, assertEnabled: noRuntimeGuard },
    ));
    await expectFulfillmentBarrier(() => recordShopOrderTracking(
      order.orderNumber,
      fixture.adminB.id,
      { carrier: "Transporteur QA", trackingNumber: "SHOULD-NOT-EXIST", trackingUrl: null },
      RUNTIME_NOW,
      { client: logisticsClient, assertEnabled: noRuntimeGuard },
    ));
    await expectFulfillmentBarrier(() => markShopOrderShipped(
      order.orderNumber, fixture.adminB.id, RUNTIME_NOW,
      { client: logisticsClient, assertEnabled: noRuntimeGuard },
    ));
    await assert.rejects(
      () => createShopShippingProviderAttempt(
        order.orderNumber,
        fixture.adminB.id,
        "SUCCEEDED",
        RUNTIME_NOW,
        { client: logisticsClient, provider: shipping.provider, assertEnabled: noRuntimeGuard },
      ),
      (error: unknown) => error instanceof ShopShippingProviderError && error.code === "CANCELLATION_IN_PROGRESS",
    );
    assert.equal(shipping.calls(), 0);
    refund.release("SUCCEEDED");
    assert.equal(await cancellation, "SUCCEEDED");
    await assertSingleCancellationEffects(fixture, order, request.id, stockBefore);
    return "PASS" as const;
  } finally {
    refund.release("SUCCEEDED");
    await Promise.all([cancellationClient.$disconnect(), logisticsClient.$disconnect()]);
  }
}

async function ambiguousResultScenario(fixture: CancellationRuntimeFixture) {
  const order = await createCancellationFixtureOrder(fixture, 990003, { fulfillment: "PENDING" });
  const request = await createCancellationRequest(fixture, order);
  const refund = immediateRefundGateway("AMBIGUOUS");
  assert.equal(await decideShopCustomerRequest(
    fixture.adminA, request.requestNumber, "APPROVE", "Résultat ambigu simulé.",
    refund.gateway, RUNTIME_NOW, runtimeServiceClient,
  ), "REQUIRES_REVIEW");
  const attempt = await prisma.refundAttempt.findUniqueOrThrow({ where: { shopCustomerRequestId: request.id } });
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: order.paymentId } });
  assert.deepEqual(
    [attempt.status, attempt.failureCode, payment.status, payment.refundedAmountCents],
    ["REQUIRES_REVIEW", "AMBIGUOUS_PROVIDER_ACCEPTANCE", "REFUND_PENDING", 0],
  );
  assert.equal(await prisma.creditNote.count({ where: { invoiceId: order.invoiceId } }), 0);
  assert.equal(await prisma.productStockAdjustment.count({ where: { shopCustomerRequestId: request.id } }), 0);
  await expectFulfillmentBarrier(() => markShopOrderPreparing(
    order.orderNumber, fixture.adminB.id, RUNTIME_NOW,
    { client: prisma, assertEnabled: noRuntimeGuard },
  ));
  return "PASS" as const;
}

async function doubleAcceptanceScenario(fixture: CancellationRuntimeFixture) {
  const order = await createCancellationFixtureOrder(fixture, 990004, { provider: "STRIPE" });
  const request = await createCancellationRequest(fixture, order);
  const clientA = isolatedCancellationRuntimeClient("double-a");
  const clientB = isolatedCancellationRuntimeClient("double-b");
  const refund = delayedRefundGateway();
  const stockBefore = (await prisma.product.findUniqueOrThrow({ where: { id: fixture.productId } })).stock!;
  try {
    const first = decideShopCustomerRequest(
      fixture.adminA, request.requestNumber, "APPROVE", "Première décision concurrente.",
      refund.gateway, RUNTIME_NOW, clientA,
    );
    await refund.entered;
    const second = await decideShopCustomerRequest(
      fixture.adminB, request.requestNumber, "APPROVE", "Seconde décision concurrente.",
      refund.gateway, RUNTIME_NOW, clientB,
    );
    assert.equal(second, "PENDING");
    assert.equal(refund.counts().requestCalls, 1);
    assert.equal(await prisma.refundAttempt.count({ where: { shopCustomerRequestId: request.id } }), 1);
    refund.release("SUCCEEDED");
    assert.equal(await first, "SUCCEEDED");
    assert.equal(refund.counts().requestCalls, 1);
    await assertSingleCancellationEffects(fixture, order, request.id, stockBefore);
    return "PASS" as const;
  } finally {
    refund.release("SUCCEEDED");
    await Promise.all([clientA.$disconnect(), clientB.$disconnect()]);
  }
}

async function certainProviderRefusalScenario(fixture: CancellationRuntimeFixture) {
  const order = await createCancellationFixtureOrder(fixture, 990005, { fulfillment: "PENDING" });
  const request = await createCancellationRequest(fixture, order);
  let providerCalls = 0;
  const gateway: ShopRefundGateway = {
    async request() {
      providerCalls += 1;
      throw new ShopRefundGatewayError("FAILED");
    },
    async retrieve() {
      throw new Error("retrieve must not be called");
    },
  };
  assert.equal(await decideShopCustomerRequest(
    fixture.adminA, request.requestNumber, "APPROVE", "Refus certain simulé.",
    gateway, RUNTIME_NOW, runtimeServiceClient,
  ), "FAILED");
  const [attempt, payment] = await Promise.all([
    prisma.refundAttempt.findUniqueOrThrow({ where: { shopCustomerRequestId: request.id } }),
    prisma.payment.findUniqueOrThrow({ where: { id: order.paymentId } }),
  ]);
  assert.deepEqual(
    [attempt.status, attempt.providerRefundId, attempt.confirmedAt, payment.status],
    ["FAILED", null, null, "SUCCEEDED"],
  );
  assert.equal(providerCalls, 1);
  assert.equal((await markShopOrderPreparing(
    order.orderNumber, fixture.adminB.id, RUNTIME_NOW,
    { client: prisma, assertEnabled: noRuntimeGuard },
  )).fulfillmentStatus, "PREPARING");
  assert.equal(await prisma.creditNote.count({ where: { invoiceId: order.invoiceId } }), 0);
  return "PASS" as const;
}

async function preparingCleanupScenario(fixture: CancellationRuntimeFixture) {
  const order = await createCancellationFixtureOrder(fixture, 990006, {
    provider: "STRIPE",
    fulfillment: "PREPARING",
  });
  const request = await createCancellationRequest(fixture, order);
  const refund = immediateRefundGateway("SUCCEEDED");
  const stockBefore = (await prisma.product.findUniqueOrThrow({ where: { id: fixture.productId } })).stock!;
  assert.equal(await decideShopCustomerRequest(
    fixture.adminA, request.requestNumber, "APPROVE", "Annulation depuis PREPARING.",
    refund.gateway, RUNTIME_NOW, runtimeServiceClient,
  ), "SUCCEEDED");
  await assertSingleCancellationEffects(fixture, order, request.id, stockBefore);
  return "PASS" as const;
}

async function unresolvedShippingIntentScenario(fixture: CancellationRuntimeFixture) {
  const order = await createCancellationFixtureOrder(fixture, 990007, { fulfillment: "READY_TO_SHIP" });
  const request = await createCancellationRequest(fixture, order);
  const logisticsClient = isolatedCancellationRuntimeClient("provider-shipping");
  const cancellationClient = isolatedCancellationRuntimeClient("provider-cancellation");
  const shipping = delayedShippingProvider();
  const refund = immediateRefundGateway("SUCCEEDED");
  try {
    const shippingOperation = createShopShippingProviderAttempt(
      order.orderNumber,
      fixture.adminA.id,
      "SUCCEEDED",
      RUNTIME_NOW,
      { client: logisticsClient, provider: shipping.provider, assertEnabled: noRuntimeGuard },
    );
    await shipping.entered;
    await assert.rejects(
      () => decideShopCustomerRequest(
        fixture.adminB, request.requestNumber, "APPROVE", "Doit attendre la logistique déjà engagée.",
        refund.gateway, RUNTIME_NOW, cancellationClient,
      ),
      (error: unknown) => error instanceof ShopCustomerRequestError && error.code === "REFUND_REQUIRES_REVIEW",
    );
    assert.equal(refund.counts().requestCalls, 0);
    assert.equal(await prisma.refundAttempt.count({ where: { shopCustomerRequestId: request.id } }), 0);
    shipping.release();
    assert.equal((await shippingOperation).status, "SUCCEEDED");
    return "PASS" as const;
  } finally {
    shipping.release();
    await Promise.all([logisticsClient.$disconnect(), cancellationClient.$disconnect()]);
  }
}

async function sharedRefundCapacityScenario(fixture: CancellationRuntimeFixture) {
  const order = await createCancellationFixtureOrder(fixture, 990008);
  const request = await createCancellationRequest(fixture, order);
  await prisma.refundAttempt.create({ data: {
    paymentId: order.paymentId,
    provider: order.provider,
    source: "ADMIN",
    amountCents: 100,
    currency: "EUR",
    requestedByUserId: fixture.adminA.id,
    localIdempotencyKey: `capacity-runtime:${order.id}:local`,
    providerIdempotencyKey: `capacity-runtime:${order.id}:provider`,
    status: "PENDING",
    attempts: 1,
    lastAttemptAt: RUNTIME_NOW,
  } });
  await prisma.payment.update({ where: { id: order.paymentId }, data: { status: "REFUND_PENDING" } });
  const refund = immediateRefundGateway("SUCCEEDED");
  await assert.rejects(
    () => decideShopCustomerRequest(
      fixture.adminB, request.requestNumber, "APPROVE", "Capacité déjà réservée par le SAV.",
      refund.gateway, RUNTIME_NOW, runtimeServiceClient,
    ),
    (error: unknown) => error instanceof ShopCustomerRequestError && error.code === "REFUND_REQUIRES_REVIEW",
  );
  assert.equal(refund.counts().requestCalls, 0);
  assert.equal(await prisma.refundAttempt.count({ where: { shopCustomerRequestId: request.id } }), 0);
  return "PASS" as const;
}

async function installCreditNoteFailureTrigger() {
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION lnx_test_reject_cancellation_credit_note() RETURNS trigger AS $$
    BEGIN
      RAISE EXCEPTION 'LNX_TEST_CANCELLATION_CREDIT_NOTE_FAILURE';
    END;
    $$ LANGUAGE plpgsql
  `);
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS lnx_test_reject_cancellation_credit_note ON credit_notes`);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER lnx_test_reject_cancellation_credit_note
    BEFORE INSERT ON credit_notes
    FOR EACH ROW EXECUTE FUNCTION lnx_test_reject_cancellation_credit_note()
  `);
}

async function removeCreditNoteFailureTrigger() {
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS lnx_test_reject_cancellation_credit_note ON credit_notes`);
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS lnx_test_reject_cancellation_credit_note()`);
}

async function installOneShotProviderReceiptFailureTrigger() {
  await prisma.$executeRawUnsafe(`CREATE SEQUENCE lnx_test_provider_receipt_failure_sequence`);
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION lnx_test_reject_first_provider_receipt() RETURNS trigger AS $$
    BEGIN
      IF nextval('lnx_test_provider_receipt_failure_sequence') = 1 THEN
        RAISE EXCEPTION 'LNX_TEST_PROVIDER_RECEIPT_FAILURE';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS lnx_test_reject_first_provider_receipt ON provider_events`);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER lnx_test_reject_first_provider_receipt
    BEFORE INSERT ON provider_events
    FOR EACH ROW EXECUTE FUNCTION lnx_test_reject_first_provider_receipt()
  `);
}

async function removeOneShotProviderReceiptFailureTrigger() {
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS lnx_test_reject_first_provider_receipt ON provider_events`);
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS lnx_test_reject_first_provider_receipt()`);
  await prisma.$executeRawUnsafe(`DROP SEQUENCE IF EXISTS lnx_test_provider_receipt_failure_sequence`);
}

async function accountingFailureThenReconciliationScenario(fixture: CancellationRuntimeFixture) {
  const order = await createCancellationFixtureOrder(fixture, 990009, { provider: "PAYPAL" });
  const request = await createCancellationRequest(fixture, order);
  const refund = immediateRefundGateway("SUCCEEDED");
  const stockBefore = (await prisma.product.findUniqueOrThrow({ where: { id: fixture.productId } })).stock!;
  await installCreditNoteFailureTrigger();
  try {
    assert.equal(await decideShopCustomerRequest(
      fixture.adminA, request.requestNumber, "APPROVE", "Échec comptable injecté.",
      refund.gateway, RUNTIME_NOW, runtimeServiceClient,
    ), "REQUIRES_REVIEW");
  } finally {
    await removeCreditNoteFailureTrigger();
  }
  const review = await prisma.refundAttempt.findUniqueOrThrow({
    where: { shopCustomerRequestId: request.id },
    include: { payment: true },
  });
  assert.equal(review.status, "REQUIRES_REVIEW");
  assert.equal(review.failureCode, "PROVIDER_ACCEPTED_LOCAL_FINALIZATION_FAILED");
  assert.ok(review.providerRefundId && review.confirmedAt);
  assert.equal(review.payment.refundedAmountCents, 0);
  assert.equal(review.payment.status, "REFUND_PENDING");
  assert.equal(await prisma.creditNote.count({ where: { invoiceId: order.invoiceId } }), 0);
  assert.equal(await prisma.productStockAdjustment.count({ where: { shopCustomerRequestId: request.id } }), 0);
  await expectFulfillmentBarrier(() => markShopOrderPreparing(
    order.orderNumber, fixture.adminB.id, RUNTIME_NOW,
    { client: prisma, assertEnabled: noRuntimeGuard },
  ));
  assert.equal(await reconcileShopCustomerRequestRefund(
    fixture.adminA, request.requestNumber, refund.gateway, runtimeServiceClient,
  ), "SUCCEEDED");
  assert.equal(refund.counts().requestCalls, 1);
  assert.equal(refund.counts().retrieveCalls, 1);
  await assertSingleCancellationEffects(fixture, order, request.id, stockBefore);
  return "PASS" as const;
}

async function sellerErrorReasonRemainsAvailableScenario(fixture: CancellationRuntimeFixture) {
  const order = await createCancellationFixtureOrder(fixture, 990010, { provider: "STRIPE" });
  const attempt = await prisma.refundAttempt.create({ data: {
    paymentId: order.paymentId,
    provider: order.provider,
    source: "ADMIN",
    amountCents: order.amountCents,
    currency: "EUR",
    requestedByUserId: fixture.adminA.id,
    localIdempotencyKey: `seller-error-runtime:${order.id}:local`,
    providerRefundId: `seller-error-runtime-refund-${order.id}`,
    providerIdempotencyKey: `seller-error-runtime:${order.id}:provider`,
    status: "SUCCEEDED",
    attempts: 1,
    lastAttemptAt: RUNTIME_NOW,
    confirmedAt: RUNTIME_NOW,
  } });
  await prisma.payment.update({ where: { id: order.paymentId }, data: {
    status: "REFUNDED", refundedAmountCents: order.amountCents, refundedAt: RUNTIME_NOW,
  } });
  const result = await prisma.$transaction((transaction) => issueCreditNoteForRefund(transaction, {
    refundAttemptId: attempt.id,
    reasonCode: "SELLER_ERROR",
    reasonText: "Erreur vendeur réelle fictive, distincte d’une annulation client.",
  }));
  assert.equal(result.creditNote.reasonCode, "SELLER_ERROR");
  return "PASS" as const;
}

async function stripeWebhookBeforeApiResponseScenario(fixture: CancellationRuntimeFixture) {
  const order = await createCancellationFixtureOrder(fixture, 990011, { provider: "STRIPE" });
  const request = await createCancellationRequest(fixture, order);
  const client = isolatedCancellationRuntimeClient("stripe-webhook-first");
  const refund = delayedRefundGateway();
  const stockBefore = (await prisma.product.findUniqueOrThrow({ where: { id: fixture.productId } })).stock!;
  try {
    const decision = decideShopCustomerRequest(
      fixture.adminA, request.requestNumber, "APPROVE", "Webhook Stripe avant réponse API.",
      refund.gateway, RUNTIME_NOW, client,
    );
    const identity = refundWebhookIdentity(await refund.entered);
    const event = stripeRefundWebhook(identity, "evt_cancel_stripe_webhook_first");
    assert.deepEqual(await processVerifiedStripeFinancialEvent(event), {
      outcome: "PROCESSED", duplicate: false,
    });
    assert.deepEqual(await processVerifiedStripeFinancialEvent(event), {
      outcome: "PROCESSED", duplicate: true,
    });
    refund.release("SUCCEEDED");
    assert.equal(await decision, "SUCCEEDED");
    assert.deepEqual(refund.counts(), { requestCalls: 1, retrieveCalls: 0 });
    await assertSingleCancellationEffects(fixture, order, request.id, stockBefore);
    const [providerEvents, state, reviews] = await Promise.all([
      prisma.providerEvent.findMany({ where: { refundAttemptId: identity.attemptId } }),
      prisma.shopOrder.findUniqueOrThrow({ where: { id: order.id } }),
      prisma.shopOrderLifecycleEvent.count({ where: {
        shopOrderId: order.id,
        type: "SHOP_PAYMENT_REQUIRES_REVIEW",
      } }),
    ]);
    assert.equal(providerEvents.length, 1);
    assert.equal(providerEvents[0]!.outcome, "PROCESSED");
    assert.equal(state.paymentReviewAt, null);
    assert.equal(reviews, 0);
    return "PASS" as const;
  } finally {
    refund.release("SUCCEEDED");
    await client.$disconnect();
  }
}

async function paypalPendingThenCompletedScenario(fixture: CancellationRuntimeFixture) {
  const order = await createCancellationFixtureOrder(fixture, 990012, { provider: "PAYPAL" });
  const request = await createCancellationRequest(fixture, order);
  const client = isolatedCancellationRuntimeClient("paypal-pending-completed");
  const refund = delayedRefundGateway();
  const stockBefore = (await prisma.product.findUniqueOrThrow({ where: { id: fixture.productId } })).stock!;
  try {
    const decision = decideShopCustomerRequest(
      fixture.adminA, request.requestNumber, "APPROVE", "PayPal pending puis completed.",
      refund.gateway, RUNTIME_NOW, client,
    );
    const identity = refundWebhookIdentity(await refund.entered);
    const pending = paypalRefundWebhook(
      identity,
      "WH-CANCEL-PAYPAL-PENDING",
      "PAYMENT.REFUND.PENDING",
    );
    assert.equal((await processVerifiedPaypalFinancialEvent(pending)).outcome, "PROCESSED");
    assert.equal((await prisma.refundAttempt.findUniqueOrThrow({ where: { id: identity.attemptId } })).status, "PENDING");
    assert.equal(await prisma.creditNote.count({ where: { invoiceId: order.invoiceId } }), 0);
    refund.release("PENDING");
    assert.equal(await decision, "PENDING");

    const completed = paypalRefundWebhook(
      identity,
      "WH-CANCEL-PAYPAL-COMPLETED",
      "PAYMENT.CAPTURE.REFUNDED",
    );
    assert.deepEqual(await processVerifiedPaypalFinancialEvent(completed), {
      outcome: "PROCESSED", duplicate: false,
    });
    assert.deepEqual(await processVerifiedPaypalFinancialEvent(completed), {
      outcome: "PROCESSED", duplicate: true,
    });
    const latePending = paypalRefundWebhook(
      identity,
      "WH-CANCEL-PAYPAL-LATE-PENDING",
      "PAYMENT.REFUND.PENDING",
    );
    assert.equal((await processVerifiedPaypalFinancialEvent(latePending)).outcome, "PROCESSED");
    await assertSingleCancellationEffects(fixture, order, request.id, stockBefore);
    const [attempt, state, providerEvents] = await Promise.all([
      prisma.refundAttempt.findUniqueOrThrow({ where: { id: identity.attemptId } }),
      prisma.shopOrder.findUniqueOrThrow({ where: { id: order.id } }),
      prisma.providerEvent.findMany({ where: { refundAttemptId: identity.attemptId } }),
    ]);
    assert.equal(attempt.status, "SUCCEEDED");
    assert.equal(state.paymentReviewAt, null);
    assert.ok(providerEvents.every((event) => event.outcome === "PROCESSED"));
    assert.deepEqual(refund.counts(), { requestCalls: 1, retrieveCalls: 0 });
    return "PASS" as const;
  } finally {
    refund.release("PENDING");
    await client.$disconnect();
  }
}

async function apiThenWebhookScenario(fixture: CancellationRuntimeFixture) {
  const order = await createCancellationFixtureOrder(fixture, 990013, { provider: "STRIPE" });
  const request = await createCancellationRequest(fixture, order);
  const refund = immediateRefundGateway("SUCCEEDED");
  const stockBefore = (await prisma.product.findUniqueOrThrow({ where: { id: fixture.productId } })).stock!;
  assert.equal(await decideShopCustomerRequest(
    fixture.adminA, request.requestNumber, "APPROVE", "Réponse API Stripe avant webhook.",
    refund.gateway, RUNTIME_NOW, runtimeServiceClient,
  ), "SUCCEEDED");
  const attempt = await prisma.refundAttempt.findUniqueOrThrow({ where: { shopCustomerRequestId: request.id } });
  const identity: RefundWebhookIdentity = {
    attemptId: attempt.id,
    paymentId: order.paymentId,
    provider: order.provider,
    providerPaymentId: order.providerPaymentId,
    providerIdempotencyKey: attempt.providerIdempotencyKey,
    amountCents: order.amountCents,
  };
  const event = stripeRefundWebhook(identity, "evt_cancel_stripe_api_first", {
    includeApplicationMetadata: false,
  });
  assert.deepEqual(await processVerifiedStripeFinancialEvent(event), {
    outcome: "PROCESSED", duplicate: false,
  });
  assert.deepEqual(await processVerifiedStripeFinancialEvent(event), {
    outcome: "PROCESSED", duplicate: true,
  });
  assert.deepEqual(refund.counts(), { requestCalls: 1, retrieveCalls: 0 });
  await assertSingleCancellationEffects(fixture, order, request.id, stockBefore);
  assert.equal((await prisma.shopOrder.findUniqueOrThrow({ where: { id: order.id } })).paymentReviewAt, null);
  return "PASS" as const;
}

async function webhookBeforeAmbiguousApiResponseScenario(fixture: CancellationRuntimeFixture) {
  const order = await createCancellationFixtureOrder(fixture, 990014, { provider: "PAYPAL" });
  const request = await createCancellationRequest(fixture, order);
  const client = isolatedCancellationRuntimeClient("webhook-before-timeout");
  const refund = delayedAmbiguousRefundGateway();
  const stockBefore = (await prisma.product.findUniqueOrThrow({ where: { id: fixture.productId } })).stock!;
  try {
    const decision = decideShopCustomerRequest(
      fixture.adminA, request.requestNumber, "APPROVE", "Webhook confirmé avant timeout API.",
      refund.gateway, RUNTIME_NOW, client,
    );
    const identity = refundWebhookIdentity(await refund.entered);
    assert.equal((await processVerifiedPaypalFinancialEvent(paypalRefundWebhook(
      identity,
      "WH-CANCEL-PAYPAL-BEFORE-TIMEOUT",
      "PAYMENT.CAPTURE.REFUNDED",
    ))).outcome, "PROCESSED");
    refund.release();
    assert.equal(await decision, "SUCCEEDED");
    assert.equal(refund.calls(), 1);
    await assertSingleCancellationEffects(fixture, order, request.id, stockBefore);
    const attempt = await prisma.refundAttempt.findUniqueOrThrow({ where: { id: identity.attemptId } });
    assert.equal(attempt.status, "SUCCEEDED");
    assert.equal(attempt.failureCode, null);
    assert.equal(await prisma.paymentAuditEvent.count({ where: {
      refundAttemptId: identity.attemptId,
      action: "REFUND_RECONCILIATION_REQUIRED",
    } }), 0);
    return "PASS" as const;
  } finally {
    refund.release();
    await client.$disconnect();
  }
}

async function ambiguousThenWebhookCompletionScenario(fixture: CancellationRuntimeFixture) {
  const order = await createCancellationFixtureOrder(fixture, 990015, { provider: "PAYPAL" });
  const request = await createCancellationRequest(fixture, order);
  const refund = immediateRefundGateway("AMBIGUOUS");
  const stockBefore = (await prisma.product.findUniqueOrThrow({ where: { id: fixture.productId } })).stock!;
  assert.equal(await decideShopCustomerRequest(
    fixture.adminA, request.requestNumber, "APPROVE", "Timeout avant webhook PayPal.",
    refund.gateway, RUNTIME_NOW, runtimeServiceClient,
  ), "REQUIRES_REVIEW");
  const attempt = await prisma.refundAttempt.findUniqueOrThrow({ where: { shopCustomerRequestId: request.id } });
  const identity: RefundWebhookIdentity = {
    attemptId: attempt.id,
    paymentId: order.paymentId,
    provider: order.provider,
    providerPaymentId: order.providerPaymentId,
    providerIdempotencyKey: attempt.providerIdempotencyKey,
    amountCents: order.amountCents,
  };
  const pending = paypalRefundWebhook(
    identity,
    "WH-CANCEL-PAYPAL-AFTER-TIMEOUT-PENDING",
    "PAYMENT.REFUND.PENDING",
  );
  assert.equal((await processVerifiedPaypalFinancialEvent(pending)).outcome, "PROCESSED");
  const reviewed = await prisma.refundAttempt.findUniqueOrThrow({ where: { id: attempt.id } });
  assert.equal(reviewed.status, "REQUIRES_REVIEW");
  assert.equal(reviewed.providerRefundId, shopRefundEvidence(identity).providerRefundId);
  assert.equal((await prisma.shopOrder.findUniqueOrThrow({ where: { id: order.id } })).paymentReviewAt, null);

  const completed = paypalRefundWebhook(
    identity,
    "WH-CANCEL-PAYPAL-AFTER-TIMEOUT-COMPLETED",
    "PAYMENT.CAPTURE.REFUNDED",
  );
  assert.equal((await processVerifiedPaypalFinancialEvent(completed)).outcome, "PROCESSED");
  await assertSingleCancellationEffects(fixture, order, request.id, stockBefore);
  assert.equal(refund.counts().requestCalls, 1);
  return "PASS" as const;
}

async function webhookAccountingFailureThenReconciliationScenario(fixture: CancellationRuntimeFixture) {
  const order = await createCancellationFixtureOrder(fixture, 990016, { provider: "PAYPAL" });
  const request = await createCancellationRequest(fixture, order);
  const client = isolatedCancellationRuntimeClient("webhook-accounting-failure");
  const refund = delayedRefundGateway();
  const stockBefore = (await prisma.product.findUniqueOrThrow({ where: { id: fixture.productId } })).stock!;
  let triggerInstalled = false;
  try {
    const decision = decideShopCustomerRequest(
      fixture.adminA, request.requestNumber, "APPROVE", "Échec comptable après webhook PayPal.",
      refund.gateway, RUNTIME_NOW, client,
    );
    const identity = refundWebhookIdentity(await refund.entered);
    await installCreditNoteFailureTrigger();
    triggerInstalled = true;
    const event = paypalRefundWebhook(
      identity,
      "WH-CANCEL-PAYPAL-ACCOUNTING-FAILURE",
      "PAYMENT.CAPTURE.REFUNDED",
    );
    assert.deepEqual(await processVerifiedPaypalFinancialEvent(event), {
      outcome: "PROCESSED", duplicate: false,
    });
    await removeCreditNoteFailureTrigger();
    triggerInstalled = false;
    const review = await prisma.refundAttempt.findUniqueOrThrow({
      where: { id: identity.attemptId },
      include: { payment: true },
    });
    assert.equal(review.status, "REQUIRES_REVIEW");
    assert.equal(review.failureCode, "PROVIDER_ACCEPTED_LOCAL_FINALIZATION_FAILED");
    assert.equal(review.providerRefundId, shopRefundEvidence(identity).providerRefundId);
    assert.ok(review.confirmedAt);
    assert.deepEqual([review.payment.status, review.payment.refundedAmountCents], ["REFUND_PENDING", 0]);
    assert.equal(await prisma.creditNote.count({ where: { invoiceId: order.invoiceId } }), 0);
    assert.equal(await prisma.productStockAdjustment.count({ where: { shopCustomerRequestId: request.id } }), 0);
    assert.equal((await prisma.shopOrder.findUniqueOrThrow({ where: { id: order.id } })).paymentReviewAt, null);
    assert.equal((await prisma.providerEvent.findUniqueOrThrow({
      where: { provider_providerEventId: { provider: "PAYPAL", providerEventId: event.id } },
    })).outcome, "PROCESSED");

    refund.release("PENDING");
    assert.equal(await decision, "REQUIRES_REVIEW");
    assert.equal(await reconcileShopCustomerRequestRefund(
      fixture.adminA, request.requestNumber, refund.gateway, runtimeServiceClient,
    ), "SUCCEEDED");
    assert.deepEqual(refund.counts(), { requestCalls: 1, retrieveCalls: 1 });
    await assertSingleCancellationEffects(fixture, order, request.id, stockBefore);
    return "PASS" as const;
  } finally {
    if (triggerInstalled) await removeCreditNoteFailureTrigger();
    refund.release("PENDING");
    await client.$disconnect();
  }
}

async function uncorrelatedAndIncoherentWebhookScenario(fixture: CancellationRuntimeFixture) {
  const externalOrder = await createCancellationFixtureOrder(fixture, 990017, { provider: "PAYPAL" });
  const externalIdentity: RefundWebhookIdentity = {
    attemptId: randomUUID(),
    paymentId: externalOrder.paymentId,
    provider: externalOrder.provider,
    providerPaymentId: externalOrder.providerPaymentId,
    providerIdempotencyKey: "external-refund-without-application-reference",
    amountCents: externalOrder.amountCents,
  };
  const externalEvent = paypalRefundWebhook(
    externalIdentity,
    "WH-CANCEL-PAYPAL-EXTERNAL",
    "PAYMENT.CAPTURE.REFUNDED",
    { includeApplicationReference: false },
  );
  assert.equal((await processVerifiedPaypalFinancialEvent(externalEvent)).outcome, "REQUIRES_REVIEW");
  const externalState = await prisma.shopOrder.findUniqueOrThrow({ where: { id: externalOrder.id } });
  assert.ok(externalState.paymentReviewAt);
  assert.equal(externalState.paymentReviewCode, "SHOP_PROVIDER_FINANCIAL_EVENT_REVIEW");
  assert.equal(await prisma.refundAttempt.count({ where: { paymentId: externalOrder.paymentId } }), 0);
  assert.equal(await prisma.creditNote.count({ where: { invoiceId: externalOrder.invoiceId } }), 0);

  const mismatchOrder = await createCancellationFixtureOrder(fixture, 990018, { provider: "STRIPE" });
  const mismatchRequest = await createCancellationRequest(fixture, mismatchOrder);
  const mismatchClient = isolatedCancellationRuntimeClient("webhook-mismatch");
  const refund = delayedRefundGateway();
  try {
    const decision = decideShopCustomerRequest(
      fixture.adminA, mismatchRequest.requestNumber, "APPROVE", "Webhook incohérent.",
      refund.gateway, RUNTIME_NOW, mismatchClient,
    );
    const identity = refundWebhookIdentity(await refund.entered);
    const mismatchEvent = stripeRefundWebhook(identity, "evt_cancel_stripe_wrong_amount", {
      amountCents: identity.amountCents - 1,
    });
    assert.equal((await processVerifiedStripeFinancialEvent(mismatchEvent)).outcome, "REQUIRES_REVIEW");
    const [state, receipt] = await Promise.all([
      prisma.shopOrder.findUniqueOrThrow({ where: { id: mismatchOrder.id } }),
      prisma.providerEvent.findUniqueOrThrow({
        where: { provider_providerEventId: { provider: "STRIPE", providerEventId: mismatchEvent.id } },
      }),
    ]);
    assert.ok(state.paymentReviewAt);
    assert.equal(receipt.refundAttemptId, identity.attemptId);
    assert.equal(await prisma.creditNote.count({ where: { invoiceId: mismatchOrder.invoiceId } }), 0);
    refund.release("PENDING");
    assert.equal(await decision, "PENDING");
  } finally {
    refund.release("PENDING");
    await mismatchClient.$disconnect();
  }

  const linkedOrder = await createCancellationFixtureOrder(fixture, 990019, { provider: "PAYPAL" });
  const linkedRequest = await createCancellationRequest(fixture, linkedOrder);
  const linkedRefund = immediateRefundGateway("PENDING");
  assert.equal(await decideShopCustomerRequest(
    fixture.adminA, linkedRequest.requestNumber, "APPROVE", "Provider ID PayPal lié.",
    linkedRefund.gateway, RUNTIME_NOW, runtimeServiceClient,
  ), "PENDING");
  const linkedAttempt = await prisma.refundAttempt.findUniqueOrThrow({
    where: { shopCustomerRequestId: linkedRequest.id },
  });
  const linkedIdentity: RefundWebhookIdentity = {
    attemptId: linkedAttempt.id,
    paymentId: linkedOrder.paymentId,
    provider: linkedOrder.provider,
    providerPaymentId: linkedOrder.providerPaymentId,
    providerIdempotencyKey: linkedAttempt.providerIdempotencyKey,
    amountCents: linkedOrder.amountCents,
  };
  const wrongRefundId = paypalRefundWebhook(
    linkedIdentity,
    "WH-CANCEL-PAYPAL-WRONG-REFUND-ID",
    "PAYMENT.CAPTURE.REFUNDED",
    { providerRefundId: `wrong-${shopRefundEvidence(linkedIdentity).providerRefundId}` },
  );
  assert.equal((await processVerifiedPaypalFinancialEvent(wrongRefundId)).outcome, "REQUIRES_REVIEW");
  const linkedState = await prisma.shopOrder.findUniqueOrThrow({ where: { id: linkedOrder.id } });
  assert.ok(linkedState.paymentReviewAt);
  assert.equal(await prisma.creditNote.count({ where: { invoiceId: linkedOrder.invoiceId } }), 0);
  assert.equal((await prisma.refundAttempt.findUniqueOrThrow({ where: { id: linkedAttempt.id } })).status, "PENDING");
  return "PASS" as const;
}

async function missingCorrelationReferenceDeferredScenario(fixture: CancellationRuntimeFixture) {
  for (const [provider, sequence] of [["STRIPE", 990020], ["PAYPAL", 990021]] as const) {
    const order = await createCancellationFixtureOrder(fixture, sequence, { provider });
    const request = await createCancellationRequest(fixture, order);
    const client = isolatedCancellationRuntimeClient(`deferred-${provider.toLowerCase()}`);
    const refund = delayedRefundGateway();
    const stockBefore = (await prisma.product.findUniqueOrThrow({ where: { id: fixture.productId } })).stock!;
    try {
      const decision = decideShopCustomerRequest(
        fixture.adminA, request.requestNumber, "APPROVE", "Preuve signée sans référence applicative.",
        refund.gateway, RUNTIME_NOW, client,
      );
      const identity = refundWebhookIdentity(await refund.entered);
      const event = provider === "STRIPE"
        ? stripeRefundWebhook(identity, `evt_cancel_deferred_${sequence}`, {
            includeApplicationMetadata: false,
          })
        : paypalRefundWebhook(
            identity,
            `WH-CANCEL-DEFERRED-${sequence}`,
            "PAYMENT.CAPTURE.REFUNDED",
            { includeApplicationReference: false },
          );
      const deferred = provider === "STRIPE"
        ? await processVerifiedStripeFinancialEvent(event as ReturnType<typeof stripeRefundWebhook>)
        : await processVerifiedPaypalFinancialEvent(event as ReturnType<typeof paypalRefundWebhook>);
      assert.equal(deferred.outcome, "REQUIRES_REVIEW");
      const [reviewedAttempt, reviewedOrder, deferredReceipt] = await Promise.all([
        prisma.refundAttempt.findUniqueOrThrow({ where: { id: identity.attemptId } }),
        prisma.shopOrder.findUniqueOrThrow({ where: { id: order.id } }),
        prisma.providerEvent.findUniqueOrThrow({
          where: { provider_providerEventId: { provider, providerEventId: event.id } },
        }),
      ]);
      assert.equal(reviewedAttempt.status, "REQUIRES_REVIEW");
      assert.equal(reviewedAttempt.failureCode, "PROVIDER_EVENT_CORRELATION_DEFERRED");
      assert.equal(reviewedOrder.paymentReviewAt, null);
      assert.equal(deferredReceipt.refundAttemptId, identity.attemptId);

      refund.release("SUCCEEDED");
      assert.equal(await decision, "SUCCEEDED");
      assert.equal((await prisma.providerEvent.findUniqueOrThrow({
        where: { provider_providerEventId: { provider, providerEventId: event.id } },
      })).outcome, "PROCESSED");
      assert.equal(await prisma.paymentAuditEvent.count({ where: {
        refundAttemptId: identity.attemptId,
        action: "RECONCILIATION_CHECKED",
        result: "SUCCEEDED",
      } }), 1);
      await assertSingleCancellationEffects(fixture, order, request.id, stockBefore);
    } finally {
      refund.release("SUCCEEDED");
      await client.$disconnect();
    }
  }
  return "PASS" as const;
}

async function shopReturnStripeWebhookScenario(fixture: CancellationRuntimeFixture) {
  const refund = await createShopReturnRefundFixture(fixture, 990022, "STRIPE");
  const identity = shopReturnWebhookIdentity(refund);
  const event = stripeRefundWebhook(identity, "evt_shop_return_stripe_completed");
  assert.deepEqual(await processVerifiedStripeFinancialEvent(event), {
    outcome: "PROCESSED", duplicate: false,
  });
  assert.deepEqual(await processVerifiedStripeFinancialEvent(event), {
    outcome: "PROCESSED", duplicate: true,
  });
  const lateDuplicate = stripeRefundWebhook(identity, "evt_shop_return_stripe_completed_late");
  assert.equal((await processVerifiedStripeFinancialEvent(lateDuplicate)).outcome, "PROCESSED");
  await assertSingleShopReturnRefundEffects(refund);
  assert.equal(await prisma.paymentAuditEvent.count({ where: {
    refundAttemptId: refund.attemptId,
    action: "REFUND_CONFIRMED",
  } }), 1);
  return "PASS" as const;
}

async function shopReturnPaypalOrderingScenario(fixture: CancellationRuntimeFixture) {
  const refund = await createShopReturnRefundFixture(fixture, 990023, "PAYPAL");
  const identity = shopReturnWebhookIdentity(refund);
  const pending = paypalRefundWebhook(
    identity,
    "WH-SHOP-RETURN-PAYPAL-PENDING",
    "PAYMENT.REFUND.PENDING",
  );
  assert.equal((await processVerifiedPaypalFinancialEvent(pending)).outcome, "PROCESSED");
  assert.equal((await prisma.refundAttempt.findUniqueOrThrow({ where: { id: refund.attemptId } })).status, "PENDING");
  assert.equal(await prisma.paymentAuditEvent.count({ where: {
    refundAttemptId: refund.attemptId,
    action: "REFUND_PROVIDER_ACCEPTED",
  } }), 1);
  const completed = paypalRefundWebhook(
    identity,
    "WH-SHOP-RETURN-PAYPAL-COMPLETED",
    "PAYMENT.CAPTURE.REFUNDED",
  );
  assert.deepEqual(await processVerifiedPaypalFinancialEvent(completed), {
    outcome: "PROCESSED", duplicate: false,
  });
  assert.deepEqual(await processVerifiedPaypalFinancialEvent(completed), {
    outcome: "PROCESSED", duplicate: true,
  });
  await assertSingleShopReturnRefundEffects(refund);

  const latePending = paypalRefundWebhook(
    identity,
    "WH-SHOP-RETURN-PAYPAL-LATE-PENDING",
    "PAYMENT.REFUND.PENDING",
  );
  assert.equal((await processVerifiedPaypalFinancialEvent(latePending)).outcome, "PROCESSED");
  const lateFailed = paypalRefundWebhook(
    identity,
    "WH-SHOP-RETURN-PAYPAL-LATE-FAILED",
    "PAYMENT.REFUND.FAILED",
  );
  assert.equal((await processVerifiedPaypalFinancialEvent(lateFailed)).outcome, "REQUIRES_REVIEW");
  const [attempt, request] = await Promise.all([
    prisma.refundAttempt.findUniqueOrThrow({ where: { id: refund.attemptId } }),
    prisma.shopReturnRequest.findUniqueOrThrow({ where: { id: refund.requestId } }),
  ]);
  assert.deepEqual([attempt.status, request.status, request.refundStatus], ["SUCCEEDED", "REFUNDED", "SUCCEEDED"]);
  assert.equal(await prisma.paymentAuditEvent.count({ where: {
    refundAttemptId: refund.attemptId,
    action: "REFUND_CONFIRMED",
  } }), 1);
  return "PASS" as const;
}

async function shopReturnAccountingFailureScenario(fixture: CancellationRuntimeFixture) {
  const refundFixture = await createShopReturnRefundFixture(fixture, 990024, "PAYPAL");
  const identity = shopReturnWebhookIdentity(refundFixture);
  const event = paypalRefundWebhook(
    identity,
    "WH-SHOP-RETURN-PAYPAL-ACCOUNTING-FAILURE",
    "PAYMENT.CAPTURE.REFUNDED",
  );
  let triggerInstalled = false;
  try {
    await installCreditNoteFailureTrigger();
    triggerInstalled = true;
    assert.equal((await processVerifiedPaypalFinancialEvent(event)).outcome, "PROCESSED");
  } finally {
    if (triggerInstalled) await removeCreditNoteFailureTrigger();
  }
  const review = await prisma.refundAttempt.findUniqueOrThrow({ where: { id: refundFixture.attemptId } });
  assert.equal(review.status, "REQUIRES_REVIEW");
  assert.equal(review.failureCode, "PROVIDER_ACCEPTED_LOCAL_FINALIZATION_FAILED");
  assert.equal(await prisma.creditNote.count({ where: { shopReturnRequestId: refundFixture.requestId } }), 0);
  const latePending = paypalRefundWebhook(
    identity,
    "WH-SHOP-RETURN-PAYPAL-ACCOUNTING-FAILURE-PENDING",
    "PAYMENT.REFUND.PENDING",
  );
  assert.equal((await processVerifiedPaypalFinancialEvent(latePending)).outcome, "PROCESSED");
  assert.equal((await prisma.refundAttempt.findUniqueOrThrow({
    where: { id: refundFixture.attemptId },
  })).failureCode, "PROVIDER_ACCEPTED_LOCAL_FINALIZATION_FAILED");
  const gateway = immediateRefundGateway("SUCCEEDED");
  assert.deepEqual(await reconcileShopReturnRefund(
    fixture.adminA,
    refundFixture.requestNumber,
    gateway.gateway,
    { client: prisma, assertEnabled: noRuntimeGuard },
  ), { status: "SUCCEEDED", confirmed: true });
  assert.deepEqual(gateway.counts(), { requestCalls: 0, retrieveCalls: 1 });
  await assertSingleShopReturnRefundEffects(refundFixture);
  return "PASS" as const;
}

async function deferredRaceCannotRegressTerminalStateScenario(fixture: CancellationRuntimeFixture) {
  const observer = isolatedCancellationRuntimeClient("deferred-race-observer");

  const cancellationOrder = await createCancellationFixtureOrder(fixture, 990025, { provider: "PAYPAL" });
  const cancellationRequest = await createCancellationRequest(fixture, cancellationOrder);
  const cancellationClient = isolatedCancellationRuntimeClient("deferred-race-cancellation");
  const cancellationApiClient = isolatedCancellationRuntimeClient("deferred-race-cancellation-api");
  const cancellationBlocker = isolatedCancellationRuntimeClient("deferred-race-cancellation-blocker");
  const cancellationRefund = delayedRefundGateway();
  const cancellationRelease = deferred<void>();
  const cancellationLocked = deferred<void>();
  const cancellationApiLockAttempted = deferred<void>();
  const observedCancellationApiClient = observedAdvisoryLockClient(
    cancellationApiClient,
    cancellationApiLockAttempted,
  );
  let cancellationBlockerRun: Promise<unknown> | null = null;
  try {
    const decision = decideShopCustomerRequest(
      fixture.adminA,
      cancellationRequest.requestNumber,
      "APPROVE",
      "Course DEFER contre finalisation annulation.",
      cancellationRefund.gateway,
      RUNTIME_NOW,
      cancellationClient,
    );
    const identity = refundWebhookIdentity(await cancellationRefund.entered);
    cancellationBlockerRun = cancellationBlocker.$transaction(async (tx) => {
      await lockShopOrderForMutation(tx, cancellationOrder.id);
      cancellationLocked.resolve();
      await cancellationRelease.promise;
    });
    await cancellationLocked.promise;
    await assertOrderLockHeld(observer, cancellationOrder.id);
    const apiFinalization = applyShopCustomerCancellationEvidence(
      observedCancellationApiClient,
      identity.attemptId,
      shopRefundEvidence(identity, "PENDING"),
    );
    await cancellationApiLockAttempted.promise;
    await waitForAdvisoryWaiter(observer);
    const deferredWebhook = processVerifiedPaypalFinancialEvent(paypalRefundWebhook(
      identity,
      "WH-CANCEL-DEFERRED-RACE",
      "PAYMENT.REFUND.PENDING",
      { includeApplicationReference: false },
    ));
    cancellationRelease.resolve();
    assert.equal(await apiFinalization, "PENDING");
    const webhookResult = await deferredWebhook;
    assert.equal(webhookResult.outcome, "PROCESSED");
    const durableReceipt = await prisma.providerEvent.findUniqueOrThrow({
      where: {
        provider_providerEventId: {
          provider: "PAYPAL",
          providerEventId: "WH-CANCEL-DEFERRED-RACE",
        },
      },
    });
    assert.equal(durableReceipt.outcome, "PROCESSED");
    cancellationRefund.release("PENDING");
    assert.equal(await decision, "PENDING");
    const cancellationAttempt = await prisma.refundAttempt.findUniqueOrThrow({ where: { id: identity.attemptId } });
    assert.equal(cancellationAttempt.status, "PENDING");
    assert.equal(cancellationAttempt.failureCode, null);
  } finally {
    cancellationRelease.resolve();
    cancellationRefund.release("PENDING");
    await cancellationBlockerRun;
    await Promise.all([
      cancellationClient.$disconnect(),
      cancellationApiClient.$disconnect(),
      cancellationBlocker.$disconnect(),
    ]);
  }

  const shopReturn = await createShopReturnRefundFixture(fixture, 990026, "STRIPE");
  const returnIdentity = shopReturnWebhookIdentity(shopReturn);
  const returnApiClient = isolatedCancellationRuntimeClient("deferred-race-return-api");
  const returnBlocker = isolatedCancellationRuntimeClient("deferred-race-return-blocker");
  const returnRelease = deferred<void>();
  const returnLocked = deferred<void>();
  const returnApiLockAttempted = deferred<void>();
  const observedReturnApiClient = observedAdvisoryLockClient(returnApiClient, returnApiLockAttempted);
  let returnBlockerRun: Promise<unknown> | null = null;
  try {
    returnBlockerRun = returnBlocker.$transaction(async (tx) => {
      await lockShopRefundAttemptForMutation(tx, shopReturn.attemptId);
      returnLocked.resolve();
      await returnRelease.promise;
    });
    await returnLocked.promise;
    await assertRefundAttemptLockHeld(observer, shopReturn.attemptId);
    const apiFinalization = observedReturnApiClient.$transaction((tx) =>
      applyShopReturnRefundEvidenceInTransaction(tx, shopReturn.attemptId, shopRefundEvidence(returnIdentity)));
    await returnApiLockAttempted.promise;
    await waitForAdvisoryWaiter(observer);
    const deferredWebhook = processVerifiedStripeFinancialEvent(stripeRefundWebhook(
      returnIdentity,
      "evt_shop_return_deferred_race",
      { includeApplicationMetadata: false, status: "pending" },
    ));
    returnRelease.resolve();
    assert.deepEqual(await apiFinalization, { status: "SUCCEEDED", confirmed: true });
    const webhookResult = await deferredWebhook;
    assert.equal(webhookResult.outcome, "PROCESSED");
    const [attempt, request, durableReceipt] = await Promise.all([
      prisma.refundAttempt.findUniqueOrThrow({ where: { id: shopReturn.attemptId } }),
      prisma.shopReturnRequest.findUniqueOrThrow({ where: { id: shopReturn.requestId } }),
      prisma.providerEvent.findUniqueOrThrow({
        where: {
          provider_providerEventId: {
            provider: "STRIPE",
            providerEventId: "evt_shop_return_deferred_race",
          },
        },
      }),
    ]);
    assert.deepEqual([attempt.status, request.status, request.refundStatus], ["SUCCEEDED", "REFUNDED", "SUCCEEDED"]);
    assert.equal(durableReceipt.outcome, "PROCESSED");
    await assertSingleShopReturnRefundEffects(shopReturn);
  } finally {
    returnRelease.resolve();
    await returnBlockerRun;
    await Promise.all([returnApiClient.$disconnect(), returnBlocker.$disconnect(), observer.$disconnect()]);
  }
  return "PASS" as const;
}

async function deferredBindingPromotionScenario(fixture: CancellationRuntimeFixture) {
  for (const [provider, sequence] of [["STRIPE", 990027], ["PAYPAL", 990028]] as const) {
    const order = await createCancellationFixtureOrder(fixture, sequence, { provider });
    const request = await createCancellationRequest(fixture, order);
    const client = isolatedCancellationRuntimeClient(`deferred-binding-${provider.toLowerCase()}`);
    const refund = delayedRefundGateway();
    const stockBefore = (await prisma.product.findUniqueOrThrow({ where: { id: fixture.productId } })).stock!;
    try {
      const decision = decideShopCustomerRequest(
        fixture.adminA,
        request.requestNumber,
        "APPROVE",
        "Promotion de la corrélation par la réponse API.",
        refund.gateway,
        RUNTIME_NOW,
        client,
      );
      const identity = refundWebhookIdentity(await refund.entered);
      const pending = provider === "STRIPE"
        ? stripeRefundWebhook(identity, `evt_deferred_binding_pending_${sequence}`, {
            includeApplicationMetadata: false,
            status: "pending",
          })
        : paypalRefundWebhook(
            identity,
            `WH-DEFERRED-BINDING-PENDING-${sequence}`,
            "PAYMENT.REFUND.PENDING",
            { includeApplicationReference: false },
          );
      const pendingResult = provider === "STRIPE"
        ? await processVerifiedStripeFinancialEvent(pending as ReturnType<typeof stripeRefundWebhook>)
        : await processVerifiedPaypalFinancialEvent(pending as ReturnType<typeof paypalRefundWebhook>);
      assert.equal(pendingResult.outcome, "REQUIRES_REVIEW");

      refund.release("PENDING");
      assert.equal(await decision, "PENDING");
      const trustedBinding = await prisma.refundAttempt.findUniqueOrThrow({ where: { id: identity.attemptId } });
      assert.deepEqual(
        [trustedBinding.status, trustedBinding.failureCode, trustedBinding.providerRefundId],
        ["PENDING", null, shopRefundEvidence(identity).providerRefundId],
      );

      const completed = provider === "STRIPE"
        ? stripeRefundWebhook(identity, `evt_deferred_binding_completed_${sequence}`, {
            includeApplicationMetadata: false,
          })
        : paypalRefundWebhook(
            identity,
            `WH-DEFERRED-BINDING-COMPLETED-${sequence}`,
            "PAYMENT.CAPTURE.REFUNDED",
            { includeApplicationReference: false },
          );
      const completedResult = provider === "STRIPE"
        ? await processVerifiedStripeFinancialEvent(completed as ReturnType<typeof stripeRefundWebhook>)
        : await processVerifiedPaypalFinancialEvent(completed as ReturnType<typeof paypalRefundWebhook>);
      assert.equal(completedResult.outcome, "PROCESSED");
      assert.equal((await prisma.providerEvent.findUniqueOrThrow({
        where: { provider_providerEventId: { provider, providerEventId: pending.id } },
      })).outcome, "PROCESSED");
      assert.equal((await prisma.shopOrder.findUniqueOrThrow({ where: { id: order.id } })).paymentReviewAt, null);
      await assertSingleCancellationEffects(fixture, order, request.id, stockBefore);
    } finally {
      refund.release("PENDING");
      await client.$disconnect();
    }
  }
  return "PASS" as const;
}

async function unreferencedWebhookProgressionRemainsDeferredScenario(
  fixture: CancellationRuntimeFixture,
) {
  for (const [provider, sequence] of [["STRIPE", 990029], ["PAYPAL", 990030]] as const) {
    const order = await createCancellationFixtureOrder(fixture, sequence, { provider });
    const request = await createCancellationRequest(fixture, order);
    const client = isolatedCancellationRuntimeClient(`external-progression-${provider.toLowerCase()}`);
    const refund = delayedRefundGateway();
    try {
      const decision = decideShopCustomerRequest(
        fixture.adminA,
        request.requestNumber,
        "APPROVE",
        "Webhook sans référence non approuvé comme preuve applicative.",
        refund.gateway,
        RUNTIME_NOW,
        client,
      );
      const identity = refundWebhookIdentity(await refund.entered);
      const pending = provider === "STRIPE"
        ? stripeRefundWebhook(identity, `evt_external_pending_${sequence}`, {
            includeApplicationMetadata: false,
            status: "pending",
          })
        : paypalRefundWebhook(
            identity,
            `WH-EXTERNAL-PENDING-${sequence}`,
            "PAYMENT.REFUND.PENDING",
            { includeApplicationReference: false },
          );
      const completed = provider === "STRIPE"
        ? stripeRefundWebhook(identity, `evt_external_completed_${sequence}`, {
            includeApplicationMetadata: false,
          })
        : paypalRefundWebhook(
            identity,
            `WH-EXTERNAL-COMPLETED-${sequence}`,
            "PAYMENT.CAPTURE.REFUNDED",
            { includeApplicationReference: false },
          );
      const pendingResult = provider === "STRIPE"
        ? await processVerifiedStripeFinancialEvent(pending as ReturnType<typeof stripeRefundWebhook>)
        : await processVerifiedPaypalFinancialEvent(pending as ReturnType<typeof paypalRefundWebhook>);
      const completedResult = provider === "STRIPE"
        ? await processVerifiedStripeFinancialEvent(completed as ReturnType<typeof stripeRefundWebhook>)
        : await processVerifiedPaypalFinancialEvent(completed as ReturnType<typeof paypalRefundWebhook>);
      assert.deepEqual([pendingResult.outcome, completedResult.outcome], ["REQUIRES_REVIEW", "REQUIRES_REVIEW"]);

      refund.release("PENDING");
      assert.equal(await decision, "REQUIRES_REVIEW");
      const [attempt, payment, orderState, receipts, resolutionAudits] = await Promise.all([
        prisma.refundAttempt.findUniqueOrThrow({ where: { id: identity.attemptId } }),
        prisma.payment.findUniqueOrThrow({ where: { id: order.paymentId } }),
        prisma.shopOrder.findUniqueOrThrow({ where: { id: order.id } }),
        prisma.providerEvent.findMany({ where: { provider, providerEventId: { in: [pending.id, completed.id] } } }),
        prisma.paymentAuditEvent.count({ where: {
          refundAttemptId: identity.attemptId,
          action: "RECONCILIATION_CHECKED",
          result: "SUCCEEDED",
        } }),
      ]);
      assert.deepEqual(
        [attempt.status, attempt.failureCode, payment.status, payment.refundedAmountCents],
        ["REQUIRES_REVIEW", "REFUND_STATUS_CONFLICT", "REFUND_PENDING", 0],
      );
      assert.equal(attempt.providerRefundId, shopRefundEvidence(identity).providerRefundId);
      assert.equal(attempt.confirmedAt, null, "an unreferenced receipt cannot become canonical provider truth");
      assert.equal(orderState.paymentReviewAt, null);
      assert.equal(receipts.find((receipt) => receipt.providerEventId === pending.id)?.outcome, "PROCESSED");
      assert.equal(receipts.find((receipt) => receipt.providerEventId === completed.id)?.outcome, "REQUIRES_REVIEW");
      assert.equal(resolutionAudits, 1);
      assert.equal(await prisma.creditNote.count({ where: { invoiceId: order.invoiceId } }), 0);
      await expectFulfillmentBarrier(() => markShopOrderPreparing(
        order.orderNumber,
        fixture.adminB.id,
        RUNTIME_NOW,
        { client: prisma, assertEnabled: noRuntimeGuard },
      ));
    } finally {
      refund.release("PENDING");
      await client.$disconnect();
    }
  }
  return "PASS" as const;
}

async function contradictoryDeferredReceiptRemainsReviewScenario(
  fixture: CancellationRuntimeFixture,
) {
  const cases = [
    ["STRIPE", 990031, "FAILED", "SUCCEEDED"],
    ["PAYPAL", 990032, "FAILED", "SUCCEEDED"],
    ["STRIPE", 990041, "SUCCEEDED", "FAILED"],
    ["PAYPAL", 990042, "SUCCEEDED", "FAILED"],
    ["STRIPE", 990051, "FAILED", "PENDING"],
    ["PAYPAL", 990052, "SUCCEEDED", "PENDING"],
  ] as const;
  for (const [provider, sequence, webhookStatus, apiStatus] of cases) {
    const order = await createCancellationFixtureOrder(fixture, sequence, { provider });
    const request = await createCancellationRequest(fixture, order);
    const client = isolatedCancellationRuntimeClient(
      `deferred-contradiction-${provider.toLowerCase()}-${sequence}`,
    );
    const refund = delayedRefundGateway();
    const stockBefore = (await prisma.product.findUniqueOrThrow({ where: { id: fixture.productId } })).stock!;
    try {
      const decision = decideShopCustomerRequest(
        fixture.adminA,
        request.requestNumber,
        "APPROVE",
        "Preuve provider contradictoire conservée.",
        refund.gateway,
        RUNTIME_NOW,
        client,
      );
      const identity = refundWebhookIdentity(await refund.entered);
      const event = provider === "STRIPE"
        ? stripeRefundWebhook(identity, `evt_deferred_contradiction_${sequence}`, {
            includeApplicationMetadata: false,
            status: webhookStatus === "FAILED" ? "failed" : "succeeded",
          })
        : paypalRefundWebhook(
            identity,
            `WH-DEFERRED-CONTRADICTION-${sequence}`,
            webhookStatus === "FAILED" ? "PAYMENT.REFUND.FAILED" : "PAYMENT.CAPTURE.REFUNDED",
            { includeApplicationReference: false },
          );
      const eventResult = provider === "STRIPE"
        ? await processVerifiedStripeFinancialEvent(event as ReturnType<typeof stripeRefundWebhook>)
        : await processVerifiedPaypalFinancialEvent(event as ReturnType<typeof paypalRefundWebhook>);
      assert.equal(eventResult.outcome, "REQUIRES_REVIEW");
      refund.release(apiStatus);
      assert.equal(await decision, "REQUIRES_REVIEW");
      assert.equal((await prisma.providerEvent.findUniqueOrThrow({
        where: { provider_providerEventId: { provider, providerEventId: event.id } },
      })).outcome, "REQUIRES_REVIEW");
      const [attempt, payment] = await Promise.all([
        prisma.refundAttempt.findFirstOrThrow({ where: { shopCustomerRequestId: request.id } }),
        prisma.payment.findUniqueOrThrow({ where: { id: order.paymentId } }),
      ]);
      assert.deepEqual(
        [attempt.status, payment.status, payment.refundedAmountCents],
        ["REQUIRES_REVIEW", "REFUND_PENDING", 0],
      );
      assert.equal(await prisma.creditNote.count({ where: { invoiceId: order.invoiceId } }), 0);
      assert.equal(await prisma.productStockAdjustment.count({
        where: { shopCustomerRequestId: request.id },
      }), 0);
      assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: fixture.productId } })).stock, stockBefore);
      await expectFulfillmentBarrier(() => markShopOrderPreparing(
        order.orderNumber,
        fixture.adminB.id,
        RUNTIME_NOW,
        { client: prisma, assertEnabled: noRuntimeGuard },
      ));
    } finally {
      refund.release(apiStatus);
      await client.$disconnect();
    }
  }
  return "PASS" as const;
}

async function deferredPendingThenCertainRefusalScenario(
  fixture: CancellationRuntimeFixture,
) {
  for (const [provider, sequence] of [["STRIPE", 990043], ["PAYPAL", 990040]] as const) {
    const order = await createCancellationFixtureOrder(fixture, sequence, { provider });
    const request = await createCancellationRequest(fixture, order);
    const client = isolatedCancellationRuntimeClient(`deferred-then-refused-${provider.toLowerCase()}`);
    const refund = delayedRefundGateway();
    try {
      const decision = decideShopCustomerRequest(
        fixture.adminA,
        request.requestNumber,
        "APPROVE",
        "Refus API certain après preuve PENDING sans référence.",
        refund.gateway,
        RUNTIME_NOW,
        client,
      );
      const identity = refundWebhookIdentity(await refund.entered);
      const pending = provider === "STRIPE"
        ? stripeRefundWebhook(identity, `evt_deferred_pending_then_refused_${sequence}`, {
            includeApplicationMetadata: false,
            status: "pending",
          })
        : paypalRefundWebhook(
            identity,
            `WH-DEFERRED-PENDING-THEN-REFUSED-${sequence}`,
            "PAYMENT.REFUND.PENDING",
            { includeApplicationReference: false },
          );
      const pendingResult = provider === "STRIPE"
        ? await processVerifiedStripeFinancialEvent(pending as ReturnType<typeof stripeRefundWebhook>)
        : await processVerifiedPaypalFinancialEvent(pending as ReturnType<typeof paypalRefundWebhook>);
      assert.equal(pendingResult.outcome, "REQUIRES_REVIEW");
      refund.release("FAILED");
      assert.equal(await decision, "FAILED");
      const [attempt, payment, receipt] = await Promise.all([
        prisma.refundAttempt.findUniqueOrThrow({ where: { id: identity.attemptId } }),
        prisma.payment.findUniqueOrThrow({ where: { id: order.paymentId } }),
        prisma.providerEvent.findUniqueOrThrow({
          where: { provider_providerEventId: { provider, providerEventId: pending.id } },
        }),
      ]);
      assert.deepEqual(
        [attempt.status, attempt.failureCode, payment.status, payment.refundedAmountCents, receipt.outcome],
        ["FAILED", "PROVIDER_REFUND_FAILED", "SUCCEEDED", 0, "PROCESSED"],
      );
      assert.equal(await prisma.creditNote.count({ where: { invoiceId: order.invoiceId } }), 0);
      const preparing = await markShopOrderPreparing(
        order.orderNumber,
        fixture.adminB.id,
        RUNTIME_NOW,
        { client: prisma, assertEnabled: noRuntimeGuard },
      );
      assert.equal(preparing.fulfillmentStatus, "PREPARING");
    } finally {
      refund.release("FAILED");
      await client.$disconnect();
    }
  }
  return "PASS" as const;
}

async function deferredIdentityAndProvenanceScenario(fixture: CancellationRuntimeFixture) {
  for (const [provider, sequence] of [["STRIPE", 990044], ["PAYPAL", 990045]] as const) {
    const order = await createCancellationFixtureOrder(fixture, sequence, { provider });
    const request = await createCancellationRequest(fixture, order);
    const client = isolatedCancellationRuntimeClient(`deferred-provenance-${provider.toLowerCase()}`);
    const refund = delayedAmbiguousRefundGateway();
    try {
      const decision = decideShopCustomerRequest(
        fixture.adminA,
        request.requestNumber,
        "APPROVE",
        "Preuve différée conservée sans liaison canonique.",
        refund.gateway,
        RUNTIME_NOW,
        client,
      );
      const identity = refundWebhookIdentity(await refund.entered);
      await prisma.refundAttempt.update({
        where: { id: identity.attemptId },
        data: { status: "REQUIRES_REVIEW", failureCode: "AMBIGUOUS_PROVIDER_ACCEPTANCE" },
      });
      const providerRefundId = `external_${provider.toLowerCase()}_${sequence}`;
      const pending = provider === "STRIPE"
        ? stripeRefundWebhook(identity, `evt_deferred_provenance_pending_${sequence}`, {
            includeApplicationMetadata: false,
            status: "pending",
            providerRefundId,
          })
        : paypalRefundWebhook(
            identity,
            `WH-DEFERRED-PROVENANCE-PENDING-${sequence}`,
            "PAYMENT.REFUND.PENDING",
            { includeApplicationReference: false, providerRefundId },
          );
      const completed = provider === "STRIPE"
        ? stripeRefundWebhook(identity, `evt_deferred_provenance_completed_${sequence}`, {
            includeApplicationMetadata: false,
            providerRefundId,
          })
        : paypalRefundWebhook(
            identity,
            `WH-DEFERRED-PROVENANCE-COMPLETED-${sequence}`,
            "PAYMENT.CAPTURE.REFUNDED",
            { includeApplicationReference: false, providerRefundId },
          );
      assert.equal((await processFixtureRefundEvent(provider, pending)).outcome, "REQUIRES_REVIEW");
      assert.equal((await processFixtureRefundEvent(provider, completed)).outcome, "REQUIRES_REVIEW");
      const [attempt, receipts] = await Promise.all([
        prisma.refundAttempt.findUniqueOrThrow({ where: { id: identity.attemptId } }),
        prisma.providerEvent.findMany({
          where: { provider, providerEventId: { in: [pending.id, completed.id] } },
          orderBy: { providerEventId: "asc" },
        }),
      ]);
      assert.deepEqual(
        [attempt.status, attempt.failureCode, attempt.providerRefundId, attempt.confirmedAt],
        ["REQUIRES_REVIEW", "AMBIGUOUS_PROVIDER_ACCEPTANCE", null, null],
      );
      assert.equal(receipts.length, 2);
      assert.ok(receipts.every((receipt) =>
        receipt.outcome === "REQUIRES_REVIEW"
        && receipt.refundAttemptId === identity.attemptId
        && receipt.objectId === providerRefundId));
      refund.release();
      assert.equal(await decision, "REQUIRES_REVIEW");
      assert.equal(await prisma.creditNote.count({ where: { invoiceId: order.invoiceId } }), 0);
    } finally {
      refund.release();
      await client.$disconnect();
    }
  }
  return "PASS" as const;
}

async function deferredExternalIdCannotOverwriteApiIdScenario(fixture: CancellationRuntimeFixture) {
  for (const [provider, sequence] of [["STRIPE", 990046], ["PAYPAL", 990047]] as const) {
    const order = await createCancellationFixtureOrder(fixture, sequence, { provider });
    const request = await createCancellationRequest(fixture, order);
    const client = isolatedCancellationRuntimeClient(`deferred-distinct-id-${provider.toLowerCase()}`);
    const refund = delayedRefundGateway();
    const stockBefore = (await prisma.product.findUniqueOrThrow({ where: { id: fixture.productId } })).stock!;
    try {
      const decision = decideShopCustomerRequest(
        fixture.adminA,
        request.requestNumber,
        "APPROVE",
        "ID webhook externe distinct de la réponse API corrélée.",
        refund.gateway,
        RUNTIME_NOW,
        client,
      );
      const identity = refundWebhookIdentity(await refund.entered);
      const apiRefundId = shopRefundEvidence(identity).providerRefundId;
      const externalRefundId = `${apiRefundId}_external`;
      const external = provider === "STRIPE"
        ? stripeRefundWebhook(identity, `evt_deferred_distinct_id_${sequence}`, {
            includeApplicationMetadata: false,
            status: "pending",
            providerRefundId: externalRefundId,
          })
        : paypalRefundWebhook(
            identity,
            `WH-DEFERRED-DISTINCT-ID-${sequence}`,
            "PAYMENT.REFUND.PENDING",
            { includeApplicationReference: false, providerRefundId: externalRefundId },
          );
      assert.equal((await processFixtureRefundEvent(provider, external)).outcome, "REQUIRES_REVIEW");
      assert.equal((await prisma.refundAttempt.findUniqueOrThrow({
        where: { id: identity.attemptId },
      })).providerRefundId, null);

      refund.release("SUCCEEDED");
      assert.equal(await decision, "REQUIRES_REVIEW");
      const [attempt, payment, receipt] = await Promise.all([
        prisma.refundAttempt.findUniqueOrThrow({ where: { id: identity.attemptId } }),
        prisma.payment.findUniqueOrThrow({ where: { id: order.paymentId } }),
        prisma.providerEvent.findUniqueOrThrow({
          where: { provider_providerEventId: { provider, providerEventId: external.id } },
        }),
      ]);
      assert.deepEqual(
        [attempt.status, attempt.failureCode, attempt.providerRefundId, payment.status, payment.refundedAmountCents],
        ["REQUIRES_REVIEW", "REFUND_STATUS_CONFLICT", apiRefundId, "REFUND_PENDING", 0],
      );
      assert.equal(receipt.objectId, externalRefundId);
      assert.equal(receipt.outcome, "REQUIRES_REVIEW");
      assert.equal(receipt.refundAttemptId, identity.attemptId);
      assert.equal(await prisma.creditNote.count({ where: { invoiceId: order.invoiceId } }), 0);
      assert.equal(await prisma.productStockAdjustment.count({
        where: { shopCustomerRequestId: request.id },
      }), 0);
      assert.equal((await prisma.product.findUniqueOrThrow({ where: { id: fixture.productId } })).stock, stockBefore);
      await expectFulfillmentBarrier(() => markShopOrderPreparing(
        order.orderNumber,
        fixture.adminB.id,
        RUNTIME_NOW,
        { client: prisma, assertEnabled: noRuntimeGuard },
      ));
    } finally {
      refund.release("SUCCEEDED");
      await client.$disconnect();
    }
  }
  return "PASS" as const;
}

async function applicationCorrelationMustBeProvenScenario(fixture: CancellationRuntimeFixture) {
  const cases = [
    ["STRIPE", 990048, "MISSING"],
    ["PAYPAL", 990049, "MISMATCH"],
  ] as const;
  for (const [provider, sequence, applicationCorrelation] of cases) {
    const order = await createCancellationFixtureOrder(fixture, sequence, { provider });
    const request = await createCancellationRequest(fixture, order);
    const client = isolatedCancellationRuntimeClient(`application-proof-${provider.toLowerCase()}`);
    const refund = delayedRefundGateway();
    const stockBefore = (await prisma.product.findUniqueOrThrow({ where: { id: fixture.productId } })).stock!;
    try {
      const decision = decideShopCustomerRequest(
        fixture.adminA,
        request.requestNumber,
        "APPROVE",
        "La preuve applicative provider doit être exacte.",
        refund.gateway,
        RUNTIME_NOW,
        client,
      );
      const identity = refundWebhookIdentity(await refund.entered);
      assert.equal(await applyShopCustomerCancellationEvidence(
        runtimeServiceClient,
        identity.attemptId,
        shopRefundEvidence(identity, "SUCCEEDED", { applicationCorrelation }),
      ), "REQUIRES_REVIEW");
      let attempt = await prisma.refundAttempt.findUniqueOrThrow({ where: { id: identity.attemptId } });
      assert.deepEqual(
        [attempt.status, attempt.failureCode, attempt.providerRefundId],
        ["REQUIRES_REVIEW", "REFUND_APPLICATION_CORRELATION_REQUIRED", shopRefundEvidence(identity).providerRefundId],
      );
      assert.equal(await prisma.creditNote.count({ where: { invoiceId: order.invoiceId } }), 0);
      assert.equal(await prisma.productStockAdjustment.count({
        where: { shopCustomerRequestId: request.id },
      }), 0);

      const noReference = provider === "STRIPE"
        ? stripeRefundWebhook(identity, `evt_application_missing_${sequence}`, {
            includeApplicationMetadata: false,
          })
        : paypalRefundWebhook(
            identity,
            `WH-APPLICATION-MISSING-${sequence}`,
            "PAYMENT.CAPTURE.REFUNDED",
            { includeApplicationReference: false },
          );
      assert.equal((await processFixtureRefundEvent(provider, noReference)).outcome, "REQUIRES_REVIEW");
      assert.equal(await prisma.creditNote.count({ where: { invoiceId: order.invoiceId } }), 0);

      const exactReference = provider === "STRIPE"
        ? stripeRefundWebhook(identity, `evt_application_exact_${sequence}`)
        : paypalRefundWebhook(
            identity,
            `WH-APPLICATION-EXACT-${sequence}`,
            "PAYMENT.CAPTURE.REFUNDED",
          );
      assert.equal((await processFixtureRefundEvent(provider, exactReference)).outcome, "PROCESSED");
      refund.release("PENDING");
      assert.equal(await decision, "SUCCEEDED");
      attempt = await prisma.refundAttempt.findUniqueOrThrow({ where: { id: identity.attemptId } });
      assert.deepEqual([attempt.status, attempt.failureCode], ["SUCCEEDED", null]);
      await assertSingleCancellationEffects(fixture, order, request.id, stockBefore);
    } finally {
      refund.release("PENDING");
      await client.$disconnect();
    }
  }

  for (const [provider, sequence, applicationCorrelation] of [
    ["STRIPE", 990053, "MISMATCH"],
    ["PAYPAL", 990054, "MISSING"],
  ] as const) {
    const refund = await createShopReturnRefundFixture(fixture, sequence, provider);
    const identity = shopReturnWebhookIdentity(refund);
    assert.deepEqual(await prisma.$transaction((tx) => applyShopReturnRefundEvidenceInTransaction(
      tx,
      refund.attemptId,
      shopRefundEvidence(identity, "SUCCEEDED", { applicationCorrelation }),
    )), { status: "REQUIRES_REVIEW", confirmed: false });
    assert.equal(await prisma.creditNote.count({ where: { shopReturnRequestId: refund.requestId } }), 0);
    const noReference = provider === "STRIPE"
      ? stripeRefundWebhook(identity, `evt_return_application_missing_${sequence}`, {
          includeApplicationMetadata: false,
        })
      : paypalRefundWebhook(
          identity,
          `WH-RETURN-APPLICATION-MISSING-${sequence}`,
          "PAYMENT.CAPTURE.REFUNDED",
          { includeApplicationReference: false },
        );
    assert.equal((await processFixtureRefundEvent(provider, noReference)).outcome, "REQUIRES_REVIEW");
    assert.equal(await prisma.creditNote.count({ where: { shopReturnRequestId: refund.requestId } }), 0);
    const exactReference = provider === "STRIPE"
      ? stripeRefundWebhook(identity, `evt_return_application_exact_${sequence}`)
      : paypalRefundWebhook(
          identity,
          `WH-RETURN-APPLICATION-EXACT-${sequence}`,
          "PAYMENT.CAPTURE.REFUNDED",
        );
    assert.equal((await processFixtureRefundEvent(provider, exactReference)).outcome, "PROCESSED");
    await assertSingleShopReturnRefundEffects(refund);
  }
  return "PASS" as const;
}

async function pendingReceiptFailureCanResolveFailedScenario(fixture: CancellationRuntimeFixture) {
  const refund = await createShopReturnRefundFixture(fixture, 990050, "PAYPAL");
  const identity = shopReturnWebhookIdentity(refund);
  const pending = paypalRefundWebhook(
    identity,
    "WH-SHOP-RETURN-PENDING-RECEIPT-FAILURE",
    "PAYMENT.REFUND.PENDING",
  );
  let triggerInstalled = false;
  try {
    await installOneShotProviderReceiptFailureTrigger();
    triggerInstalled = true;
    assert.equal((await processVerifiedPaypalFinancialEvent(pending)).outcome, "PROCESSED");
  } finally {
    if (triggerInstalled) await removeOneShotProviderReceiptFailureTrigger();
  }
  let attempt = await prisma.refundAttempt.findUniqueOrThrow({ where: { id: refund.attemptId } });
  assert.deepEqual(
    [attempt.status, attempt.failureCode, attempt.confirmedAt],
    ["REQUIRES_REVIEW", "PROVIDER_ACCEPTED_LOCAL_FINALIZATION_FAILED", null],
  );
  const gateway = immediateRefundGateway("FAILED");
  assert.deepEqual(await reconcileShopReturnRefund(
    fixture.adminA,
    refund.requestNumber,
    gateway.gateway,
    { client: prisma, assertEnabled: noRuntimeGuard },
  ), { status: "FAILED", confirmed: false });
  assert.deepEqual(gateway.counts(), { requestCalls: 0, retrieveCalls: 1 });
  const [request, payment, receipt] = await Promise.all([
    prisma.shopReturnRequest.findUniqueOrThrow({ where: { id: refund.requestId } }),
    prisma.payment.findUniqueOrThrow({ where: { id: refund.order.paymentId } }),
    prisma.providerEvent.findUniqueOrThrow({
      where: { provider_providerEventId: { provider: "PAYPAL", providerEventId: pending.id } },
    }),
  ]);
  attempt = await prisma.refundAttempt.findUniqueOrThrow({ where: { id: refund.attemptId } });
  assert.deepEqual(
    [attempt.status, attempt.failureCode, request.refundStatus, payment.status, receipt.outcome],
    ["FAILED", "PROVIDER_REFUND_FAILED", "FAILED", "SUCCEEDED", "PROCESSED"],
  );
  assert.equal(await prisma.creditNote.count({ where: { shopReturnRequestId: refund.requestId } }), 0);
  return "PASS" as const;
}

async function financialReviewAndShopReturnReservationRaceScenario(
  fixture: CancellationRuntimeFixture,
) {
  // Review wins: the webhook is first in PostgreSQL's advisory-lock queue, so
  // the SAV reservation must re-read paymentReviewAt and stop before provider.
  {
    const prepared = await createAuthorizedShopReturnForRefund(fixture, 990055, "PAYPAL");
    const blocker = isolatedCancellationRuntimeClient("review-wins-blocker");
    const requestClient = isolatedCancellationRuntimeClient("review-wins-request");
    const observer = isolatedCancellationRuntimeClient("review-wins-observer");
    const locked = deferred<void>();
    const release = deferred<void>();
    let blockerRun: Promise<unknown> | null = null;
    let providerCalls = 0;
    const gateway: ShopRefundGateway = {
      async request(input) {
        providerCalls += 1;
        return shopRefundEvidence(input);
      },
      async retrieve(input) {
        providerCalls += 1;
        return shopRefundEvidence(input);
      },
    };
    const externalIdentity: RefundWebhookIdentity = {
      attemptId: randomUUID(),
      paymentId: prepared.order.paymentId,
      provider: "PAYPAL",
      providerPaymentId: prepared.order.providerPaymentId,
      providerIdempotencyKey: `external-review-wins-${prepared.order.id}`,
      amountCents: prepared.order.amountCents,
    };
    try {
      blockerRun = blocker.$transaction(async (tx) => {
        await lockShopOrderForMutation(tx, prepared.order.id);
        locked.resolve();
        await release.promise;
      });
      await locked.promise;
      const event = paypalRefundWebhook(
        externalIdentity,
        "WH-REVIEW-WINS-SAV-RESERVATION",
        "PAYMENT.CAPTURE.REFUNDED",
        { includeApplicationReference: false },
      );
      const webhook = processVerifiedPaypalFinancialEvent(event);
      await waitForAdvisoryWaiter(observer);
      const reservation = requestShopReturnRefund(
        fixture.adminA,
        prepared.requestNumber,
        "NONE",
        gateway,
        RUNTIME_NOW,
        { client: requestClient, assertEnabled: noRuntimeGuard },
      ).then((value) => value, (error: unknown) => error);
      release.resolve();
      assert.equal((await webhook).outcome, "REQUIRES_REVIEW");
      const reservationResult = await reservation;
      assert.ok(
        reservationResult instanceof ShopAfterSalesError
        && reservationResult.code === "REFUND_REQUIRES_REVIEW",
      );
      assert.equal(providerCalls, 0);
      assert.equal(await prisma.refundAttempt.count({ where: { shopReturnRequestId: prepared.requestId } }), 0);
    } finally {
      release.resolve();
      await blockerRun;
      await Promise.all([blocker.$disconnect(), requestClient.$disconnect(), observer.$disconnect()]);
    }
  }

  // Reservation wins: one provider request may already be in flight, but the
  // later generic review is observed by finalization and prevents all effects.
  {
    const prepared = await createAuthorizedShopReturnForRefund(fixture, 990056, "STRIPE");
    const blocker = isolatedCancellationRuntimeClient("reservation-wins-blocker");
    const requestClient = isolatedCancellationRuntimeClient("reservation-wins-request");
    const observer = isolatedCancellationRuntimeClient("reservation-wins-observer");
    const locked = deferred<void>();
    const releaseLock = deferred<void>();
    const gatewayEntered = deferred<Parameters<ShopRefundGateway["request"]>[0]>();
    const releaseGateway = deferred<void>();
    let blockerRun: Promise<unknown> | null = null;
    let providerCalls = 0;
    const gateway: ShopRefundGateway = {
      async request(input) {
        providerCalls += 1;
        gatewayEntered.resolve(input);
        await releaseGateway.promise;
        return shopRefundEvidence(input);
      },
      async retrieve(input) {
        providerCalls += 1;
        return shopRefundEvidence(input);
      },
    };
    try {
      blockerRun = blocker.$transaction(async (tx) => {
        await lockShopOrderForMutation(tx, prepared.order.id);
        locked.resolve();
        await releaseLock.promise;
      });
      await locked.promise;
      const reservation = requestShopReturnRefund(
        fixture.adminA,
        prepared.requestNumber,
        "NONE",
        gateway,
        RUNTIME_NOW,
        { client: requestClient, assertEnabled: noRuntimeGuard },
      );
      await waitForAdvisoryWaiter(observer);
      const externalIdentity: RefundWebhookIdentity = {
        attemptId: randomUUID(),
        paymentId: prepared.order.paymentId,
        provider: "STRIPE",
        providerPaymentId: prepared.order.providerPaymentId,
        providerIdempotencyKey: `external-reservation-wins-${prepared.order.id}`,
        amountCents: prepared.order.amountCents,
      };
      const webhook = processVerifiedStripeFinancialEvent(stripeRefundWebhook(
        externalIdentity,
        "evt_reservation_wins_external_review",
        { includeApplicationMetadata: false, amountCents: prepared.order.amountCents - 1 },
      ));
      releaseLock.resolve();
      await gatewayEntered.promise;
      assert.equal((await webhook).outcome, "REQUIRES_REVIEW");
      releaseGateway.resolve();
      assert.equal((await reservation).status, "REQUIRES_REVIEW");
      const [attempt, payment] = await Promise.all([
        prisma.refundAttempt.findFirstOrThrow({ where: { shopReturnRequestId: prepared.requestId } }),
        prisma.payment.findUniqueOrThrow({ where: { id: prepared.order.paymentId } }),
      ]);
      assert.deepEqual(
        [providerCalls, attempt.status, attempt.failureCode, payment.status, payment.refundedAmountCents],
        [
          1,
          "REQUIRES_REVIEW",
          "SHOP_RETURN_REFUND_FINALIZATION_PRECONDITION_FAILED",
          "REFUND_PENDING",
          0,
        ],
      );
      assert.equal(await prisma.creditNote.count({ where: { shopReturnRequestId: prepared.requestId } }), 0);
    } finally {
      releaseLock.resolve();
      releaseGateway.resolve();
      await blockerRun;
      await Promise.all([blocker.$disconnect(), requestClient.$disconnect(), observer.$disconnect()]);
    }
  }
  return "PASS" as const;
}

async function exactLateSuccessAfterCertainRefusalScenario(fixture: CancellationRuntimeFixture) {
  for (const [provider, sequence] of [["STRIPE", 990057], ["PAYPAL", 990058]] as const) {
    const order = await createCancellationFixtureOrder(fixture, sequence, { provider });
    const request = await createCancellationRequest(fixture, order);
    const gateway: ShopRefundGateway = {
      async request() {
        throw new ShopRefundGatewayError("FAILED");
      },
      async retrieve() {
        throw new Error("retrieve must not be called");
      },
    };
    assert.equal(await decideShopCustomerRequest(
      fixture.adminA,
      request.requestNumber,
      "APPROVE",
      "Refus certain suivi d'une preuve terminale tardive.",
      gateway,
      RUNTIME_NOW,
      runtimeServiceClient,
    ), "FAILED");
    const failed = await prisma.refundAttempt.findUniqueOrThrow({
      where: { shopCustomerRequestId: request.id },
    });
    assert.deepEqual([failed.status, failed.providerRefundId], ["FAILED", null]);
    const identity: RefundWebhookIdentity = {
      attemptId: failed.id,
      paymentId: order.paymentId,
      provider,
      providerPaymentId: order.providerPaymentId,
      providerIdempotencyKey: failed.providerIdempotencyKey,
      amountCents: failed.amountCents,
    };
    const event = provider === "STRIPE"
      ? stripeRefundWebhook(identity, `evt_exact_late_success_${sequence}`)
      : paypalRefundWebhook(
          identity,
          `WH-EXACT-LATE-SUCCESS-${sequence}`,
          "PAYMENT.CAPTURE.REFUNDED",
        );
    assert.equal((await processFixtureRefundEvent(provider, event)).outcome, "REQUIRES_REVIEW");
    const [attempt, payment, receipt] = await Promise.all([
      prisma.refundAttempt.findUniqueOrThrow({ where: { id: failed.id } }),
      prisma.payment.findUniqueOrThrow({ where: { id: order.paymentId } }),
      prisma.providerEvent.findUniqueOrThrow({
        where: { provider_providerEventId: { provider, providerEventId: event.id } },
      }),
    ]);
    assert.deepEqual(
      [attempt.status, attempt.failureCode, attempt.providerRefundId, payment.status, payment.refundedAmountCents],
      [
        "REQUIRES_REVIEW",
        "REFUND_STATUS_CONFLICT",
        shopRefundEvidence(identity).providerRefundId,
        "REFUND_PENDING",
        0,
      ],
    );
    assert.ok(attempt.confirmedAt);
    assert.equal(receipt.refundAttemptId, failed.id);
    const replay = provider === "STRIPE"
      ? stripeRefundWebhook(identity, `evt_exact_late_success_replay_${sequence}`)
      : paypalRefundWebhook(
          identity,
          `WH-EXACT-LATE-SUCCESS-REPLAY-${sequence}`,
          "PAYMENT.CAPTURE.REFUNDED",
        );
    assert.equal((await processFixtureRefundEvent(provider, replay)).outcome, "REQUIRES_REVIEW");
    const afterReplay = await prisma.refundAttempt.findUniqueOrThrow({ where: { id: failed.id } });
    assert.deepEqual(
      [afterReplay.status, afterReplay.failureCode, afterReplay.providerRefundId],
      ["REQUIRES_REVIEW", "REFUND_STATUS_CONFLICT", shopRefundEvidence(identity).providerRefundId],
    );
    assert.equal(await prisma.creditNote.count({ where: { invoiceId: order.invoiceId } }), 0);
    assert.equal(await prisma.productStockAdjustment.count({
      where: { shopCustomerRequestId: request.id },
    }), 0);
    await expectFulfillmentBarrier(() => markShopOrderPreparing(
      order.orderNumber,
      fixture.adminB.id,
      RUNTIME_NOW,
      { client: prisma, assertEnabled: noRuntimeGuard },
    ));
  }
  return "PASS" as const;
}

async function terminalContradictionRestoresBarrierScenario(fixture: CancellationRuntimeFixture) {
  const order = await createCancellationFixtureOrder(fixture, 990033, { provider: "PAYPAL" });
  const request = await createCancellationRequest(fixture, order);
  const decisionClient = isolatedCancellationRuntimeClient("terminal-conflict-decision");
  const apiClient = isolatedCancellationRuntimeClient("terminal-conflict-api");
  const blocker = isolatedCancellationRuntimeClient("terminal-conflict-blocker");
  const observer = isolatedCancellationRuntimeClient("terminal-conflict-observer");
  const refund = delayedRefundGateway();
  const release = deferred<void>();
  const locked = deferred<void>();
  const apiAttempted = deferred<void>();
  const observedApiClient = observedAdvisoryLockClient(apiClient, apiAttempted);
  let blockerRun: Promise<unknown> | null = null;
  try {
    const decision = decideShopCustomerRequest(
      fixture.adminA,
      request.requestNumber,
      "APPROVE",
      "Échec API concurrent d'une preuve provider signée.",
      refund.gateway,
      RUNTIME_NOW,
      decisionClient,
    );
    const identity = refundWebhookIdentity(await refund.entered);
    blockerRun = blocker.$transaction(async (tx) => {
      await lockShopOrderForMutation(tx, order.id);
      locked.resolve();
      await release.promise;
    });
    await locked.promise;
    await assertOrderLockHeld(observer, order.id);
    const apiFailure = applyShopCustomerCancellationEvidence(
      observedApiClient,
      identity.attemptId,
      shopRefundEvidence(identity, "FAILED"),
    );
    await apiAttempted.promise;
    await waitForAdvisoryWaiter(observer);
    const webhook = processVerifiedPaypalFinancialEvent(paypalRefundWebhook(
      identity,
      "WH-TERMINAL-CONFLICT-SUCCEEDED",
      "PAYMENT.CAPTURE.REFUNDED",
      { includeApplicationReference: false },
    ));
    release.resolve();
    assert.equal(await apiFailure, "FAILED");
    assert.equal((await webhook).outcome, "REQUIRES_REVIEW");
    const [attempt, payment, state, receipt, creditNotes, stockAdjustments] = await Promise.all([
      prisma.refundAttempt.findUniqueOrThrow({ where: { id: identity.attemptId } }),
      prisma.payment.findUniqueOrThrow({ where: { id: order.paymentId } }),
      prisma.shopOrder.findUniqueOrThrow({ where: { id: order.id } }),
      prisma.providerEvent.findUniqueOrThrow({
        where: {
          provider_providerEventId: {
            provider: "PAYPAL",
            providerEventId: "WH-TERMINAL-CONFLICT-SUCCEEDED",
          },
        },
      }),
      prisma.creditNote.count({ where: { invoiceId: order.invoiceId } }),
      prisma.productStockAdjustment.count({
        where: { shopCustomerRequestId: request.id },
      }),
    ]);
    assert.deepEqual(
      [attempt.status, attempt.failureCode, payment.status],
      ["REQUIRES_REVIEW", "REFUND_STATUS_CONFLICT", "REFUND_PENDING"],
    );
    assert.equal(attempt.providerRefundId, shopRefundEvidence(identity).providerRefundId);
    assert.equal(payment.refundedAmountCents, 0);
    assert.equal(receipt.refundAttemptId, identity.attemptId);
    assert.equal(receipt.outcome, "REQUIRES_REVIEW");
    assert.equal(creditNotes, 0);
    assert.equal(stockAdjustments, 0);
    assert.ok(state.paymentReviewAt, "terminal contradiction must close fulfillment durably");
    await expectFulfillmentBarrier(() => markShopOrderPreparing(
      order.orderNumber,
      fixture.adminB.id,
      RUNTIME_NOW,
      { client: prisma, assertEnabled: noRuntimeGuard },
    ));
    refund.release("FAILED");
    assert.equal(await decision, "REQUIRES_REVIEW");
    return "PASS" as const;
  } finally {
    release.resolve();
    refund.release("FAILED");
    await blockerRun;
    await Promise.all([
      decisionClient.$disconnect(),
      apiClient.$disconnect(),
      blocker.$disconnect(),
      observer.$disconnect(),
    ]);
  }
}

async function concurrentShopReturnCapacityScenario(fixture: CancellationRuntimeFixture) {
  const first = await createShopReturnRefundFixture(
    fixture,
    990034,
    "STRIPE",
    { amountCents: 700 },
  );
  const second = await createShopReturnRefundFixture(
    fixture,
    990035,
    "STRIPE",
    { order: first.order, amountCents: 700 },
  );
  const firstClient = isolatedCancellationRuntimeClient("return-capacity-first");
  const secondClient = isolatedCancellationRuntimeClient("return-capacity-second");
  const blocker = isolatedCancellationRuntimeClient("return-capacity-blocker");
  const firstAttempted = deferred<void>();
  const secondAttempted = deferred<void>();
  const release = deferred<void>();
  const locked = deferred<void>();
  const firstObserved = observedAdvisoryLockClient(firstClient, firstAttempted);
  const secondObserved = observedAdvisoryLockClient(secondClient, secondAttempted);
  let blockerRun: Promise<unknown> | null = null;
  try {
    blockerRun = blocker.$transaction(async (tx) => {
      await lockShopRefundCapacity(tx, first.order.paymentId);
      locked.resolve();
      await release.promise;
    });
    await locked.promise;
    const firstResult = firstObserved.$transaction((tx) => applyShopReturnRefundEvidenceInTransaction(
      tx,
      first.attemptId,
      shopRefundEvidence(shopReturnWebhookIdentity(first)),
    ));
    const secondResult = secondObserved.$transaction((tx) => applyShopReturnRefundEvidenceInTransaction(
      tx,
      second.attemptId,
      shopRefundEvidence(shopReturnWebhookIdentity(second)),
    ));
    await Promise.all([firstAttempted.promise, secondAttempted.promise]);
    await waitForAdvisoryWaiter(prisma, 2);
    release.resolve();
    const results = await Promise.all([firstResult, secondResult]);
    assert.deepEqual(
      results.map((entry) => entry.status).sort(),
      ["REQUIRES_REVIEW", "SUCCEEDED"],
    );
    const [payment, attempts, notes] = await Promise.all([
      prisma.payment.findUniqueOrThrow({ where: { id: first.order.paymentId } }),
      prisma.refundAttempt.findMany({ where: { id: { in: [first.attemptId, second.attemptId] } } }),
      prisma.creditNote.findMany({ where: { invoiceId: first.order.invoiceId } }),
    ]);
    const confirmedCents = attempts
      .filter((attempt) => attempt.status === "SUCCEEDED")
      .reduce((sum, attempt) => sum + attempt.amountCents, 0);
    assert.equal(confirmedCents, 700);
    assert.equal(payment.refundedAmountCents, confirmedCents);
    assert.ok(payment.refundedAmountCents <= payment.amountCents);
    assert.equal(payment.status, "REFUND_PENDING");
    assert.equal(notes.length, 1);
    return "PASS" as const;
  } finally {
    release.resolve();
    await blockerRun;
    await Promise.all([firstClient.$disconnect(), secondClient.$disconnect(), blocker.$disconnect()]);
  }
}

async function deferredCandidateRevalidatedUnderLockScenario(fixture: CancellationRuntimeFixture) {
  const first = await createShopReturnRefundFixture(fixture, 990036, "STRIPE");
  const second = await createShopReturnRefundFixture(
    fixture,
    990037,
    "STRIPE",
    { order: first.order },
  );
  await prisma.refundAttempt.update({
    where: { id: second.attemptId },
    data: { status: "FAILED", failureCode: "PROVIDER_REFUND_FAILED" },
  });
  const identity = shopReturnWebhookIdentity(first);
  const blocker = isolatedCancellationRuntimeClient("deferred-candidate-blocker");
  const observer = isolatedCancellationRuntimeClient("deferred-candidate-observer");
  const release = deferred<void>();
  const locked = deferred<void>();
  let blockerRun: Promise<unknown> | null = null;
  try {
    blockerRun = blocker.$transaction(async (tx) => {
      await lockShopOrderForMutation(tx, first.order.id);
      locked.resolve();
      await release.promise;
    });
    await locked.promise;
    const event = stripeRefundWebhook(identity, "evt_deferred_candidate_revalidated", {
      includeApplicationMetadata: false,
      status: "pending",
    });
    const webhook = processVerifiedStripeFinancialEvent(event);
    await waitForAdvisoryWaiter(observer);
    await prisma.refundAttempt.update({
      where: { id: second.attemptId },
      data: { status: "PROCESSING", failureCode: null },
    });
    release.resolve();
    assert.equal((await webhook).outcome, "REQUIRES_REVIEW");
    const [firstAttempt, secondAttempt, state, receipt] = await Promise.all([
      prisma.refundAttempt.findUniqueOrThrow({ where: { id: first.attemptId } }),
      prisma.refundAttempt.findUniqueOrThrow({ where: { id: second.attemptId } }),
      prisma.shopOrder.findUniqueOrThrow({ where: { id: first.order.id } }),
      prisma.providerEvent.findUniqueOrThrow({
        where: { provider_providerEventId: { provider: "STRIPE", providerEventId: event.id } },
      }),
    ]);
    assert.deepEqual([firstAttempt.status, secondAttempt.status], ["PROCESSING", "PROCESSING"]);
    assert.equal(firstAttempt.providerRefundId, null);
    assert.ok(state.paymentReviewAt, "candidate ambiguity discovered under lock must become generic review");
    assert.equal(receipt.refundAttemptId, null);
    return "PASS" as const;
  } finally {
    release.resolve();
    await blockerRun;
    await Promise.all([blocker.$disconnect(), observer.$disconnect()]);
  }
}

async function receiptFailurePreservesCorrelatedEvidenceScenario(fixture: CancellationRuntimeFixture) {
  const refund = await createShopReturnRefundFixture(fixture, 990038, "PAYPAL");
  const identity = shopReturnWebhookIdentity(refund);
  const event = paypalRefundWebhook(
    identity,
    "WH-SHOP-RETURN-RECEIPT-FAILURE",
    "PAYMENT.CAPTURE.REFUNDED",
  );
  let triggerInstalled = false;
  try {
    await installOneShotProviderReceiptFailureTrigger();
    triggerInstalled = true;
    assert.equal((await processVerifiedPaypalFinancialEvent(event)).outcome, "PROCESSED");
  } finally {
    if (triggerInstalled) await removeOneShotProviderReceiptFailureTrigger();
  }
  const [review, receipt] = await Promise.all([
    prisma.refundAttempt.findUniqueOrThrow({ where: { id: refund.attemptId }, include: { payment: true } }),
    prisma.providerEvent.findUniqueOrThrow({
      where: { provider_providerEventId: { provider: "PAYPAL", providerEventId: event.id } },
    }),
  ]);
  assert.deepEqual(
    [review.status, review.failureCode, review.payment.status, receipt.outcome],
    ["REQUIRES_REVIEW", "PROVIDER_ACCEPTED_LOCAL_FINALIZATION_FAILED", "REFUND_PENDING", "PROCESSED"],
  );
  assert.equal(receipt.refundAttemptId, refund.attemptId);
  assert.equal(await prisma.creditNote.count({ where: { shopReturnRequestId: refund.requestId } }), 0);
  const gateway = immediateRefundGateway("SUCCEEDED");
  assert.deepEqual(await reconcileShopReturnRefund(
    fixture.adminA,
    refund.requestNumber,
    gateway.gateway,
    { client: prisma, assertEnabled: noRuntimeGuard },
  ), { status: "SUCCEEDED", confirmed: true });
  assert.deepEqual(gateway.counts(), { requestCalls: 0, retrieveCalls: 1 });
  await assertSingleShopReturnRefundEffects(refund);
  return "PASS" as const;
}

async function failedReceiptFailurePreservesBarrierScenario(fixture: CancellationRuntimeFixture) {
  const refund = await createShopReturnRefundFixture(fixture, 990039, "STRIPE");
  const identity = shopReturnWebhookIdentity(refund);
  const event = stripeRefundWebhook(identity, "evt_shop_return_failed_receipt_failure", {
    status: "failed",
  });
  let triggerInstalled = false;
  try {
    await installOneShotProviderReceiptFailureTrigger();
    triggerInstalled = true;
    assert.equal((await processVerifiedStripeFinancialEvent(event)).outcome, "PROCESSED");
  } finally {
    if (triggerInstalled) await removeOneShotProviderReceiptFailureTrigger();
  }
  const [attempt, request, payment, receipt] = await Promise.all([
    prisma.refundAttempt.findUniqueOrThrow({ where: { id: refund.attemptId } }),
    prisma.shopReturnRequest.findUniqueOrThrow({ where: { id: refund.requestId } }),
    prisma.payment.findUniqueOrThrow({ where: { id: refund.order.paymentId } }),
    prisma.providerEvent.findUniqueOrThrow({
      where: { provider_providerEventId: { provider: "STRIPE", providerEventId: event.id } },
    }),
  ]);
  assert.deepEqual(
    [attempt.status, attempt.failureCode, request.refundStatus, payment.status, receipt.outcome],
    [
      "REQUIRES_REVIEW",
      "PROVIDER_FAILED_LOCAL_FINALIZATION_FAILED",
      "REQUIRES_REVIEW",
      "REFUND_PENDING",
      "PROCESSED",
    ],
  );
  assert.equal(payment.refundedAmountCents, 0);
  assert.equal(await prisma.creditNote.count({ where: { shopReturnRequestId: refund.requestId } }), 0);
  return "PASS" as const;
}

async function cancellationAndShopReturnRestockSerializeScenario(
  fixture: CancellationRuntimeFixture,
) {
  const secondProduct = await prisma.product.create({ data: {
    slug: "lnx-v110-cancellation-runtime-second-cd",
    title: "Second CD fictif — ordre de verrous",
    description: "Deuxième produit PostgreSQL local pour prouver l'ordre total des restocks.",
    status: "PUBLISHED",
    priceCents: 350,
    currency: "EUR",
    trackInventory: true,
    stock: 30,
    shippingRequired: true,
    shippingPriceCents: 0,
    shippingWeightGrams: 25,
    publishedAt: RUNTIME_NOW,
    createdByAdminId: fixture.adminA.id,
    updatedByAdminId: fixture.adminA.id,
    createdAt: RUNTIME_NOW,
  } });
  const cancellationOrder = await createCancellationFixtureOrder(fixture, 990059, {
    provider: "PAYPAL",
  });
  const returnOrder = await createCancellationFixtureOrder(fixture, 990060, {
    provider: "STRIPE",
  });
  for (const order of [cancellationOrder, returnOrder]) {
    await prisma.shopOrderItem.update({
      where: {
        shopOrderId_productId: { shopOrderId: order.id, productId: fixture.productId },
      },
      data: { unitPriceCents: 350, lineTotalCents: 350 },
    });
    await prisma.shopOrderItem.create({ data: {
      shopOrderId: order.id,
      productId: secondProduct.id,
      position: 1,
      productTitle: secondProduct.title,
      inventoryTracked: true,
      unitPriceCents: 350,
      quantity: 1,
      lineTotalCents: 350,
      shippingRequired: true,
      unitShippingCents: 0,
      lineShippingCents: 0,
      unitShippingWeightGrams: 25,
      lineShippingWeightGrams: 25,
      currency: "EUR",
      createdAt: RUNTIME_NOW,
    } });
    const state = await prisma.shopOrder.findUniqueOrThrow({
      where: { id: order.id },
      select: { reservationExpiresAt: true, paidAt: true },
    });
    assert.ok(state.paidAt, "the paid fixture order requires a confirmation timestamp");
    await prisma.stockReservation.create({ data: {
      shopOrderId: order.id,
      productId: secondProduct.id,
      quantity: 1,
      status: "CONFIRMED",
      expiresAt: state.reservationExpiresAt,
      confirmedAt: state.paidAt,
      createdAt: state.paidAt,
    } });
  }
  const cancellationRequest = await createCancellationRequest(fixture, cancellationOrder);
  const productIds = [fixture.productId, secondProduct.id].sort((left, right) =>
    left.localeCompare(right));
  const descendingProductIds = [...productIds].reverse();
  const returnRequest = await createMemberShopReturn(fixture.member, {
    orderNumber: returnOrder.orderNumber,
    type: "NON_CONFORMING",
    comment: "Retour fictif concurrent à une annulation sur les mêmes produits.",
    quantities: new Map(descendingProductIds.map((productId) => [productId, 1])),
  }, RUNTIME_NOW, { client: runtimeServiceClient, assertEnabled: noRuntimeGuard });
  await startShopReturnReview(
    fixture.adminA,
    returnRequest.requestNumber,
    RUNTIME_NOW,
    { client: runtimeServiceClient, assertEnabled: noRuntimeGuard },
  );
  await decideShopReturn(fixture.adminA, {
    requestNumber: returnRequest.requestNumber,
    decision: "APPROVE",
    authorizedQuantities: new Map(descendingProductIds.map((productId) => [productId, 1])),
    physicalReturnRequired: true,
    returnCostDecision: "CUSTOMER",
    instructions: "Retour PostgreSQL local uniquement.",
    comment: "Autorisation fictive de retour physique.",
  }, RUNTIME_NOW, {
    client: runtimeServiceClient,
    assertEnabled: noRuntimeGuard,
    immediateRefund: false,
  });
  await markShopReturnReceived(
    fixture.adminA,
    returnRequest.requestNumber,
    new Map(descendingProductIds.map((productId) => [productId, 1])),
    RUNTIME_NOW,
    { client: runtimeServiceClient, assertEnabled: noRuntimeGuard },
  );
  await inspectShopReturn(fixture.adminA, {
    requestNumber: returnRequest.requestNumber,
    lines: new Map(descendingProductIds.map((productId) => [productId, {
      condition: "SEALED" as const,
      decision: "RESTOCKABLE" as const,
      restockableQuantity: 1,
      refundableQuantity: 1,
      comment: "Unité fictive restockable.",
    }])),
  }, RUNTIME_NOW, { client: runtimeServiceClient, assertEnabled: noRuntimeGuard });

  const blocker = isolatedCancellationRuntimeClient("shared-product-stock-blocker");
  const cancellationClient = isolatedCancellationRuntimeClient("shared-product-stock-cancellation");
  const returnClient = isolatedCancellationRuntimeClient("shared-product-stock-return");
  const observer = isolatedCancellationRuntimeClient("shared-product-stock-observer");
  const locked = deferred<void>();
  const release = deferred<void>();
  const refund = delayedRefundGateway();
  let blockerRun: Promise<unknown> | null = null;
  const stockBefore = new Map((await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, stock: true },
  })).map((product) => [product.id, product.stock!]));
  const firstProductId = productIds[0]!;
  const secondProductId = productIds[1]!;
  try {
    blockerRun = blocker.$transaction(async (tx) => {
      await lockShopProductStockForMutation(tx, firstProductId);
      locked.resolve();
      await release.promise;
    }, { timeout: 30_000 });
    await locked.promise;
    await assertProductStockLockHeld(observer, firstProductId);

    const cancellation = decideShopCustomerRequest(
      fixture.adminA,
      cancellationRequest.requestNumber,
      "APPROVE",
      "Annulation fictive concurrente au restock SAV.",
      refund.gateway,
      RUNTIME_NOW,
      cancellationClient,
    );
    await refund.entered;
    const returned = restockShopReturn(
      fixture.adminA,
      returnRequest.requestNumber,
      RUNTIME_NOW,
      { client: returnClient, assertEnabled: noRuntimeGuard },
    );
    refund.release("SUCCEEDED");
    await waitForAdvisoryWaiter(observer, 2);
    await assertProductStockLockAvailable(observer, secondProductId);
    release.resolve();

    assert.equal(await cancellation, "SUCCEEDED");
    assert.deepEqual(await returned, { restockedQuantity: 2 });
    const [products, adjustments] = await Promise.all([
      prisma.product.findMany({ where: { id: { in: productIds } } }),
      prisma.productStockAdjustment.findMany({
        where: {
          productId: { in: productIds },
          OR: [
            { shopCustomerRequestId: cancellationRequest.id },
            { shopReturnRequestId: returnRequest.id },
          ],
        },
        orderBy: [{ stockAfter: "asc" }, { id: "asc" }],
      }),
    ]);
    assert.equal(adjustments.length, 4);
    for (const product of products) {
      const before = stockBefore.get(product.id)!;
      assert.equal(product.stock, before + 2);
      const productAdjustments = adjustments
        .filter((adjustment) => adjustment.productId === product.id)
        .sort((left, right) => left.stockAfter - right.stockAfter);
      assert.deepEqual(
        productAdjustments.map(({ delta, stockBefore: prior, stockAfter: after }) =>
          [delta, prior, after]),
        [
          [1, before, before + 1],
          [1, before + 1, before + 2],
        ],
      );
      assert.ok(productAdjustments.some(({ shopCustomerRequestId }) =>
        shopCustomerRequestId === cancellationRequest.id));
      assert.ok(productAdjustments.some(({ shopReturnRequestId }) =>
        shopReturnRequestId === returnRequest.id));
    }
    return "PASS" as const;
  } finally {
    release.resolve();
    refund.release("SUCCEEDED");
    await blockerRun;
    await Promise.all([
      blocker.$disconnect(),
      cancellationClient.$disconnect(),
      returnClient.$disconnect(),
      observer.$disconnect(),
    ]);
  }
}

async function shopReturnRestockWinsSameOrderScenario(
  fixture: CancellationRuntimeFixture,
) {
  const order = await createCancellationFixtureOrder(fixture, 990063, { provider: "PAYPAL" });
  const shopReturn = await createAuthorizedShopReturnForOrder(
    fixture,
    order,
    { physicalReturnRequired: true },
  );
  await makeShopReturnRestockable(fixture, shopReturn.requestNumber);
  const cancellationRequest = await createCancellationRequest(fixture, order);
  const restockClient = isolatedCancellationRuntimeClient("same-order-restock-winner");
  const cancellationClient = isolatedCancellationRuntimeClient("same-order-cancellation-loser");
  const observer = isolatedCancellationRuntimeClient("same-order-restock-observer");
  const cancellationLockAttempted = deferred<void>();
  const observedCancellationClient = observedAdvisoryLockClient(
    cancellationClient,
    cancellationLockAttempted,
  );
  const restockEntered = deferred<void>();
  const releaseRestock = deferred<void>();
  const refund = immediateRefundGateway("SUCCEEDED");
  const stockBefore = (await prisma.product.findUniqueOrThrow({
    where: { id: fixture.productId },
  })).stock!;
  try {
    const restock = restockShopReturn(
      fixture.adminA,
      shopReturn.requestNumber,
      RUNTIME_NOW,
      {
        client: restockClient,
        assertEnabled: noRuntimeGuard,
        beforeCommitForTesting: async () => {
          restockEntered.resolve();
          await releaseRestock.promise;
        },
      },
    );
    await restockEntered.promise;
    await assertOrderLockHeld(observer, order.id);
    const cancellation = decideShopCustomerRequest(
      fixture.adminB,
      cancellationRequest.requestNumber,
      "APPROVE",
      "Annulation concurrente après disposition SAV restockable.",
      refund.gateway,
      RUNTIME_NOW,
      observedCancellationClient,
    ).then(
      (value) => ({ value, error: null as unknown }),
      (error: unknown) => ({ value: null, error }),
    );
    await cancellationLockAttempted.promise;
    await waitForAdvisoryWaiter(observer);
    assert.deepEqual(refund.counts(), { requestCalls: 0, retrieveCalls: 0 });
    releaseRestock.resolve();
    assert.deepEqual(await restock, { restockedQuantity: 1 });
    const cancellationOutcome = await cancellation;
    assert.ok(
      cancellationOutcome.error instanceof ShopCustomerRequestError
      && cancellationOutcome.error.code === "REFUND_REQUIRES_REVIEW",
    );
    assert.equal(cancellationOutcome.value, null);
    assert.deepEqual(refund.counts(), { requestCalls: 0, retrieveCalls: 0 });
    assert.equal(await prisma.refundAttempt.count({
      where: { shopCustomerRequestId: cancellationRequest.id },
    }), 0);
    assert.equal(await prisma.productStockAdjustment.count({
      where: { shopReturnRequestId: shopReturn.id },
    }), 1);
    assert.equal((await prisma.product.findUniqueOrThrow({
      where: { id: fixture.productId },
    })).stock, stockBefore + 1);
    return "PASS" as const;
  } finally {
    releaseRestock.resolve();
    await Promise.all([
      restockClient.$disconnect(),
      cancellationClient.$disconnect(),
      observer.$disconnect(),
    ]);
  }
}

async function shopReturnInspectionWinsSameOrderScenario(
  fixture: CancellationRuntimeFixture,
) {
  const order = await createCancellationFixtureOrder(fixture, 990071, { provider: "STRIPE" });
  const shopReturn = await createAuthorizedShopReturnForOrder(
    fixture,
    order,
    { physicalReturnRequired: true },
  );
  await markShopReturnReceived(
    fixture.adminA,
    shopReturn.requestNumber,
    new Map([[fixture.productId, 1]]),
    RUNTIME_NOW,
    { client: runtimeServiceClient, assertEnabled: noRuntimeGuard },
  );
  const cancellationRequest = await createCancellationRequest(fixture, order);
  const inspectionClient = isolatedCancellationRuntimeClient("same-order-inspection-winner");
  const cancellationClient = isolatedCancellationRuntimeClient("same-order-inspection-cancellation");
  const observer = isolatedCancellationRuntimeClient("same-order-inspection-observer");
  const cancellationLockAttempted = deferred<void>();
  const observedCancellationClient = observedAdvisoryLockClient(
    cancellationClient,
    cancellationLockAttempted,
  );
  const inspectionEntered = deferred<void>();
  const releaseInspection = deferred<void>();
  const refund = immediateRefundGateway("SUCCEEDED");
  const stockBefore = (await prisma.product.findUniqueOrThrow({
    where: { id: fixture.productId },
  })).stock!;
  try {
    const inspection = inspectShopReturn(fixture.adminA, {
      requestNumber: shopReturn.requestNumber,
      lines: new Map([[fixture.productId, {
        condition: "SEALED" as const,
        decision: "RESTOCKABLE" as const,
        restockableQuantity: 1,
        refundableQuantity: 1,
        comment: "Inspection gagnante sous verrou commande.",
      }]]),
    }, RUNTIME_NOW, {
      client: inspectionClient,
      assertEnabled: noRuntimeGuard,
      beforeCommitForTesting: async () => {
        inspectionEntered.resolve();
        await releaseInspection.promise;
      },
    });
    await inspectionEntered.promise;
    await assertOrderLockHeld(observer, order.id);
    const cancellation = decideShopCustomerRequest(
      fixture.adminB,
      cancellationRequest.requestNumber,
      "APPROVE",
      "Annulation concurrente après inspection restockable.",
      refund.gateway,
      RUNTIME_NOW,
      observedCancellationClient,
    ).then(
      (value) => ({ value, error: null as unknown }),
      (error: unknown) => ({ value: null, error }),
    );
    await cancellationLockAttempted.promise;
    await waitForAdvisoryWaiter(observer);
    assert.deepEqual(refund.counts(), { requestCalls: 0, retrieveCalls: 0 });
    releaseInspection.resolve();
    assert.equal((await inspection).status, "INSPECTED");
    const cancellationOutcome = await cancellation;
    assert.ok(
      cancellationOutcome.error instanceof ShopCustomerRequestError
      && cancellationOutcome.error.code === "REFUND_REQUIRES_REVIEW",
    );
    assert.equal(cancellationOutcome.value, null);
    assert.deepEqual(refund.counts(), { requestCalls: 0, retrieveCalls: 0 });
    assert.equal(await prisma.refundAttempt.count({
      where: { shopCustomerRequestId: cancellationRequest.id },
    }), 0);
    assert.equal(await prisma.productStockAdjustment.count({
      where: { shopReturnRequestId: shopReturn.id },
    }), 0);
    assert.equal((await prisma.product.findUniqueOrThrow({
      where: { id: fixture.productId },
    })).stock, stockBefore);
    return "PASS" as const;
  } finally {
    releaseInspection.resolve();
    await Promise.all([
      inspectionClient.$disconnect(),
      cancellationClient.$disconnect(),
      observer.$disconnect(),
    ]);
  }
}

async function cancellationBarrierStopsSavMutationsScenario(
  fixture: CancellationRuntimeFixture,
) {
  {
    const order = await createCancellationFixtureOrder(fixture, 990064, { provider: "STRIPE" });
    const request = await createCancellationRequest(fixture, order);
    const cancellationClient = isolatedCancellationRuntimeClient("cancellation-blocks-sav-create");
    const savClient = isolatedCancellationRuntimeClient("blocked-sav-create");
    const refund = delayedRefundGateway();
    const stockBefore = (await prisma.product.findUniqueOrThrow({
      where: { id: fixture.productId },
    })).stock!;
    try {
      const cancellation = decideShopCustomerRequest(
        fixture.adminA,
        request.requestNumber,
        "APPROVE",
        "Réservation annulation avant création SAV concurrente.",
        refund.gateway,
        RUNTIME_NOW,
        cancellationClient,
      );
      await refund.entered;
      await assert.rejects(
        () => createMemberShopReturn(fixture.member, {
          orderNumber: order.orderNumber,
          type: "NON_CONFORMING",
          comment: "Création SAV concurrente à refuser.",
          quantities: new Map([[fixture.productId, 1]]),
        }, RUNTIME_NOW, { client: savClient, assertEnabled: noRuntimeGuard }),
        (error: unknown) => error instanceof ShopAfterSalesError && error.code === "ORDER_NOT_ELIGIBLE",
      );
      assert.equal(await prisma.shopReturnRequest.count({ where: { shopOrderId: order.id } }), 0);
      refund.release("SUCCEEDED");
      assert.equal(await cancellation, "SUCCEEDED");
      await assertSingleCancellationEffects(fixture, order, request.id, stockBefore);
    } finally {
      refund.release("SUCCEEDED");
      await Promise.all([cancellationClient.$disconnect(), savClient.$disconnect()]);
    }
  }

  {
    const order = await createCancellationFixtureOrder(fixture, 990065, { provider: "PAYPAL" });
    const shopReturn = await createAuthorizedShopReturnForOrder(fixture, order);
    const request = await createCancellationRequest(fixture, order);
    const cancellationClient = isolatedCancellationRuntimeClient("cancellation-blocks-sav-refund");
    const savClient = isolatedCancellationRuntimeClient("blocked-sav-refund");
    const cancellationRefund = delayedRefundGateway();
    const savRefund = immediateRefundGateway("SUCCEEDED");
    const stockBefore = (await prisma.product.findUniqueOrThrow({
      where: { id: fixture.productId },
    })).stock!;
    try {
      const cancellation = decideShopCustomerRequest(
        fixture.adminA,
        request.requestNumber,
        "APPROVE",
        "Réservation annulation avant remboursement SAV concurrent.",
        cancellationRefund.gateway,
        RUNTIME_NOW,
        cancellationClient,
      );
      await cancellationRefund.entered;
      await assert.rejects(
        () => requestShopReturnRefund(
          fixture.adminB,
          shopReturn.requestNumber,
          "NONE",
          savRefund.gateway,
          RUNTIME_NOW,
          { client: savClient, assertEnabled: noRuntimeGuard },
        ),
        (error: unknown) => error instanceof ShopAfterSalesError && error.code === "REFUND_REQUIRES_REVIEW",
      );
      assert.deepEqual(savRefund.counts(), { requestCalls: 0, retrieveCalls: 0 });
      assert.equal(await prisma.refundAttempt.count({
        where: { shopReturnRequestId: shopReturn.id },
      }), 0);
      cancellationRefund.release("SUCCEEDED");
      assert.equal(await cancellation, "SUCCEEDED");
      await assertSingleCancellationEffects(fixture, order, request.id, stockBefore);
    } finally {
      cancellationRefund.release("SUCCEEDED");
      await Promise.all([cancellationClient.$disconnect(), savClient.$disconnect()]);
    }
  }

  {
    const order = await createCancellationFixtureOrder(fixture, 990066, { provider: "PAYPAL" });
    const shopReturn = await createAuthorizedShopReturnForOrder(
      fixture,
      order,
      { physicalReturnRequired: true },
    );
    const request = await createCancellationRequest(fixture, order);
    const cancellationClient = isolatedCancellationRuntimeClient("cancellation-before-sav-inspection");
    const savClient = isolatedCancellationRuntimeClient("blocked-sav-restock");
    const cancellationRefund = delayedRefundGateway();
    const stockBefore = (await prisma.product.findUniqueOrThrow({
      where: { id: fixture.productId },
    })).stock!;
    try {
      const cancellation = decideShopCustomerRequest(
        fixture.adminA,
        request.requestNumber,
        "APPROVE",
        "Inspection SAV reçue pendant l'appel de remboursement.",
        cancellationRefund.gateway,
        RUNTIME_NOW,
        cancellationClient,
      );
      await cancellationRefund.entered;
      await markShopReturnReceived(
        fixture.adminA,
        shopReturn.requestNumber,
        new Map([[fixture.productId, 1]]),
        RUNTIME_NOW,
        { client: runtimeServiceClient, assertEnabled: noRuntimeGuard },
      );
      await assert.rejects(
        () => inspectShopReturn(fixture.adminB, {
          requestNumber: shopReturn.requestNumber,
          lines: new Map([[fixture.productId, {
            condition: "SEALED" as const,
            decision: "RESTOCKABLE" as const,
            restockableQuantity: 1,
            refundableQuantity: 1,
            comment: "Inspection concurrente à refuser.",
          }]]),
        }, RUNTIME_NOW, { client: savClient, assertEnabled: noRuntimeGuard }),
        (error: unknown) => error instanceof ShopAfterSalesError && error.code === "RESTOCK_NOT_ALLOWED",
      );
      await assert.rejects(
        () => restockShopReturn(
          fixture.adminB,
          shopReturn.requestNumber,
          RUNTIME_NOW,
          { client: savClient, assertEnabled: noRuntimeGuard },
        ),
        (error: unknown) => error instanceof ShopAfterSalesError && error.code === "RESTOCK_NOT_ALLOWED",
      );
      cancellationRefund.release("SUCCEEDED");
      assert.equal(await cancellation, "SUCCEEDED");
      assert.equal(await prisma.productStockAdjustment.count({
        where: {
          OR: [
            { shopReturnRequestId: shopReturn.id },
            { shopCustomerRequestId: request.id },
          ],
        },
      }), 1);
      await assertSingleCancellationEffects(fixture, order, request.id, stockBefore);
    } finally {
      cancellationRefund.release("SUCCEEDED");
      await Promise.all([cancellationClient.$disconnect(), savClient.$disconnect()]);
    }
  }
  return "PASS" as const;
}

async function failedSavRefundDoesNotBlockCancellationScenario(
  fixture: CancellationRuntimeFixture,
) {
  const order = await createCancellationFixtureOrder(fixture, 990067, { provider: "STRIPE" });
  const shopReturn = await createAuthorizedShopReturnForOrder(fixture, order);
  const cancellationRequest = await createCancellationRequest(fixture, order);
  const savClient = isolatedCancellationRuntimeClient("sav-refund-winner");
  const cancellationClient = isolatedCancellationRuntimeClient("sav-refund-cancellation");
  const savRefund = delayedRefundGateway();
  const cancellationRefund = immediateRefundGateway("SUCCEEDED");
  const stockBefore = (await prisma.product.findUniqueOrThrow({
    where: { id: fixture.productId },
  })).stock!;
  try {
    const savDecision = requestShopReturnRefund(
      fixture.adminA,
      shopReturn.requestNumber,
      "NONE",
      savRefund.gateway,
      RUNTIME_NOW,
      { client: savClient, assertEnabled: noRuntimeGuard },
    );
    await savRefund.entered;
    await assert.rejects(
      () => decideShopCustomerRequest(
        fixture.adminB,
        cancellationRequest.requestNumber,
        "APPROVE",
        "Tentative annulation pendant exposition SAV.",
        cancellationRefund.gateway,
        RUNTIME_NOW,
        cancellationClient,
      ),
      (error: unknown) => error instanceof ShopCustomerRequestError && error.code === "REFUND_REQUIRES_REVIEW",
    );
    assert.deepEqual(cancellationRefund.counts(), { requestCalls: 0, retrieveCalls: 0 });
    savRefund.release("FAILED");
    assert.equal((await savDecision).status, "FAILED");
    const failedAttempt = await prisma.refundAttempt.findUniqueOrThrow({
      where: { shopReturnRequestId: shopReturn.id },
    });
    assert.deepEqual([failedAttempt.status, failedAttempt.failureCode], ["FAILED", "PROVIDER_REFUND_FAILED"]);
    assert.equal(await decideShopCustomerRequest(
      fixture.adminB,
      cancellationRequest.requestNumber,
      "APPROVE",
      "Annulation permise après refus SAV certain sans effet stock.",
      cancellationRefund.gateway,
      RUNTIME_NOW,
      cancellationClient,
    ), "SUCCEEDED");
    assert.deepEqual(cancellationRefund.counts(), { requestCalls: 1, retrieveCalls: 0 });
    await assertSingleCancellationEffects(fixture, order, cancellationRequest.id, stockBefore);
    return "PASS" as const;
  } finally {
    savRefund.release("FAILED");
    await Promise.all([savClient.$disconnect(), cancellationClient.$disconnect()]);
  }
}

async function cancellationInventoryReservationGuardScenario(
  fixture: CancellationRuntimeFixture,
) {
  {
    const order = await createCancellationFixtureOrder(fixture, 990068, { provider: "PAYPAL" });
    await prisma.stockReservation.delete({
      where: {
        shopOrderId_productId: { shopOrderId: order.id, productId: fixture.productId },
      },
    });
    const request = await createCancellationRequest(fixture, order);
    const refund = immediateRefundGateway("SUCCEEDED");
    await assert.rejects(
      () => decideShopCustomerRequest(
        fixture.adminA,
        request.requestNumber,
        "APPROVE",
        "Réservation stock manquante avant provider.",
        refund.gateway,
        RUNTIME_NOW,
        runtimeServiceClient,
      ),
      (error: unknown) => error instanceof ShopCustomerRequestError && error.code === "REFUND_REQUIRES_REVIEW",
    );
    assert.deepEqual(refund.counts(), { requestCalls: 0, retrieveCalls: 0 });
    assert.equal(await prisma.refundAttempt.count({ where: { shopCustomerRequestId: request.id } }), 0);
  }

  {
    const order = await createCancellationFixtureOrder(fixture, 990069, { provider: "STRIPE" });
    const request = await createCancellationRequest(fixture, order);
    const cancellationClient = isolatedCancellationRuntimeClient("reservation-invalid-after-provider");
    const refund = delayedRefundGateway();
    const stockBefore = (await prisma.product.findUniqueOrThrow({
      where: { id: fixture.productId },
    })).stock!;
    try {
      const cancellation = decideShopCustomerRequest(
        fixture.adminA,
        request.requestNumber,
        "APPROVE",
        "Réservation stock invalidée pendant l'appel provider.",
        refund.gateway,
        RUNTIME_NOW,
        cancellationClient,
      );
      const identity = await refund.entered;
      await prisma.stockReservation.update({
        where: {
          shopOrderId_productId: { shopOrderId: order.id, productId: fixture.productId },
        },
        data: { status: "RELEASED", confirmedAt: null, releasedAt: RUNTIME_NOW },
      });
      refund.release("SUCCEEDED");
      assert.equal(await cancellation, "REQUIRES_REVIEW");
      const [attempt, payment, currentOrder] = await Promise.all([
        prisma.refundAttempt.findUniqueOrThrow({ where: { id: identity.attemptId } }),
        prisma.payment.findUniqueOrThrow({ where: { id: order.paymentId } }),
        prisma.shopOrder.findUniqueOrThrow({ where: { id: order.id } }),
      ]);
      assert.deepEqual(
        [attempt.status, attempt.failureCode, payment.status, payment.refundedAmountCents],
        [
          "REQUIRES_REVIEW",
          "SHOP_CANCELLATION_INVENTORY_RESERVATION_INVALID_AFTER_REFUND",
          "REFUND_PENDING",
          0,
        ],
      );
      assert.ok(attempt.providerRefundId && attempt.confirmedAt);
      assert.deepEqual(
        [currentOrder.status, currentOrder.paymentStatus, currentOrder.fulfillmentStatus],
        ["OPEN", "PAID", "PENDING"],
      );
      assert.equal(await prisma.creditNote.count({ where: { invoiceId: order.invoiceId } }), 0);
      assert.equal(await prisma.productStockAdjustment.count({
        where: { shopCustomerRequestId: request.id },
      }), 0);
      assert.equal((await prisma.product.findUniqueOrThrow({
        where: { id: fixture.productId },
      })).stock, stockBefore);
    } finally {
      refund.release("SUCCEEDED");
      await cancellationClient.$disconnect();
    }
  }
  return "PASS" as const;
}

async function nonTrackedSavDoesNotRestockOrBlockCancellationScenario(
  fixture: CancellationRuntimeFixture,
) {
  const order = await createCancellationFixtureOrder(fixture, 990070, { provider: "PAYPAL" });
  await prisma.stockReservation.delete({
    where: {
      shopOrderId_productId: { shopOrderId: order.id, productId: fixture.productId },
    },
  });
  await prisma.shopOrderItem.update({
    where: {
      shopOrderId_productId: { shopOrderId: order.id, productId: fixture.productId },
    },
    data: { inventoryTracked: false },
  });
  const shopReturn = await createAuthorizedShopReturnForOrder(
    fixture,
    order,
    { physicalReturnRequired: true },
  );
  await makeShopReturnRestockable(fixture, shopReturn.requestNumber);
  const stockBefore = (await prisma.product.findUniqueOrThrow({
    where: { id: fixture.productId },
  })).stock!;
  assert.deepEqual(await restockShopReturn(
    fixture.adminA,
    shopReturn.requestNumber,
    RUNTIME_NOW,
    { client: runtimeServiceClient, assertEnabled: noRuntimeGuard },
  ), { restockedQuantity: 0 });
  const cancellationRequest = await createCancellationRequest(fixture, order);
  const refund = immediateRefundGateway("SUCCEEDED");
  assert.equal(await decideShopCustomerRequest(
    fixture.adminA,
    cancellationRequest.requestNumber,
    "APPROVE",
    "Ligne non stockée sans disposition financière SAV.",
    refund.gateway,
    RUNTIME_NOW,
    runtimeServiceClient,
  ), "SUCCEEDED");
  assert.deepEqual(refund.counts(), { requestCalls: 1, retrieveCalls: 0 });
  assert.equal(await prisma.productStockAdjustment.count({
    where: {
      OR: [
        { shopReturnRequestId: shopReturn.id },
        { shopCustomerRequestId: cancellationRequest.id },
      ],
    },
  }), 0);
  assert.equal((await prisma.product.findUniqueOrThrow({
    where: { id: fixture.productId },
  })).stock, stockBefore);
  const currentOrder = await prisma.shopOrder.findUniqueOrThrow({
    where: { id: order.id },
  });
  assert.deepEqual(
    [currentOrder.status, currentOrder.paymentStatus, currentOrder.fulfillmentStatus],
    ["CANCELLED", "CANCELLED", "CANCELLED"],
  );
  return "PASS" as const;
}

async function nonRecoverableReviewReasonSurvivesReplayScenario(
  fixture: CancellationRuntimeFixture,
) {
  for (const [sequence, kind] of [[990061, "MISMATCH"], [990062, "PRECONDITION"]] as const) {
    const order = await createCancellationFixtureOrder(fixture, sequence, { provider: "PAYPAL" });
    const request = await createCancellationRequest(fixture, order);
    const client = isolatedCancellationRuntimeClient(`cancellation-root-review-${kind.toLowerCase()}`);
    const refund = delayedRefundGateway();
    try {
      const decision = decideShopCustomerRequest(
        fixture.adminA,
        request.requestNumber,
        "APPROVE",
        "Préservation du diagnostic racine après rejeu exact.",
        refund.gateway,
        RUNTIME_NOW,
        client,
      );
      const identity = refundWebhookIdentity(await refund.entered);
      if (kind === "PRECONDITION") {
        await prisma.shopOrder.update({
          where: { id: order.id },
          data: {
            paymentReviewAt: RUNTIME_NOW,
            paymentReviewCode: "RUNTIME_FINALIZATION_PRECONDITION",
          },
        });
      }
      const firstEvidence = kind === "MISMATCH"
        ? { ...shopRefundEvidence(identity), amountCents: identity.amountCents - 1 }
        : shopRefundEvidence(identity);
      assert.equal(await applyShopCustomerCancellationEvidence(
        runtimeServiceClient,
        identity.attemptId,
        firstEvidence,
      ), "REQUIRES_REVIEW");
      const expectedCode = kind === "MISMATCH"
        ? "REFUND_EVIDENCE_MISMATCH"
        : "SHOP_CANCELLATION_FULFILLMENT_CONFLICT_AFTER_REFUND";
      assert.equal((await prisma.refundAttempt.findUniqueOrThrow({
        where: { id: identity.attemptId },
      })).failureCode, expectedCode);
      if (kind === "PRECONDITION") {
        await prisma.shopOrder.update({
          where: { id: order.id },
          data: { paymentReviewAt: null, paymentReviewCode: null },
        });
      }
      assert.equal(await applyShopCustomerCancellationEvidence(
        runtimeServiceClient,
        identity.attemptId,
        shopRefundEvidence(identity),
      ), "REQUIRES_REVIEW");
      assert.equal((await prisma.refundAttempt.findUniqueOrThrow({
        where: { id: identity.attemptId },
      })).failureCode, expectedCode);
      refund.release("PENDING");
      assert.equal(await decision, "REQUIRES_REVIEW");
      assert.equal(await prisma.creditNote.count({ where: { invoiceId: order.invoiceId } }), 0);
      assert.equal(await prisma.productStockAdjustment.count({
        where: { shopCustomerRequestId: request.id },
      }), 0);
    } finally {
      refund.release("PENDING");
      await client.$disconnect();
    }
  }

  for (const [sequence, kind] of [[990072, "MISMATCH"], [990073, "PRECONDITION"]] as const) {
    const refund = await createShopReturnRefundFixture(fixture, sequence, "STRIPE");
    const identity = shopReturnWebhookIdentity(refund);
    if (kind === "PRECONDITION") {
      await prisma.shopOrder.update({
        where: { id: refund.order.id },
        data: {
          paymentReviewAt: RUNTIME_NOW,
          paymentReviewCode: "RUNTIME_FINALIZATION_PRECONDITION",
        },
      });
    }
    const firstEvidence = kind === "MISMATCH"
      ? { ...shopRefundEvidence(identity), amountCents: identity.amountCents - 1 }
      : shopRefundEvidence(identity);
    assert.deepEqual(await prisma.$transaction((tx) =>
      applyShopReturnRefundEvidenceInTransaction(tx, refund.attemptId, firstEvidence)), {
      status: "REQUIRES_REVIEW",
      confirmed: false,
    });
    const expectedCode = kind === "MISMATCH"
      ? "REFUND_EVIDENCE_MISMATCH"
      : "SHOP_RETURN_REFUND_FINALIZATION_PRECONDITION_FAILED";
    assert.equal((await prisma.refundAttempt.findUniqueOrThrow({
      where: { id: refund.attemptId },
    })).failureCode, expectedCode);
    if (kind === "PRECONDITION") {
      await prisma.shopOrder.update({
        where: { id: refund.order.id },
        data: { paymentReviewAt: null, paymentReviewCode: null },
      });
    }
    assert.deepEqual(await prisma.$transaction((tx) =>
      applyShopReturnRefundEvidenceInTransaction(
        tx,
        refund.attemptId,
        shopRefundEvidence(identity),
      )), {
      status: "REQUIRES_REVIEW",
      confirmed: false,
    });
    assert.equal((await prisma.refundAttempt.findUniqueOrThrow({
      where: { id: refund.attemptId },
    })).failureCode, expectedCode);
    assert.equal(await prisma.creditNote.count({ where: { shopReturnRequestId: refund.requestId } }), 0);
  }
  return "PASS" as const;
}

export async function runCoreCancellationConcurrencyScenarios(fixture: CancellationRuntimeFixture) {
  return {
    shippingWins: await shippingWinsScenario(fixture),
    cancellationWins: await cancellationWinsScenario(fixture),
    ambiguousResult: await ambiguousResultScenario(fixture),
    doubleAcceptance: await doubleAcceptanceScenario(fixture),
    certainProviderRefusal: await certainProviderRefusalScenario(fixture),
    preparingCleanup: await preparingCleanupScenario(fixture),
    unresolvedShippingIntent: await unresolvedShippingIntentScenario(fixture),
    sharedRefundCapacity: await sharedRefundCapacityScenario(fixture),
    accountingFailureReconciliation: await accountingFailureThenReconciliationScenario(fixture),
    sellerErrorReasonPreserved: await sellerErrorReasonRemainsAvailableScenario(fixture),
    shopReturnRestockWinsSameOrder: await shopReturnRestockWinsSameOrderScenario(fixture),
    shopReturnInspectionWinsSameOrder: await shopReturnInspectionWinsSameOrderScenario(fixture),
    cancellationBarrierStopsSavMutations: await cancellationBarrierStopsSavMutationsScenario(fixture),
    failedSavRefundDoesNotBlockCancellation: await failedSavRefundDoesNotBlockCancellationScenario(fixture),
    cancellationInventoryReservationGuard: await cancellationInventoryReservationGuardScenario(fixture),
    nonTrackedSavDoesNotRestockOrBlockCancellation: await nonTrackedSavDoesNotRestockOrBlockCancellationScenario(fixture),
  } as const;
}

export async function runWebhookCorrelationScenarios(fixture: CancellationRuntimeFixture) {
  return {
    stripeWebhookBeforeApiResponse: await stripeWebhookBeforeApiResponseScenario(fixture),
    paypalPendingCompletedAndDuplicate: await paypalPendingThenCompletedScenario(fixture),
    apiThenWebhook: await apiThenWebhookScenario(fixture),
    webhookBeforeAmbiguousApiResponse: await webhookBeforeAmbiguousApiResponseScenario(fixture),
    ambiguousThenWebhookCompletion: await ambiguousThenWebhookCompletionScenario(fixture),
    accountingFailureThenReconciliation: await webhookAccountingFailureThenReconciliationScenario(fixture),
    uncorrelatedAndIncoherentEvidence: await uncorrelatedAndIncoherentWebhookScenario(fixture),
    missingCorrelationReferenceDeferred: await missingCorrelationReferenceDeferredScenario(fixture),
    shopReturnStripeWebhook: await shopReturnStripeWebhookScenario(fixture),
    shopReturnPaypalOrdering: await shopReturnPaypalOrderingScenario(fixture),
    shopReturnAccountingFailure: await shopReturnAccountingFailureScenario(fixture),
    deferredRaceCannotRegressTerminalState: await deferredRaceCannotRegressTerminalStateScenario(fixture),
    deferredBindingPromotion: await deferredBindingPromotionScenario(fixture),
    unreferencedWebhookProgressionRemainsDeferred: await unreferencedWebhookProgressionRemainsDeferredScenario(fixture),
    contradictoryDeferredReceiptRemainsReview: await contradictoryDeferredReceiptRemainsReviewScenario(fixture),
    deferredPendingThenCertainRefusal: await deferredPendingThenCertainRefusalScenario(fixture),
    deferredIdentityAndProvenance: await deferredIdentityAndProvenanceScenario(fixture),
    deferredExternalIdCannotOverwriteApiId: await deferredExternalIdCannotOverwriteApiIdScenario(fixture),
    applicationCorrelationMustBeProven: await applicationCorrelationMustBeProvenScenario(fixture),
    pendingReceiptFailureCanResolveFailed: await pendingReceiptFailureCanResolveFailedScenario(fixture),
    financialReviewAndShopReturnReservationRace: await financialReviewAndShopReturnReservationRaceScenario(fixture),
    exactLateSuccessAfterCertainRefusal: await exactLateSuccessAfterCertainRefusalScenario(fixture),
    terminalContradictionRestoresBarrier: await terminalContradictionRestoresBarrierScenario(fixture),
    concurrentShopReturnCapacity: await concurrentShopReturnCapacityScenario(fixture),
    deferredCandidateRevalidatedUnderLock: await deferredCandidateRevalidatedUnderLockScenario(fixture),
    receiptFailurePreservesCorrelatedEvidence: await receiptFailurePreservesCorrelatedEvidenceScenario(fixture),
    failedReceiptFailurePreservesBarrier: await failedReceiptFailurePreservesBarrierScenario(fixture),
    cancellationAndShopReturnRestockSerialize: await cancellationAndShopReturnRestockSerializeScenario(fixture),
    nonRecoverableReviewReasonSurvivesReplay: await nonRecoverableReviewReasonSurvivesReplayScenario(fixture),
  } as const;
}

async function run() {
  const runtime = await assertDisposableRuntime();
  const fixture = await createCancellationRuntimeFixture();
  const core = await runCoreCancellationConcurrencyScenarios(fixture);
  const webhooks = await runWebhookCorrelationScenarios(fixture);
  console.info(JSON.stringify({
    event: "shop.cancellation-concurrency.runtime.completed",
    outcome: "passed",
    connectionModel: "independent-prisma-clients-and-postgresql-transactions",
    providerNetworkCalls: 0,
    externalEmails: 0,
    runtime,
    core,
    webhooks,
  }));
}

run().catch((error: unknown) => {
  console.error(JSON.stringify({
    event: "shop.cancellation-concurrency.runtime.failed",
    outcome: "failed",
  }));
  if (error instanceof Error) console.error(error.stack ?? error.message);
  process.exitCode = 1;
}).finally(async () => Promise.all([prisma.$disconnect(), runtimeServiceClient.$disconnect()]));
