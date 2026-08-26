import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const actionsPath = new URL("../../app/admin/tarifs/actions.ts", import.meta.url);
const pagePath = new URL("../../app/admin/tarifs/page.tsx", import.meta.url);
const formPath = new URL("../../app/admin/tarifs/pricing-activation-form.tsx", import.meta.url);
const servicePath = new URL("../../lib/pricing/service.ts", import.meta.url);

test("Admin pricing mutation is same-origin, ADMIN-only and explicitly confirmed", async () => {
  const source = await readFile(actionsPath, "utf8");
  assert.match(source, /isSameOriginMutation/);
  assert.match(source, /requireAdmin/);
  assert.match(source, /MUSIC_PRICING_ACTIVATION_CONFIRMATION/);
  assert.match(source, /strictPricingFormData/);
  assert.match(source, /!PRICING_FORM_FIELDS\.has\(key\)/);
  assert.match(source, /key in result/);
  assert.match(source, /typeof value !== "string"/);
  assert.match(source, /expectedRevision: input\.expectedRevision/);
  assert.doesNotMatch(source, /input\.version/);
  assert.doesNotMatch(source, /input\.actorAdminId/);
});

test("activation is transactional, locked and protected by the expected revision", async () => {
  const source = await readFile(servicePath, "utf8");
  assert.match(source, /prisma\.\$transaction/);
  assert.match(source, /pg_advisory_xact_lock/);
  assert.match(source, /configuration\.revision !== input\.expectedRevision/);
  assert.match(source, /revision: input\.expectedRevision/);
  assert.match(source, /activeVersionId: configuration\.activeVersion\.id/);
  assert.match(source, /status: "RETIRED"/);
  assert.match(source, /status: "ACTIVE"/);
  assert.match(source, /musicPricingActivation\.create/);
  assert.doesNotMatch(source, /@\/lib\/payments/);
  assert.doesNotMatch(source, /@\/lib\/orders/);
});

test("Admin page exposes history and clearly keeps the V1 financial cutover closed", async () => {
  const source = await readFile(pagePath, "utf8");
  const form = await readFile(formPath, "utf8");
  assert.match(source, /Historique immuable/);
  assert.match(source, /Journal des activations/);
  assert.match(form, /Vérification avant activation/);
  assert.match(form, /Anciens tarifs/);
  assert.match(form, /Nouveaux tarifs saisis/);
  assert.match(form, /Les commandes existantes ne seront jamais modifiées/);
  assert.match(source, /Commander et les paiements restent sur la tarification legacy/);
  assert.match(form, /type="hidden" name="currency" value="EUR"/);
  assert.match(form, /type="checkbox" name="confirmation"/);
});
