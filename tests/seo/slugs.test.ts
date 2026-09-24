import assert from "node:assert/strict";
import test from "node:test";

import { availableSlug, generatedSlugCandidate, nextFormerSlugs, slugifyTitle } from "@/lib/seo/slugs";

test("public slugification handles French punctuation and Unicode consistently", () => {
  assert.equal(slugifyTitle("J’ai adopté un humain"), "j-ai-adopte-un-humain");
  assert.equal(slugifyTitle("L’Œuvre & l'Æther — Straße"), "l-oeuvre-l-aether-strasse");
  assert.equal(slugifyTitle("  Éclats...  déjà-vu !!!  "), "eclats-deja-vu");
  assert.match(slugifyTitle("漢字"), /^creation-[a-z0-9]+$/);
  assert.equal(slugifyTitle("漢字"), slugifyTitle("漢字"));
  assert.equal(slugifyTitle("!!!"), "");
  assert.equal(slugifyTitle("a".repeat(200)).length, 160);
  assert.equal(generatedSlugCandidate("Nouveau", new Set(["nouveau"])), "nouveau-2");
});

test("collisions reserve a short deterministic suffix within the database limit", async () => {
  const seen = new Set(["titre", "titre-2"]);
  assert.equal(await availableSlug("Titre", async (candidate) => seen.has(candidate)), "titre-3");
  assert.equal(await availableSlug("a".repeat(200), async (candidate) => candidate === "a".repeat(160)), `${"a".repeat(158)}-2`);
  assert.equal(await availableSlug("漢字", async () => false), slugifyTitle("漢字"));
  await assert.rejects(() => availableSlug("!!!", async () => false));
});

test("former slugs point directly to the current address and never chain", () => {
  assert.deepEqual(nextFormerSlugs("premier", [], "deuxieme"), ["premier"]);
  assert.deepEqual(nextFormerSlugs("deuxieme", ["premier"], "troisieme"), ["premier", "deuxieme"]);
  assert.deepEqual(nextFormerSlugs("troisieme", ["premier", "deuxieme"], "premier"), ["deuxieme", "troisieme"]);
});
