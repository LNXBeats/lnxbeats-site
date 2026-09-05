import assert from "node:assert/strict";
import test from "node:test";

import { BillingServiceError, issueInvoiceForPayment } from "@/lib/billing/service";

type InvoiceTransaction = Parameters<typeof issueInvoiceForPayment>[0];
type Provider = "STRIPE" | "PAYPAL";

type InvoiceState = {
  sequenceAllocations: number;
  invoiceCreates: number;
  billingAuditCreates: number;
};

function shopTransaction(input: Readonly<{
  provider: Provider;
  shippingFirstName: string | null;
  shippingLastName: string | null;
  profileFirstName?: string | null;
  profileLastName?: string | null;
  profileDisplayName?: string | null;
}>) {
  const state: InvoiceState = { sequenceAllocations: 0, invoiceCreates: 0, billingAuditCreates: 0 };
  const paidAt = new Date("2099-01-02T10:00:00.000Z");
  const payment = {
    id: `payment-${input.provider.toLowerCase()}`,
    orderId: null,
    shopOrderId: `shop-order-${input.provider.toLowerCase()}`,
    provider: input.provider,
    paymentMethod: input.provider === "PAYPAL" ? "PAYPAL" : "CARD",
    status: "SUCCEEDED",
    paidAt,
    amountCents: 3_000,
    currency: "EUR",
  };
  const shopOrder = {
    id: payment.shopOrderId,
    userId: "member-id",
    orderNumber: `LNX-SHOP-2099-${input.provider === "STRIPE" ? "000001" : "000002"}`,
    status: "OPEN",
    paymentStatus: "PAID",
    paymentReviewAt: null,
    subtotalCents: 2_500,
    shippingCents: 500,
    totalCents: 3_000,
    currency: "EUR",
    termsVersion: "shop-cgv-qa",
    termsHashSha256: "a".repeat(64),
    shippingFirstName: input.shippingFirstName,
    shippingLastName: input.shippingLastName,
    shippingAddressLine1: "12 rue Exemple",
    shippingAddressLine2: null,
    shippingPostalCode: "75000",
    shippingCity: "Paris",
    shippingCountryCode: "FR",
  };
  const transaction = {
    $executeRaw: async () => 1,
    $queryRaw: async () => {
      state.sequenceAllocations += 1;
      return [{ value: BigInt(state.sequenceAllocations) }];
    },
    invoice: {
      findUnique: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.invoiceCreates += 1;
        return { id: `invoice-${state.invoiceCreates}`, ...data };
      },
    },
    payment: { findUnique: async () => payment },
    order: { findUnique: async () => null },
    shopOrder: { findUnique: async () => shopOrder },
    user: {
      findUnique: async () => ({
        email: "member@example.invalid",
        firstName: input.profileFirstName ?? null,
        lastName: input.profileLastName ?? null,
        displayName: input.profileDisplayName ?? "Membre LNX",
      }),
    },
    shopOrderItem: {
      findMany: async () => [{ productTitle: "CD fictif", unitPriceCents: 2_500, quantity: 1, lineTotalCents: 2_500 }],
    },
    billingAuditEvent: {
      create: async () => {
        state.billingAuditCreates += 1;
        return { id: `audit-${state.billingAuditCreates}` };
      },
    },
  };
  return { transaction: transaction as unknown as InvoiceTransaction, payment, state };
}

function musicTransaction() {
  const state: InvoiceState = { sequenceAllocations: 0, invoiceCreates: 0, billingAuditCreates: 0 };
  const paidAt = new Date("2099-01-02T11:00:00.000Z");
  const payment = {
    id: "music-payment",
    orderId: "music-order",
    shopOrderId: null,
    provider: "STRIPE",
    paymentMethod: "CARD",
    status: "SUCCEEDED",
    paidAt,
    amountCents: 3_000,
    currency: "EUR",
  };
  const transaction = {
    $executeRaw: async () => 1,
    $queryRaw: async () => {
      state.sequenceAllocations += 1;
      return [{ value: BigInt(state.sequenceAllocations) }];
    },
    invoice: {
      findUnique: async () => null,
      create: async ({ data }: { data: Record<string, unknown> }) => {
        state.invoiceCreates += 1;
        return { id: "music-invoice", ...data };
      },
    },
    payment: { findUnique: async () => payment },
    order: {
      findUnique: async () => ({
        id: payment.orderId,
        orderNumber: "LNX-2099-000001",
        status: "PAYMENT_CONFIRMED",
        customerName: "Cliente Commander",
        customerEmail: "commander@example.invalid",
        title: "Création musicale fictive",
        basePriceCents: 3_000,
        coverIncluded: false,
        coverPriceCents: 0,
        priorityProcessing: false,
        priorityPriceCents: 0,
        totalCents: 3_000,
        currency: "EUR",
        personalUseTermsVersion: "music-cgv-qa",
        personalUseTermsHashSha256: "b".repeat(64),
      }),
    },
    shopOrder: { findUnique: async () => null },
    user: { findUnique: async () => null },
    shopOrderItem: { findMany: async () => [] },
    billingAuditEvent: {
      create: async () => {
        state.billingAuditCreates += 1;
        return { id: "music-audit" };
      },
    },
  };
  return { transaction: transaction as unknown as InvoiceTransaction, payment, state };
}

test("Shop Stripe invoices use the immutable shipping name instead of a generic member profile", async () => {
  const fixture = shopTransaction({
    provider: "STRIPE",
    shippingFirstName: "Test",
    shippingLastName: "Client",
    profileDisplayName: "Membre LNX",
  });

  const result = await issueInvoiceForPayment(fixture.transaction, fixture.payment.id, { issuedAt: new Date("2099-01-02T12:00:00.000Z") });
  const customer = result.invoice.customerSnapshot as { name: string };

  assert.equal(result.created, true);
  assert.equal(customer.name, "Test Client");
  assert.equal(result.invoice.customerNameSearch, "Test Client");
  assert.equal(fixture.state.sequenceAllocations, 1);
});

test("Shop PayPal invoices remain bound to the order name after the member profile changes", async () => {
  const fixture = shopTransaction({
    provider: "PAYPAL",
    shippingFirstName: "Élise-Marie",
    shippingLastName: "D’Exemple",
    profileFirstName: "Autre",
    profileLastName: "Nom",
    profileDisplayName: "Autre Nom",
  });

  const result = await issueInvoiceForPayment(fixture.transaction, fixture.payment.id, { issuedAt: new Date("2099-01-02T12:01:00.000Z") });
  const customer = result.invoice.customerSnapshot as { name: string };

  assert.equal(customer.name, "Élise-Marie D’Exemple");
  assert.equal(result.invoice.paymentMethodLabel, "PayPal");
  assert.equal(fixture.state.sequenceAllocations, 1);
});

test("Shop invoice issuance rejects each incomplete order name before allocating a number", async (context) => {
  const incompleteNames = [
    { label: "missing first name", shippingFirstName: null, shippingLastName: "Client" },
    { label: "blank first name", shippingFirstName: "   ", shippingLastName: "Client" },
    { label: "missing last name", shippingFirstName: "Test", shippingLastName: null },
    { label: "blank last name", shippingFirstName: "Test", shippingLastName: " \t " },
  ];

  for (const input of incompleteNames) {
    await context.test(input.label, async () => {
      const fixture = shopTransaction({ provider: "STRIPE", ...input });
      await assert.rejects(
        issueInvoiceForPayment(fixture.transaction, fixture.payment.id),
        (error: unknown) => error instanceof BillingServiceError && error.code === "INVOICE_CUSTOMER_SNAPSHOT_INVALID",
      );
      assert.equal(fixture.state.sequenceAllocations, 0);
      assert.equal(fixture.state.invoiceCreates, 0);
      assert.equal(fixture.state.billingAuditCreates, 0);
    });
  }
});

test("Commander invoice identity remains sourced from the music order", async () => {
  const fixture = musicTransaction();
  const result = await issueInvoiceForPayment(fixture.transaction, fixture.payment.id, { issuedAt: new Date("2099-01-02T12:02:00.000Z") });
  const customer = result.invoice.customerSnapshot as { name: string; email: string };

  assert.equal(result.invoice.documentType, "MUSIC");
  assert.equal(customer.name, "Cliente Commander");
  assert.equal(customer.email, "commander@example.invalid");
  assert.equal(fixture.state.sequenceAllocations, 1);
});
