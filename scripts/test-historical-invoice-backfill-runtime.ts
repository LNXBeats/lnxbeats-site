import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { prisma } from "@/lib/prisma";
import { applyHistoricalInvoiceBackfill } from "./historical-invoice-backfill-apply";

const TARGET = "lnx-studio-v110-historical-invoice-backfill-test";
const FIXTURE = `historical-invoice-${randomUUID().slice(0, 8)}`;

type Proof = {
  name?: unknown;
  pid?: unknown;
  databasePort?: unknown;
  exports?: { database?: { connectionString?: unknown } };
};

async function assertDisposableRuntime() {
  assert.equal(process.env.NODE_ENV, "test");
  assert.equal(process.env.LNX_DATABASE_TARGET, TARGET);
  const proofPath = process.env.LNX_PRISMA_DEV_SERVER_FILE;
  const databaseUrl = process.env.DATABASE_URL;
  if (!proofPath?.endsWith(`/${TARGET}/server.json`) || !databaseUrl) throw new Error("Historical invoice runtime proof is absent.");
  const proof = JSON.parse(await readFile(proofPath, "utf8")) as Proof;
  const parsed = new URL(databaseUrl);
  assert.equal(proof.name, TARGET);
  assert.equal(proof.exports?.database?.connectionString, databaseUrl);
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(parsed.hostname));
  assert.notEqual(parsed.port, "5432");
  assert.equal(decodeURIComponent(parsed.pathname), "/template1");
  assert.equal(Number(proof.databasePort), Number(parsed.port));
  assert.ok(Number.isInteger(proof.pid) && Number(proof.pid) > 0);
  process.kill(Number(proof.pid), 0);
  for (const name of ["STRIPE_SECRET_KEY", "PAYPAL_CLIENT_SECRET", "RESEND_API_KEY", "R2_ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID"]) {
    assert.ok(!process.env[name], `${name} is forbidden in historical invoice runtime.`);
  }
}

async function sequenceState() {
  const rows = await prisma.$queryRaw<Array<{ lastValue: bigint; isCalled: boolean }>>`
    SELECT last_value::bigint AS "lastValue", is_called AS "isCalled" FROM invoice_sequence
  `;
  return rows[0]!;
}

async function createHistoricalOrder(input: Readonly<{
  orderNumber: string;
  provider: "STRIPE" | "PAYPAL";
  totalCents: number;
  paidAt: Date;
  customerName: string | null;
  title: string | null;
}>) {
  const user = await prisma.user.create({
    data: {
      email: `${FIXTURE}-${input.orderNumber.slice(-3)}@example.invalid`,
      emailVerified: true,
      emailVerifiedAt: new Date(),
      displayName: input.customerName ?? "Client historique",
      role: "MEMBER",
      status: "ACTIVE",
    },
  });
  const order = await prisma.order.create({
    data: {
      orderNumber: input.orderNumber,
      userId: user.id,
      customerEmail: user.email,
      customerName: input.customerName,
      status: "PAYMENT_CONFIRMED",
      title: input.title,
      brief: "Fixture locale jetable de backfill historique.",
      basePriceCents: input.totalCents,
      coverIncluded: false,
      coverPriceCents: 0,
      priorityProcessing: false,
      priorityPriceCents: 0,
      totalCents: input.totalCents,
      currency: "EUR",
      pricingVersion: "historical-invoice-runtime-v1",
      personalUseTermsVersion: "music-cgv-runtime-v1",
      personalUseTermsHashSha256: "a".repeat(64),
      personalUseTermsAcceptedAt: input.paidAt,
    },
  });
  const payment = await prisma.payment.create({
    data: {
      orderId: order.id,
      provider: input.provider,
      mode: "LIVE",
      status: "SUCCEEDED",
      amountCents: input.totalCents,
      currency: "EUR",
      pricingVersion: "historical-invoice-runtime-v1",
      idempotencyKey: `${FIXTURE}:${input.orderNumber}:payment`,
      providerCheckoutId: `${FIXTURE}:${input.orderNumber}:checkout`,
      providerPaymentId: `${FIXTURE}:${input.orderNumber}:proof`,
      paymentMethod: input.provider === "PAYPAL" ? "PAYPAL" : "CARD",
      paidAt: input.paidAt,
    },
  });
  await prisma.providerEvent.create({
    data: {
      provider: input.provider,
      providerEventId: `${FIXTURE}:${input.orderNumber}:event`,
      type: input.provider === "PAYPAL" ? "PAYMENT.CAPTURE.COMPLETED" : "checkout.session.completed",
      livemode: true,
      objectId: `${FIXTURE}:${input.orderNumber}:object`,
      outcome: "PROCESSED",
      paymentId: payment.id,
      processedAt: input.paidAt,
    },
  });
  return { order, payment };
}

async function main() {
  await assertDisposableRuntime();
  const migrations = await prisma.$queryRaw<Array<{ count: bigint }>>`
    SELECT count(*)::bigint AS count FROM "_prisma_migrations"
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
  `;
  assert.equal(Number(migrations[0]?.count), 29);

  await createHistoricalOrder({
    orderNumber: "LNX-2026-000003", provider: "STRIPE", totalCents: 5000,
    paidAt: new Date("2026-08-25T21:03:57Z"), customerName: "Jean Exemple", title: "Titre historique A",
  });
  await createHistoricalOrder({
    orderNumber: "LNX-2026-000007", provider: "PAYPAL", totalCents: 2000,
    paidAt: new Date("2026-08-26T16:00:04.984Z"), customerName: "Jean Exemple", title: "Titre historique B",
  });
  const invalid = await createHistoricalOrder({
    orderNumber: "LNX-2026-000011", provider: "STRIPE", totalCents: 2000,
    paidAt: new Date("2026-08-26T18:24:44Z"), customerName: null, title: null,
  });

  const beforeFailure = await sequenceState();
  assert.equal(beforeFailure.isCalled, false);
  await assert.rejects(() => applyHistoricalInvoiceBackfill(prisma, { issuedAt: new Date("2099-01-02T10:00:00Z") }));
  const afterFailure = await sequenceState();
  assert.equal(afterFailure.isCalled, false, "global validation failure must not consume invoice_sequence");
  assert.equal(await prisma.invoice.count(), 0);

  await prisma.order.update({ where: { id: invalid.order.id }, data: { customerName: "Jean Exemple" } });
  const result = await applyHistoricalInvoiceBackfill(prisma, { issuedAt: new Date("2099-01-02T10:00:00Z") });
  assert.equal(result.invoicesCreated.length, 3);
  assert.deepEqual(result.deterministicOrder, ["LNX-2026-000003", "LNX-2026-000007", "LNX-2026-000011"]);
  assert.deepEqual(result.invoicesCreated.map((entry) => entry.invoiceNumber), [
    "LNX-20990102-0001", "LNX-20990102-0002", "LNX-20990102-0003",
  ]);
  assert.equal(result.invoicesCreated[2]?.description, "Création musicale personnalisée");
  assert.equal(await prisma.billingAuditEvent.count({ where: { action: "INVOICE_ISSUED" } }), 3);
  assert.equal(await prisma.creditNote.count(), 0);
  assert.equal(await prisma.refundAttempt.count(), 0);
  assert.equal(await prisma.orderNotification.count(), 0);

  const beforeReplay = await sequenceState();
  await assert.rejects(() => applyHistoricalInvoiceBackfill(prisma, { issuedAt: new Date("2099-01-02T10:01:00Z") }));
  const afterReplay = await sequenceState();
  assert.deepEqual(afterReplay, beforeReplay, "safe replay must not consume another invoice number");
  assert.equal(await prisma.invoice.count(), 3);

  console.info(JSON.stringify({
    event: "historical.invoice.backfill.runtime.completed",
    migrations: Number(migrations[0]?.count),
    validationFailureConsumedSequence: false,
    invoicesCreated: 3,
    auditEvents: 3,
    creditNotes: 0,
    refundAttempts: 0,
    notifications: 0,
    providerCalls: 0,
    emails: 0,
    replayCreatedInvoices: 0,
    deterministicOrder: result.deterministicOrder,
  }));
}

main().finally(() => prisma.$disconnect());
