import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  billingSnapshotHash,
  creditNoteNumber,
  CURRENT_VAT_LEGAL_NOTICE,
  CURRENT_VAT_REGIME,
  invoiceNumber,
  parisDateSegment,
  parisDayRange,
  parseBillingCustomerSnapshot,
  validateBillingCustomerIdentity,
} from "@/lib/billing/domain";
import { generateCreditNotePdf, generateInvoicePdf } from "@/lib/billing/pdf";

const root = process.cwd();
const read = (path: string) => readFile(`${root}/${path}`, "utf8");

test("billing numbers use the Paris issue date and a continuous untruncated sequence", () => {
  assert.equal(invoiceNumber(new Date("2026-08-28T21:59:59.999Z"), 1n), "LNX-20260828-0001");
  assert.equal(invoiceNumber(new Date("2026-08-28T22:00:00.001Z"), 2n), "LNX-20260829-0002");
  assert.equal(creditNoteNumber(new Date("2026-12-31T23:30:00Z"), 10_000n), "AV-LNX-20270101-10000");
  assert.equal(parisDateSegment(new Date("2026-01-01T00:30:00Z")), "20260101");
});

test("Admin date search bounds cover the exact Paris civil day across DST", () => {
  const summer = parisDayRange(2026, 8, 28);
  assert.equal(summer.start.toISOString(), "2026-08-27T22:00:00.000Z");
  assert.equal(summer.end.toISOString(), "2026-08-28T22:00:00.000Z");
  const winter = parisDayRange(2026, 12, 28);
  assert.equal(winter.start.toISOString(), "2026-12-27T23:00:00.000Z");
  assert.equal(winter.end.toISOString(), "2026-12-28T23:00:00.000Z");
  assert.throws(() => parisDayRange(2026, 2, 30));
});

test("B2C billing is minimal and rejects every professional or unknown field", () => {
  const identity = validateBillingCustomerIdentity({ type: "INDIVIDUAL", name: "Jean Exemple", email: "JEAN@EXAMPLE.INVALID", billingAddress: null });
  assert.deepEqual(identity, {
    type: "INDIVIDUAL", name: "Jean Exemple", email: "jean@example.invalid", companyName: null,
    billingAddress: null, businessIdentifier: null, vatId: null,
  });
  assert.throws(() => validateBillingCustomerIdentity({ type: "INDIVIDUAL", name: "Jean", email: "jean@example.invalid", companyName: "Entreprise Exemple SAS" }));
  assert.throws(() => parseBillingCustomerSnapshot({ type: "INDIVIDUAL", name: "Jean", email: "jean@example.invalid", role: "ADMIN" }));
});

test("B2B billing requires a company and validates only bounded French snapshot fields", () => {
  const identity = parseBillingCustomerSnapshot({
    type: "PROFESSIONAL", name: "Marie Exemple", email: "facturation@entreprise.example.invalid",
    companyName: "Entreprise Exemple SAS", businessIdentifier: "123 456 789 00012", vatId: "FR00123456789",
    billingAddress: { line1: "12 rue Exemple", line2: null, postalCode: "75000", city: "Paris", countryCode: "FR" },
  });
  assert.equal(identity.type, "PROFESSIONAL");
  assert.equal(identity.businessIdentifier, "12345678900012");
  assert.throws(() => parseBillingCustomerSnapshot({ type: "PROFESSIONAL", name: "Marie", email: "marie@example.invalid" }));
  assert.throws(() => parseBillingCustomerSnapshot({
    type: "PROFESSIONAL", name: "Marie", email: "marie@example.invalid", companyName: "Entreprise Exemple SAS",
    billingAddress: { line1: "12 rue Exemple", postalCode: "75000", city: "Paris", countryCode: "FR", redirect: "https://example.invalid" },
  }));
});

test("the current fiscal snapshot is centralized, deterministic and never represents charged VAT", () => {
  assert.equal(CURRENT_VAT_REGIME, "FRANCHISE_EN_BASE_TVA");
  assert.equal(CURRENT_VAT_LEGAL_NOTICE, "TVA non applicable, article 293 B du CGI");
  assert.equal(billingSnapshotHash({ b: 2, a: 1 }), billingSnapshotHash({ a: 1, b: 2 }));
  assert.notEqual(billingSnapshotHash({ totalCents: 2000 }), billingSnapshotHash({ totalCents: 3000 }));
});

test("the additive migration keeps parent, amount, VAT and issued-document constraints fail-closed", async () => {
  const sql = await read("prisma/migrations/20260828180000_invoicing_foundation/migration.sql");
  assert.doesNotMatch(sql, /\b(?:DROP|TRUNCATE)\b/i);
  assert.match(sql, /CREATE SEQUENCE "invoice_sequence"/);
  assert.match(sql, /CREATE SEQUENCE "credit_note_sequence"/);
  assert.match(sql, /invoices_parent_xor/);
  assert.match(sql, /invoices_total_consistent/);
  assert.match(sql, /invoices_franchise_vat_zero/);
  assert.match(sql, /invoices_immutable/);
  assert.match(sql, /credit_notes_immutable/);
  assert.match(sql, /ON DELETE RESTRICT/g);
});

test("payment success paths issue the invoice before durable customer notification", async () => {
  for (const path of ["lib/payments/webhook.ts", "lib/payments/paypal-service.ts", "lib/shop/payment-repository.ts"]) {
    const source = await read(path);
    const invoice = source.indexOf("await issueInvoiceForPayment(transaction, payment.id)");
    const notification = source.indexOf(path.includes("shop/") ? "await enqueueShopPaymentConfirmedNotifications" : "await enqueuePaymentConfirmedNotifications", invoice);
    assert.ok(invoice > 0, `${path} must issue the invoice in the payment transaction.`);
    assert.ok(notification > invoice, `${path} must snapshot the invoice link before notification enqueue.`);
  }
  const refund = await read("lib/payments/refund.ts");
  assert.match(refund, /nextStatus === "SUCCEEDED"[\s\S]*issueCreditNoteForRefundIfInvoiceExists/);
});

test("private invoice and credit-note routes enforce session ownership and safe response headers", async () => {
  for (const path of ["app/api/billing/invoices/[invoiceNumber]/pdf/route.ts", "app/api/billing/credit-notes/[creditNoteNumber]/pdf/route.ts"]) {
    const source = await read(path);
    assert.match(source, /getAuthSession/);
    assert.match(source, /isActiveStatus/);
    assert.match(source, /emailVerified/);
    assert.match(source, /get(?:Invoice|CreditNote)ForMember/);
    assert.match(source, /private, no-store/);
    assert.match(source, /noindex, nofollow/);
    assert.doesNotMatch(source, /paymentIntent|accessToken|providerEvent/);
  }
});

test("Admin billing supports invoice, credit-note, order, customer and date lookup without mutation controls", async () => {
  const service = await read("lib/billing/service.ts");
  const list = await read("app/admin/facturation/page.tsx");
  const detail = await read("app/admin/facturation/[invoiceNumber]/page.tsx");
  const credit = await read("app/admin/facturation/avoirs/[creditNoteNumber]/page.tsx");
  assert.match(service, /creditNotes: \{ some: \{ creditNoteNumber/);
  assert.match(service, /parisDayRange/);
  assert.match(list, /Facture, commande, client/);
  assert.match(detail, /Consulter l’avoir/);
  assert.match(credit, /Aucun bouton de modification ou suppression/);
  assert.doesNotMatch(`${list}${detail}${credit}`, />\s*Supprimer\s*</i);
});

test("invoice and credit-note PDFs are private QA documents generated from snapshots", async () => {
  const invoice = {
    invoiceNumber: "LNX-20990101-0001", issuedAt: new Date("2099-01-01T12:00:00Z"), orderNumberSnapshot: "LNX-2099-000001",
    sellerSnapshot: { legalName: "Ludovic Mickaël Mathon", legalForm: "Entrepreneur individuel", tradeName: "LNX Beats", serviceName: "LNX STUDIO", address: { line1: "35 Impasse des Orties", postalCode: "07370", city: "Ozon", countryCode: "FR" }, siren: "106870850", siret: "10687085000018", ape: "9003B", email: "lnx.beats.pro@gmail.com", phone: "06 71 66 70 32" },
    customerSnapshot: { type: "PROFESSIONAL", name: "Marie Exemple", email: "qa@example.invalid", companyName: "Entreprise Exemple SAS", billingAddress: { line1: "12 rue Exemple", line2: null, postalCode: "75000", city: "Paris", countryCode: "FR" }, businessIdentifier: "12345678900012", vatId: null },
    lineItemsSnapshot: [{ description: "Création musicale fictive QA", quantity: 1, unitPriceCents: 3000, lineTotalCents: 3000 }],
    subtotalCents: 3000, shippingCents: 0, totalCents: 3000, currency: "EUR", vatLegalNotice: CURRENT_VAT_LEGAL_NOTICE,
    paymentMethodLabel: "Carte bancaire / Apple Pay via Stripe", paidAt: new Date("2099-01-01T11:55:00Z"), termsVersion: "music-cgv-qa", snapshotHashSha256: "a".repeat(64),
  };
  const pdf = await generateInvoicePdf(invoice);
  assert.equal(pdf.filename, "LNX-20990101-0001.pdf");
  assert.equal(pdf.bytes.subarray(0, 4).toString(), "%PDF");
  assert.ok(pdf.bytes.length > 1_000);
  const credit = await generateCreditNotePdf({ creditNoteNumber: "AV-LNX-20990101-0001", issuedAt: invoice.issuedAt, amountCents: 1000, cumulativeCreditedCents: 1000, remainingBalanceCents: 2000, currency: "EUR", reasonCode: "NON_CONFORMITY", reasonText: null, snapshotHashSha256: "b".repeat(64), invoice });
  assert.equal(credit.filename, "AV-LNX-20990101-0001.pdf");
  assert.equal(credit.bytes.subarray(0, 4).toString(), "%PDF");
  assert.ok(credit.bytes.length > 1_000);
  assert.doesNotMatch(Buffer.concat([pdf.bytes, credit.bytes]).toString("latin1"), /sk_live_|sk_test_|whsec_|DATABASE_URL|AUTH_SECRET/);
});

test("billing browser fixtures are bound to one disposable local database and env-backed credentials", async () => {
  const fixture = await read("scripts/billing-browser-fixtures.ts");
  assert.match(fixture, /lnx-studio-v110-phase4b-visual-qa/);
  assert.match(fixture, /LNX_PRISMA_DEV_SERVER_FILE/);
  assert.match(fixture, /LNX_AUTH_QA_MEMBER_PASSWORD/);
  assert.match(fixture, /LNX_AUTH_QA_ADMIN_PASSWORD/);
  assert.match(fixture, /PAYMENTS_ENABLED, "false"/);
  assert.match(fixture, /SHOP_ENABLED, "false"/);
  assert.match(fixture, /EMAIL_PROVIDER, "capture"/);
  assert.doesNotMatch(fixture, /password:\s*["'`][^"'`]+["'`]/i);
  assert.doesNotMatch(fixture, /sk_(?:live|test)_|api-m\.paypal\.com|resend\.com|railway\.app/i);
});
