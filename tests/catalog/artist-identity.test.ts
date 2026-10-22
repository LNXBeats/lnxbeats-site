import assert from "node:assert/strict";
import test from "node:test";
import { CATALOG_PRIMARY_ARTIST, catalogArtistAlreadyDocumented, catalogPrimaryArtist, catalogSecondaryCredits } from "@/lib/catalog/artist-identity";
import { mapDatabaseProject } from "@/lib/catalog/mapper";
import { buildProjectStructuredData } from "@/lib/seo/structured-data";
import { digitalRightsReviewHash } from "@/lib/digital/rights-review-policy";
import { ANNOUNCEMENT_POLICY, announcementAllowed } from "@/lib/digital/announcement-policy";

test("primary stage identity is scoped to musical projects, not legal or other activities", () => {
  for (const type of ["ALBUM", "SINGLE", "album", "single"]) assert.equal(catalogPrimaryArtist(type), "LNX Beats Studio");
  for (const type of ["PROJECT", "CONTRACT", "WRITER", "COMPOSER"]) assert.equal(catalogPrimaryArtist(type), undefined);
});
test("self ARTIST aliases leave one separate byline; collaborators and legal credits are unchanged", () => {
  const credits = [
    { id: "a", role: "ARTIST", name: "LNX Beats" }, { id: "b", role: "ARTIST", name: "Ludovic Mathon" },
    { id: "c", role: "ARTIST", name: "MATHON Ludovic Mickaël" }, { id: "d", role: "ARTIST", name: "LNX Beats Studio" },
    { id: "e", role: "ARTIST", name: "Autre artiste" }, { id: "f", role: "COMPOSER", name: "MATHON Ludovic Mickaël" },
    ...["WRITER", "PRODUCER", "FEATURING", "ENGINEER", "OTHER"].map(role => ({ id: role, role, name: "Ludovic Mathon" })),
  ];
  const before = JSON.stringify(credits); const projected = catalogSecondaryCredits(credits);
  assert.deepEqual(projected, credits.slice(4)); assert.equal(JSON.stringify(credits), before);
  assert(projected.every(c => c === credits.find(old => old.id === c.id)));
});
test("known artist spellings do not create a second self credit; composer is never treated as artist", () => {
  assert(catalogArtistAlreadyDocumented([{ role: "ARTIST", name: "  mathon LUDOVIC mickae\u0308l " }], CATALOG_PRIMARY_ARTIST));
  assert(catalogArtistAlreadyDocumented([{ role: "ARTIST", name: "Autre Artiste" }], "autre artiste"));
  assert(!catalogArtistAlreadyDocumented([{ role: "COMPOSER", name: "MATHON Ludovic Mickaël" }], CATALOG_PRIMARY_ARTIST));
  assert(!catalogArtistAlreadyDocumented([{ role: "ARTIST", name: "Un collaborateur" }], CATALOG_PRIMARY_ARTIST));
});
test("the owner's full legal name is an artist alias only, without rewriting legal roles or source rows", () => {
  const credits = [
    { role: "ARTIST", name: "Ludovic Mickaël Mathon" },
    { role: "COMPOSER", name: "Ludovic Mickaël Mathon" },
    { role: "WRITER", name: "Ludovic Mickaël Mathon" },
    { role: "PRODUCER", name: "Ludovic Mickaël Mathon" },
    { role: "ARTIST", name: "Autre artiste" },
  ];
  const before = JSON.stringify(credits);
  assert.deepEqual(catalogSecondaryCredits(credits), credits.slice(1));
  assert(catalogArtistAlreadyDocumented(credits, CATALOG_PRIMARY_ARTIST));
  assert(catalogArtistAlreadyDocumented([{ role: "ARTIST", name: "LNX Beats" }], "Ludovic Mickae\u0308l Mathon"));
  assert(!catalogArtistAlreadyDocumented([{ role: "COMPOSER", name: "Ludovic Mickaël Mathon" }], CATALOG_PRIMARY_ARTIST));
  assert.equal(JSON.stringify(credits), before);
});
const source = () => ({ slug: "qa-identite", title: "QA identité", subtitle: null, type: "ALBUM", status: "PUBLISHED", publicVisible: true, jukeboxPlacement: null, jukeboxPosition: null,
  catalogPosition: 1, shortDescription: null, description: null, releaseDate: null, highlighted: false, trackCount: 1, artworkTone: "gold", seoTitle: null, seoDescription: null, confidence: "PARTIAL",
  tracks: [{ id: "track", position: 1, title: "Titre QA", durationSeconds: 100, status: "RELEASED" }],
  credits: [{ role: "ARTIST", name: "Ludovic Mathon", note: "Source historique" }, { role: "COMPOSER", name: "MATHON Ludovic Mickaël", note: "Preuve conservée" }],
});
test("public mapper inherits the stage identity for each track without changing stored source credits", () => {
  const raw = source(), before = JSON.stringify(raw), p = mapDatabaseProject(raw);
  assert.equal(p.primaryArtist, CATALOG_PRIMARY_ARTIST); assert.equal(p.tracks[0].primaryArtist, CATALOG_PRIMARY_ARTIST);
  assert.deepEqual(p.credits, [{ role: "composer", name: "MATHON Ludovic Mickaël", detail: "Preuve conservée" }]); assert.equal(JSON.stringify(raw), before);
});
test("an uncredited project gets a byline but no invented documentary credit or approval", () => {
  const p = mapDatabaseProject({ ...source(), credits: [] }); assert.equal(p.primaryArtist, CATALOG_PRIMARY_ARTIST); assert.deepEqual(p.credits, []);
  assert(!("rightsApproved" in p)); assert(!("offerActive" in p));
});
test("non-musical project keeps its original artist and legal display", () => {
  const p = mapDatabaseProject({ ...source(), type: "PROJECT" }); assert.equal(p.primaryArtist, undefined); assert.equal(p.credits[0].name, "Ludovic Mathon");
});
test("display projection preserves raw documentary bindings; an actual credit change still requires a new authorization", () => {
  const raw = source(), creditsHash = digitalRightsReviewHash(raw.credits), binding = { projectId: "project", slug: raw.slug, title: raw.title, coverId: "cover", coverSha256: "a".repeat(64), editorialHash: "b".repeat(64), tracksHash: "c".repeat(64), creditsHash };
  const record = { policy: ANNOUNCEMENT_POLICY, binding, metadataOnly: true, saleApproved: false, historicalPublicVisible: true, historicalStatus: "PUBLISHED", sourceSHA: "d".repeat(40), sourceSnapshotSha256: "e".repeat(64) };
  const approval = { ...record, recordHash: digitalRightsReviewHash(record) }; assert(announcementAllowed(binding, approval));
  mapDatabaseProject(raw); assert.equal(digitalRightsReviewHash(raw.credits), creditsHash); assert(announcementAllowed(binding, approval));
  assert.equal(announcementAllowed({ ...binding, creditsHash: digitalRightsReviewHash([{ role: "ARTIST", name: CATALOG_PRIMARY_ARTIST }]) }, approval), false);
});
test("album, single and individual recording byArtist use the stage name, without inferring composer or producer", () => {
  for (const type of ["ALBUM", "SINGLE"]) {
    const p = mapDatabaseProject({ ...source(), type }), data = buildProjectStructuredData(p), text = JSON.stringify(data);
    assert(text.includes('"name":"LNX Beats Studio"')); assert(!text.includes('"composer"')); assert(!text.includes('"producer"'));
    const graph = JSON.parse(text) as { "@graph": Array<{ "@type": string; byArtist?: { name?: string }; track?: Array<{ byArtist: { name?: string } }> }> };
    const recording = graph["@graph"].find(n => ["MusicAlbum", "MusicRecording"].includes(n["@type"])); assert(recording); assert.equal(recording.byArtist?.name, CATALOG_PRIMARY_ARTIST);
    if (recording.track) assert(recording.track.every(t => t.byArtist.name === CATALOG_PRIMARY_ARTIST));
  }
});
