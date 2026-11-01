import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("paquet documentaire : Admin actif, LIVE, privé et aucune mutation", async () => {
  const source = await readFile(new URL("../../app/api/admin/recettes/gestion/package/route.ts", import.meta.url), "utf8");
  assert.match(source, /getAuthSession\(\)/); assert.match(source, /session\.user\.role !== "ADMIN"/); assert.match(source, /session\.user\.status !== "ACTIVE"/);
  assert.match(source, /private, no-store/); assert.match(source, /mode: "LIVE"/); assert.match(source, /collectRevenuePackageDocuments/); assert.match(source, /buildRevenueDocumentPackage/);
  assert.doesNotMatch(source, /export async function (POST|PUT|PATCH|DELETE)/); assert.doesNotMatch(source, /STRIPE_SECRET|PAYPAL_SECRET|process\.env/);
});

test("collecteur exige concordance prestataire, montant, PDF et empreinte", async () => {
  const source = await readFile(new URL("../../lib/admin/revenue-document-collector.ts", import.meta.url), "utf8");
  assert.match(source, /providerPaymentId !== row\.providerReference/); assert.match(source, /totalCents !== row\.amountCents/);
  assert.match(source, /providerRefundId !== row\.providerReference/); assert.match(source, /credit\.amountCents !== row\.amountCents/);
  assert.match(source, /sha256\(bytes\) !== document\.pdfHash/); assert.doesNotMatch(source, /prisma\.[A-Za-z]+\.(?:create|update|delete)\(/);
});
