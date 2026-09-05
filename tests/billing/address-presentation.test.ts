import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { inflateSync } from "node:zlib";

import { billingAddressLines } from "@/lib/billing/address-presentation";
import { CURRENT_VAT_LEGAL_NOTICE } from "@/lib/billing/domain";
import { generateInvoicePdf, type InvoicePdfRecord } from "@/lib/billing/pdf";

const root = process.cwd();
const read = (path: string) => readFile(`${root}/${path}`, "utf8");

function decodedPdfText(bytes: Buffer): string {
  const source = bytes.toString("latin1");
  const decoder = new TextDecoder("windows-1252");
  const lines: string[] = [];
  for (const object of source.matchAll(/\d+\s+0\s+obj\b([\s\S]*?)endobj/g)) {
    const stream = object[1]!.match(/stream\r?\n([\s\S]*?)\r?\nendstream/);
    if (!stream) continue;
    const compressed = Buffer.from(stream[1]!, "latin1");
    let content: string;
    try {
      content = /\/FlateDecode/.test(object[1]!) ? inflateSync(compressed).toString("latin1") : compressed.toString("latin1");
    } catch {
      continue;
    }
    for (const textArray of content.matchAll(/\[([\s\S]*?)\]\s*TJ/g)) {
      const parts = [...textArray[1]!.matchAll(/<([0-9A-Fa-f]+)>/g)].map((part) => decoder.decode(Buffer.from(part[1]!, "hex")));
      if (parts.length) lines.push(parts.join(""));
    }
    for (const textValue of content.matchAll(/<([0-9A-Fa-f]+)>\s*Tj/g)) lines.push(decoder.decode(Buffer.from(textValue[1]!, "hex")));
  }
  return lines.join("\n");
}

const invoice: InvoicePdfRecord = {
  invoiceNumber: "LNX-20990101-1010",
  issuedAt: new Date("2099-01-01T12:00:00Z"),
  orderNumberSnapshot: "LNX-SHOP-2099-101010",
  sellerSnapshot: {
    legalName: "Vendeur Exemple",
    legalForm: "Entrepreneur individuel",
    tradeName: "LNX Beats",
    serviceName: "LNX STUDIO",
    address: { line1: "1 rue du Vendeur", postalCode: "75001", city: "Paris", countryCode: "FR" },
    siren: "123456789",
    siret: "12345678900012",
    ape: "9003B",
    email: "vendeur@example.invalid",
    phone: "01 02 03 04 05",
  },
  customerSnapshot: {
    type: "INDIVIDUAL",
    name: "Élodie Anne-Marie d'Arcy",
    email: "elodie@example.invalid",
    companyName: null,
    billingAddress: { line1: "18 rue de l'Exemple", line2: "Bâtiment B", postalCode: "69001", city: "Lyon", countryCode: "FR" },
    businessIdentifier: null,
    vatId: null,
  },
  lineItemsSnapshot: [{ description: "CD audio fictif", quantity: 1, unitPriceCents: 700, lineTotalCents: 700 }],
  subtotalCents: 700,
  shippingCents: 549,
  totalCents: 1249,
  currency: "EUR",
  vatLegalNotice: CURRENT_VAT_LEGAL_NOTICE,
  paymentMethodLabel: "Carte bancaire via Stripe",
  paidAt: new Date("2099-01-01T11:55:00Z"),
  termsVersion: "shop-cgv-qa",
  snapshotHashSha256: "a".repeat(64),
};

test("billing address presentation preserves one logical line per snapshot field", () => {
  assert.deepEqual(billingAddressLines({
    line1: "18 rue de l'Exemple",
    line2: "Bâtiment B",
    postalCode: "69001",
    city: "Lyon",
    countryCode: "FR",
  }), ["18 rue de l'Exemple", "Bâtiment B", "69001 Lyon", "France"]);
  assert.deepEqual(billingAddressLines({
    line1: "7 avenue Fictive",
    line2: null,
    postalCode: "75001",
    city: "Paris",
    countryCode: "FR",
  }), ["7 avenue Fictive", "75001 Paris", "France"]);
});

test("member invoice HTML renders every structured address line as its own block", async () => {
  const [page, css] = await Promise.all([
    read("app/compte/factures/[invoiceNumber]/page.tsx"),
    read("app/globals.css"),
  ]);
  assert.match(page, /billingAddressLines\(customer\.billingAddress\)\.map/);
  assert.match(page, /className="billing-customer-address"/);
  assert.match(page, /<span key=\{`\$\{index\}:\$\{line\}`\}>\{line\}<\/span>/);
  assert.match(css, /\.billing-customer-address\s*\{[^}]*display:\s*grid;[^}]*font-style:\s*normal;/);
  assert.doesNotMatch(page, /billingAddress\.line1\}\{customer\.billingAddress\.line2/);
});

test("final invoice PDF uses the same fictitious customer identity and address lines", async () => {
  const result = await generateInvoicePdf(invoice, "FINAL");
  const rendered = decodedPdfText(result.bytes);
  const expected = ["Élodie Anne-Marie d'Arcy", "18 rue de l'Exemple", "Bâtiment B", "69001 Lyon", "France"];
  let cursor = -1;
  for (const line of expected) {
    const index = rendered.indexOf(line);
    assert.ok(index > cursor, `${line} must be present after the preceding customer line.`);
    cursor = index;
  }
  assert.doesNotMatch(rendered, /Exemple69001|Bâtiment B69001|LyonFrance/);
  assert.doesNotMatch(rendered, /DOCUMENT QA|SANS VALEUR COMPTABLE/);
});
