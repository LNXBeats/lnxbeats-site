import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { inflateSync } from "node:zlib";

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
import { billingPdfLayout, generateCreditNotePdf, generateInvoicePdf, type InvoicePdfRecord } from "@/lib/billing/pdf";
import {
  billingDocumentPresentation,
  billingDocumentRenderMode,
  creditNoteReasonLabel,
} from "@/lib/billing/presentation";

const root = process.cwd();
const read = (path: string) => readFile(`${root}/${path}`, "utf8");

function decodedPdfPageText(bytes: Buffer): string[] {
  const source = bytes.toString("latin1");
  const objects = new Map<number, string>();
  for (const match of source.matchAll(/(\d+)\s+0\s+obj\b([\s\S]*?)endobj/g)) objects.set(Number(match[1]), match[2]!);
  const decoder = new TextDecoder("windows-1252");
  return [...objects.entries()]
    .filter(([, body]) => /\/Type\s*\/Page(?!s)\b/.test(body))
    .sort(([left], [right]) => left - right)
    .map(([, page]) => {
      const contents = page.match(/\/Contents\s+(\d+)\s+0\s+R/);
      assert.ok(contents, "A billing PDF page must reference its content stream.");
      const object = objects.get(Number(contents[1]));
      assert.ok(object, "The referenced billing PDF content stream must exist.");
      const stream = object.match(/stream\r?\n([\s\S]*?)\r?\nendstream/);
      assert.ok(stream, "The billing PDF page content stream must be readable.");
      const compressed = Buffer.from(stream[1]!, "latin1");
      const content = /\/FlateDecode/.test(object) ? inflateSync(compressed).toString("latin1") : compressed.toString("latin1");
      const lines: string[] = [];
      for (const textArray of content.matchAll(/\[([\s\S]*?)\]\s*TJ/g)) {
        const parts = [...textArray[1]!.matchAll(/<([0-9A-Fa-f]+)>/g)].map((part) => decoder.decode(Buffer.from(part[1]!, "hex")));
        if (parts.length) lines.push(parts.join(""));
      }
      for (const textValue of content.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) lines.push(decoder.decode(Buffer.from(textValue[1]!, "hex")));
      return lines.join("\n");
    });
}

const sellerSnapshot = {
  legalName: "Ludovic Mickaël Mathon", legalForm: "Entrepreneur individuel", tradeName: "LNX Beats", serviceName: "LNX STUDIO",
  address: { line1: "35 Impasse des Orties", postalCode: "07370", city: "Ozon", countryCode: "FR" },
  siren: "106870850", siret: "10687085000018", ape: "9003B", email: "lnx.beats.pro@gmail.com", phone: "06 71 66 70 32",
};

function invoiceFixture(overrides: Partial<InvoicePdfRecord> = {}): InvoicePdfRecord {
  return {
    invoiceNumber: "LNX-20990101-0001", issuedAt: new Date("2099-01-01T12:00:00Z"), orderNumberSnapshot: "LNX-2099-000001",
    sellerSnapshot,
    customerSnapshot: { type: "INDIVIDUAL", name: "Camille Exemple", email: "camille@example.invalid", companyName: null, billingAddress: null, businessIdentifier: null, vatId: null },
    lineItemsSnapshot: [{ description: "Création musicale fictive QA", quantity: 1, unitPriceCents: 3000, lineTotalCents: 3000 }],
    subtotalCents: 3000, shippingCents: 0, totalCents: 3000, currency: "EUR", vatLegalNotice: CURRENT_VAT_LEGAL_NOTICE,
    paymentMethodLabel: "Carte bancaire / Apple Pay via Stripe", paidAt: new Date("2099-01-01T11:55:00Z"), termsVersion: "music-cgv-qa", snapshotHashSha256: "a".repeat(64),
    ...overrides,
  };
}

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
  const financialEvents = await read("lib/payments/provider-financial-events.ts");
  assert.match(refund, /nextStatus === "SUCCEEDED"[\s\S]*issueCreditNoteForRefund\(transaction, \{ refundAttemptId: attempt\.id \}\)/);
  assert.match(financialEvents, /!payment\.invoice[\s\S]*outcome: "REQUIRES_REVIEW"/);
  assert.match(financialEvents, /issueCreditNoteForRefund\(transaction, \{ refundAttemptId: attempt\.id \}\)/);
  assert.doesNotMatch(`${refund}\n${financialEvents}\n${await read("lib/billing/service.ts")}`, /issueCreditNoteForRefundIfInvoiceExists/);
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
    assert.match(source, /billingDocumentRenderMode/);
    assert.match(source, /payment\.mode/);
    assert.doesNotMatch(source, /paymentIntent|accessToken|providerEvent/);
  }
});

test("billing presentation derives final versus test rendering only from persisted payment mode", () => {
  assert.equal(billingDocumentRenderMode("LIVE"), "FINAL");
  for (const mode of ["TEST", "", "forged", null, undefined]) {
    assert.equal(billingDocumentRenderMode(mode), "TEST");
  }
  assert.deepEqual(billingDocumentPresentation("INVOICE", "LIVE"), {
    renderMode: "FINAL", label: "Facture · document comptable", warning: null,
  });
  assert.equal(billingDocumentPresentation("CREDIT_NOTE", "TEST").warning, "DOCUMENT DE TEST — SANS VALEUR COMPTABLE.");
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

test("billing document pages expose one accessible premium PDF action before quiet navigation", async () => {
  const memberInvoice = await read("app/compte/factures/[invoiceNumber]/page.tsx");
  const memberCredit = await read("app/compte/avoirs/[creditNoteNumber]/page.tsx");
  const adminInvoice = await read("app/admin/facturation/[invoiceNumber]/page.tsx");
  const adminCredit = await read("app/admin/facturation/avoirs/[creditNoteNumber]/page.tsx");
  const globalCss = await read("app/globals.css");
  const adminCss = await read("app/admin/admin.css");

  for (const source of [memberInvoice, memberCredit]) {
    assert.match(source, /className="billing-document-actions" role="group" aria-label="Actions du document"/);
    assert.match(source, /className="button button--primary billing-document-download"/);
    assert.match(source, /className="button button--quiet"/);
    assert.equal((source.match(/Télécharger le PDF/g) ?? []).length, 1);
  }
  assert.match(memberInvoice, /\/api\/billing\/invoices\/.*\/pdf/);
  assert.match(memberCredit, /\/api\/billing\/credit-notes\/.*\/pdf/);

  for (const source of [adminInvoice, adminCredit]) {
    assert.match(source, /className="admin-action-row" role="group" aria-label="Actions du document"/);
    assert.match(source, /className="admin-button admin-button--primary"/);
    assert.match(source, /className="admin-button admin-button--quiet"/);
    assert.equal((source.match(/TÉLÉCHARGER LE PDF/g) ?? []).length, 1);
  }
  assert.match(globalCss, /\.billing-document-download:is\(:hover, :focus-visible\)/);
  assert.match(globalCss, /\.billing-document-download:active/);
  assert.match(globalCss, /\.billing-document-actions \.button \{ width: 100%; \}/);
  assert.match(adminCss, /\.admin-button--primary:is\(:hover, :focus-visible\)/);
  assert.match(adminCss, /\.admin-button--primary:active/);
});

test("billing PDF layout reserves non-overlapping metadata, QA banner, body and footer bands", () => {
  assert.ok(billingPdfLayout.metadataY + billingPdfLayout.metadataHeight < billingPdfLayout.qaBannerY);
  assert.ok(billingPdfLayout.qaBannerY + billingPdfLayout.qaBannerHeight < billingPdfLayout.qaBodyY);
  assert.ok(billingPdfLayout.footerY + billingPdfLayout.footerHeight <= billingPdfLayout.pageHeight - billingPdfLayout.safePrintMargin);
});

test("reviewed after-sales credit notes keep their internal code but expose a French customer label", async () => {
  assert.equal(creditNoteReasonLabel("OTHER_REVIEWED"), "Remboursement après traitement SAV");
  const memberPage = await read("app/compte/avoirs/[creditNoteNumber]/page.tsx");
  assert.match(memberPage, /creditNoteReasonLabel\(creditNote\.reasonCode\)/);
  assert.doesNotMatch(memberPage, /<dd>\{creditNote\.reasonCode\}<\/dd>/);
  const invoice = invoiceFixture({
    invoiceNumber: "LNX-20990101-5002",
    orderNumberSnapshot: "LNX-SHOP-2099-500002",
    subtotalCents: 7500,
    shippingCents: 800,
    totalCents: 8300,
  });
  const result = await generateCreditNotePdf({
    creditNoteNumber: "AV-LNX-20990101-0005",
    issuedAt: invoice.issuedAt,
    amountCents: 2500,
    cumulativeCreditedCents: 2500,
    remainingBalanceCents: 5800,
    currency: "EUR",
    reasonCode: "OTHER_REVIEWED",
    reasonText: "Dossier SAV LNX-SAV-2099-EXEMPLE",
    snapshotHashSha256: "c".repeat(64),
    invoice,
  });
  const rendered = decodedPdfPageText(result.bytes).join("\n");
  assert.match(rendered, /Remboursement après traitement SAV/);
  assert.doesNotMatch(rendered, /OTHER_REVIEWED/);
  assert.match(rendered, /Montant de l’avoir : 25,00[ \u00a0]€/);
  assert.match(rendered, /Solde documentaire restant : 58,00[ \u00a0]€/);
});

test("four short billing QA fixtures render on exactly one page with complete snapshot text", async () => {
  const individualMusic = invoiceFixture();
  const professionalMusic = invoiceFixture({
    invoiceNumber: "LNX-20990101-0002", totalCents: 5000, subtotalCents: 5000,
    lineItemsSnapshot: [{ description: "Création musicale avec priorité fictive QA", quantity: 1, unitPriceCents: 5000, lineTotalCents: 5000 }],
    customerSnapshot: { type: "PROFESSIONAL", name: "Marie Exemple", email: "qa@example.invalid", companyName: "Entreprise Exemple SAS", billingAddress: { line1: "12 rue Exemple", line2: null, postalCode: "75000", city: "Paris", countryCode: "FR" }, businessIdentifier: "12345678900012", vatId: null },
  });
  const shop = invoiceFixture({
    invoiceNumber: "LNX-20990101-0003", orderNumberSnapshot: "LNX-SHOP-2099-000001", subtotalCents: 2500, shippingCents: 500, totalCents: 3000,
    lineItemsSnapshot: [{ description: "CD audio fictif QA", quantity: 1, unitPriceCents: 2500, lineTotalCents: 2500 }], termsVersion: "shop-cgv-qa",
  });
  const creditInvoice = invoiceFixture({ invoiceNumber: "LNX-20990101-0004" });
  const results = [
    await generateInvoicePdf(individualMusic),
    await generateInvoicePdf(professionalMusic),
    await generateInvoicePdf(shop),
    await generateCreditNotePdf({ creditNoteNumber: "AV-LNX-20990101-0001", issuedAt: creditInvoice.issuedAt, amountCents: 1000, cumulativeCreditedCents: 1000, remainingBalanceCents: 2000, currency: "EUR", reasonCode: "NON_CONFORMITY", reasonText: null, snapshotHashSha256: "b".repeat(64), invoice: creditInvoice }),
  ];
  for (const [index, result] of results.entries()) {
    const pages = decodedPdfPageText(result.bytes);
    const rendered = pages.join("\n");
    const normalized = rendered.replace(/\s+/g, " ");
    assert.equal(result.bytes.subarray(0, 4).toString(), "%PDF");
    assert.ok(result.bytes.length > 1_000);
    assert.equal(result.pageCount, 1);
    assert.equal(pages.length, 1);
    assert.match(rendered, /DOCUMENT QA — SANS VALEUR COMPTABLE/);
    assert.match(normalized, /TVA non applicable, article 293 B du CGI/);
    if (index < 3) assert.match(rendered, /Ludovic Mickaël Mathon/);
    assert.match(rendered, /Conservation comptable : 10 ans\./);
    assert.match(rendered, /Page 1 \/ 1/);
  }
  const normalized = results.map((result) => decodedPdfPageText(result.bytes).join("\n").replace(/\s+/g, " "));
  assert.match(normalized[0]!, /TOTAL : 30,00 €/);
  assert.match(normalized[1]!, /TOTAL : 50,00 €/);
  assert.match(normalized[2]!, /Livraison : 5,00 €/);
  assert.match(normalized[3]!, /Montant de l’avoir : 10,00 €/);
  assert.match(normalized[3]!, /Solde documentaire restant : 20,00 €/);
  assert.doesNotMatch(Buffer.concat(results.map((result) => result.bytes)).toString("latin1"), /sk_live_|sk_test_|whsec_|DATABASE_URL|AUTH_SECRET/);
});

test("final LIVE invoice and credit-note PDFs omit every test watermark", async () => {
  const invoice = invoiceFixture();
  const invoiceResult = await generateInvoicePdf(invoice, "FINAL");
  const creditResult = await generateCreditNotePdf({
    creditNoteNumber: "AV-LNX-20990101-0009",
    issuedAt: invoice.issuedAt,
    amountCents: 1000,
    cumulativeCreditedCents: 1000,
    remainingBalanceCents: 2000,
    currency: "EUR",
    reasonCode: "NON_CONFORMITY",
    reasonText: "Cas final fictif",
    snapshotHashSha256: "f".repeat(64),
    invoice,
  }, "FINAL");
  for (const result of [invoiceResult, creditResult]) {
    assert.equal(result.pageCount, 1);
    assert.doesNotMatch(decodedPdfPageText(result.bytes).join("\n"), /DOCUMENT QA|DOCUMENT DE TEST|SANS VALEUR COMPTABLE/);
  }
});

test("long invoices paginate naturally and repeat the safe footer on every real page", async () => {
  const lineItems = Array.from({ length: 36 }, (_, index) => ({
    description: `Ligne fictive QA ${index + 1} — prestation détaillée destinée à vérifier la pagination réelle du document`,
    quantity: 1,
    unitPriceCents: 100,
    lineTotalCents: 100,
  }));
  const result = await generateInvoicePdf(invoiceFixture({ lineItemsSnapshot: lineItems, subtotalCents: 3600, totalCents: 3600 }));
  const pages = decodedPdfPageText(result.bytes);
  assert.equal(result.pageCount, pages.length);
  assert.ok(result.pageCount > 1, "A genuinely long invoice must remain multipage.");
  for (const [index, page] of pages.entries()) {
    assert.match(page, /LNX STUDIO/);
    assert.match(page, /Conservation comptable : 10 ans\./);
    assert.match(page, new RegExp(`Page ${index + 1} / ${pages.length}`));
  }
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
