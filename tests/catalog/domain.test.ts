import assert from "node:assert/strict";
import test from "node:test";

import { projects } from "@/data/discography";
import { CATALOG_SOURCE_VERSION, LEGACY_CATALOG_PROJECT_COUNT, isIsoDate, legacyProjectRecord, parseLegacyDuration } from "@/lib/catalog/legacy";
import { CatalogValidationError, parseCreditRole, parseDate, parseHttpsUrl, parseJukeboxPlacement, requiredText } from "@/lib/catalog/validation";

test("the frozen catalogue has 25 unique, ordered records", () => {
  assert.equal(projects.length, LEGACY_CATALOG_PROJECT_COUNT);
  assert.equal(new Set(projects.map(({ slug }) => slug)).size, LEGACY_CATALOG_PROJECT_COUNT);
  const records = projects.map(legacyProjectRecord);
  assert.deepEqual(records.map(({ catalogPosition }) => catalogPosition), Array.from({ length: 25 }, (_, index) => index + 1));
  assert.equal(records.filter(({ featured }) => featured).length, 1);
  assert.equal(records.every(({ legacySourceVersion }) => legacySourceVersion === CATALOG_SOURCE_VERSION), true);
});

test("admin publication and credit choices are validated against the existing model", () => {
  assert.equal(parseJukeboxPlacement("none"), "none");
  assert.equal(parseJukeboxPlacement("published"), "published");
  assert.equal(parseCreditRole("writer"), "writer");
  assert.equal(parseCreditRole("engineer"), "engineer");
  assert.throws(() => parseJukeboxPlacement("homepage"), CatalogValidationError);
  assert.throws(() => parseCreditRole("invented-role"), CatalogValidationError);
});

test("unknown release dates remain null and declared track counts do not invent tracks", () => {
  for (const [index, project] of projects.entries()) {
    const record = legacyProjectRecord(project, index);
    if (project.releaseDate === null) assert.equal(record.releaseDate, null);
    assert.equal(record.tracks.length, project.tracks.length);
    assert.equal(record.trackCount, project.trackCount);
    assert.equal(record.tracks.every(({ durationSeconds }) => durationSeconds === null), true, "No 30-second preview placeholder may become a track duration.");
  }
});

test("date, duration, text and URL validation fail closed", () => {
  assert.equal(isIsoDate("2026-08-11"), true);
  assert.equal(isIsoDate("2026-02-30"), false);
  assert.equal(parseLegacyDuration("3:09"), 189);
  assert.equal(parseDate("2026-08-11")?.toISOString().slice(0, 10), "2026-08-11");
  assert.equal(requiredText("  Titre  ", "Titre", 20), "Titre");
  assert.equal(requiredText("<script>alert(1)</script>", "Titre", 40), "<script>alert(1)</script>");
  assert.equal(parseHttpsUrl("https://youtu.be/example", "youtube"), "https://youtu.be/example");
  assert.throws(() => parseDate("11/08/2026"), CatalogValidationError);
  assert.throws(() => parseHttpsUrl("http://open.spotify.com/track/example", "spotify"), CatalogValidationError);
  assert.throws(() => parseHttpsUrl("https://example.com/track", "spotify"), CatalogValidationError);
});
