import test from "node:test";
import assert from "node:assert/strict";
import { preparationCounterLabels, preparationPersonalActions } from "../../lib/digital/preparation-personal-actions";
import type { PreparedTrack } from "../../lib/digital/discography-preparation-policy";

const track: PreparedTrack = { id: "t", title: "Fixture synthétique", position: 1, released: true, masterId: "m", version: 1, durationMs: 90000, technicalReady: true, rightsApproved: false, artisticValidated: false, publicPreviewAllowed: false, priceCents: 129, composerDocumented: true };
const project = { id: "p", slug: "fixture-qa", artistDocumented: true, coverCleared: true, coverConflict: false, tracks: [track] };

test("catalogue counters distinguish one filtered project from the complete catalogue", () => {
  const tracks = Array.from({ length: 221 }, (_, i) => ({ technicalReady: i < 200 }));
  assert.deepEqual(preparationCounterLabels(1, tracks), { projects: "1 projet affiché", catalogue: "Catalogue complet : 200/221 pistes techniquement prêtes" });
});
test("catalogue counters preserve the complete total for zero or multiple filtered projects", () => {
  const tracks = [{ technicalReady: true }, { technicalReady: false }];
  for (const count of [0, 4, 20]) assert.deepEqual(preparationCounterLabels(count, tracks), { projects: `${count} projets affichés`, catalogue: "Catalogue complet : 1/2 pistes techniquement prêtes" });
});
test("catalogue counters adapt to an empty or changed catalogue without modifying the input", () => {
  assert.equal(preparationCounterLabels(0, []).catalogue, "Catalogue complet : 0/0 pistes techniquement prêtes");
  const tracks = Object.freeze([Object.freeze({ technicalReady: true })]);
  assert.equal(preparationCounterLabels(1, tracks).catalogue, "Catalogue complet : 1/1 pistes techniquement prêtes");
  assert.equal(tracks.length, 1);
});

test("rights and artistic actions remain distinct and target the existing group review", () => {
  const actions = preparationPersonalActions(project);
  assert.deepEqual(actions.map(a => a.code), ["VERSION_RIGHTS", "ARTISTIC_REVIEW"]);
  assert.equal(actions[0].href, "/admin/musique/revue?projet=p#droits-originaux");
  assert.equal(actions[1].href, "/admin/musique/revue?projet=p");
  assert.match(actions[1].label, /écoutes déjà enregistrées sont conservées/);
});
test("an artistic decision does not clear rights or restart validated listening", () => {
  assert.deepEqual(preparationPersonalActions({ ...project, tracks: [{ ...track, artisticValidated: true }] }).map(a => a.code), ["VERSION_RIGHTS"]);
});
test("a rights decision never implies an artistic decision", () => {
  assert.deepEqual(preparationPersonalActions({ ...project, tracks: [{ ...track, rightsApproved: true }] }).map(a => a.code), ["ARTISTIC_REVIEW"]);
});
test("approved VIE-like versions have no new rights or artistic request", () => {
  const tracks = Array.from({ length: 12 }, (_, i) => ({ ...track, id: String(i), artisticValidated: true, rightsApproved: true }));
  assert.deepEqual(preparationPersonalActions({ ...project, tracks }), []);
});
test("a missing exact master is listed separately, not proposed for review or automatic import", () => {
  const actions = preparationPersonalActions({ ...project, tracks: [{ ...track, masterId: null, technicalReady: false }] });
  assert.deepEqual(actions.map(a => a.code), ["MASTER_IDENTITY"]);
  assert.match(actions[0].label, /Aucun import n’est repris automatiquement/);
  assert.equal(actions[0].href, "/admin/musique/express?projet=p#audio");
});
test("mixed albums count only demonstrable versions for rights and listening", () => {
  const actions = preparationPersonalActions({ ...project, tracks: [track, { ...track, id: "blocked", technicalReady: false }, { ...track, id: "approved", artisticValidated: true, rightsApproved: true }] });
  for (const code of ["VERSION_RIGHTS", "ARTISTIC_REVIEW", "MASTER_IDENTITY"]) assert.match(actions.find(a => a.code === code)!.label, /1 (?:version|extrait)/);
});
test("missing artist documentation is not confused with missing composer documentation", () => {
  const actions = preparationPersonalActions({ ...project, artistDocumented: false, tracks: [{ ...track, composerDocumented: false }, track] });
  const credit = actions.find(a => a.code === "CREDITS_DOCUMENTATION")!;
  assert.match(credit.label, /artiste du projet à documenter/);
  assert.match(credit.label, /compositeur à documenter pour 1 titre/);
  assert.equal(credit.href, "/admin/catalogue/fixture-qa");
  assert.match(credit.label, /Aucun nom n’est déduit/);
});
test("composer documentation alone does not invent a missing artist", () => {
  const credit = preparationPersonalActions({ ...project, tracks: [{ ...track, composerDocumented: false }] }).find(a => a.code === "CREDITS_DOCUMENTATION")!;
  assert.doesNotMatch(credit.label, /artiste du projet/);
});
test("a cleared but conflicting cover remains a personal review action", () => {
  const cover = preparationPersonalActions({ ...project, coverConflict: true }).find(a => a.code === "COVER_REVIEW")!;
  assert.match(cover.label, /plusieurs fichiers/);
  assert.equal(cover.href, "/admin/musique/express?projet=p#identite");
});
test("uncleared cover remains blocked, no cleared cover action is invented", () => {
  assert(preparationPersonalActions({ ...project, coverCleared: false }).some(a => a.code === "COVER_REVIEW"));
  assert(!preparationPersonalActions(project).some(a => a.code === "COVER_REVIEW"));
});
test("personal presentation never changes prices, approvals, versions or input arrays", () => {
  const frozen = Object.freeze({ ...project, tracks: Object.freeze([Object.freeze({ ...track })]) as unknown as PreparedTrack[] });
  const before = JSON.stringify(frozen);
  assert.deepEqual(preparationPersonalActions(frozen), preparationPersonalActions(frozen));
  assert.equal(JSON.stringify(frozen), before);
  assert(preparationPersonalActions(frozen).every(a => a.href.startsWith("/admin/") && !/publier|checkout|capture|import-start/.test(a.href)));
});
test("route identifiers are encoded without a new navigation or upload mechanism", () => {
  const actions = preparationPersonalActions({ ...project, id: "id&autre=1", slug: "nom?x=1", artistDocumented: false });
  assert(actions[0].href.includes("id%26autre%3D1"));
  assert.equal(actions.find(a => a.code === "CREDITS_DOCUMENTATION")!.href, "/admin/catalogue/nom%3Fx%3D1");
});
