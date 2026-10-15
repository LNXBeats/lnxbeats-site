import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

test("Admin equivalence API authenticates both methods and accepts only the explicit immutable-review input", async () => {
  const route = await readFile(new URL("../../app/api/admin/digital/master-equivalences/route.ts", import.meta.url), "utf8");
  assert.equal((route.match(/digitalActor\(request, true\)/g) ?? []).length, 2);
  assert.match(route, /digitalRateLimit\(actor.id, "master-equivalence-write", 20\)/);
  assert.match(route, /getAll\("trackId"\)\.length !== 1/);
  assert.match(route, /digitalBody\(request, \["trackId", "sourceMasterId", "targetMasterId", "status", "expectedReviewId", "privateEvidenceReference", "evidenceSha256", "attested", "reason", "idempotencyKey"\]\)/);
  assert.match(route, /recordDigitalMasterEquivalence\(actor, body\)/);
  assert.doesNotMatch(route, /APPROVED|grant|digitalEntitlement|digitalOrder\.update|digitalMaster\.update/);
});

test("Admin equivalence decisions require explicit direction, selection and reread rather than inferred remapping", async () => {
  const ui = await readFile(new URL("../../components/digital-master-equivalences.tsx", import.meta.url), "utf8");
  assert.match(ui, /useState<EquivalenceStatus \| "">\(""\)/);
  assert.match(ui, /useState\(false\).*\[reason, setReason\]/);
  assert.match(ui, /sourceMasterId === targetMasterId/);
  assert.match(ui, /expectedReviewId: latest\?\.id \?\? null/);
  assert.match(ui, /new URLSearchParams\(\{ trackId, sourceMasterId, targetMasterId \}\)/);
  assert.match(ui, /pairReady \? pair.current : null/);
  assert.doesNotMatch(ui, /data\?\.reviews.find/);
  assert.match(ui, /checked=\{attested\} required/);
  assert.match(ui, /option value="REVOKED"/);
  assert.match(ui, /identifiants différents restent refusées/);
  assert.match(ui, /requestId \?\? crypto.randomUUID\(\)/);
  assert.doesNotMatch(ui, /digitalRequest|rightsConfirmed|createDigitalDownload|createDigitalFreeCompletion/);
});
