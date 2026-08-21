import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("member rights page humanizes platforms, wishes, and immutable document versions", async () => {
  const page = await readFile("app/compte/droits/[requestNumber]/page.tsx", "utf8");
  assert.match(page, /humanRightsPlatform/);
  assert.match(page, /Durée souhaitée/);
  assert.match(page, /Durée retenue pour étude/);
  assert.match(page, /Territoire souhaité/);
  assert.match(page, /Territoire retenu pour étude/);
  assert.match(page, /Dernière version/);
  assert.match(page, /Version \$\{version\} — \$\{suffix\}/);
  assert.match(page, /Projet non actif/);
  assert.match(page, /PartnershipPreauthorizationRevision/);
  assert.doesNotMatch(page, /project\.platforms\.join/);
  assert.doesNotMatch(page, /grant\.platforms\.join/);
});

test("partnership P02 action is explicit, single-purpose, and never accepts browser pricing", async () => {
  const component = await readFile("components/partnership-preauthorization-revision.tsx", "utf8");
  assert.match(component, /GÉNÉRER LA VERSION P02/);
  assert.match(component, /method: "POST"/);
  assert.match(component, /P01 reste archivée/);
  assert.doesNotMatch(component, /price|amount|currency|Stripe|checkout|PaymentIntent/i);
});
