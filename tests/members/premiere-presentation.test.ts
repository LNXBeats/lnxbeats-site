import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { memberPremiereTracks, withMemberPremierePreviews, jukeboxMemberPremierePreview } from "@/lib/members/premiere-presentation";
import { messages } from "@/lib/i18n/messages";

const member = { role: "MEMBER", status: "ACTIVE", emailVerified: true };
const excerptId = "c97a1c38-4329-4bb2-bf27-6426d0829db4";
const url = `/media/members-premieres/${excerptId}`;
const premiere = () => ({ slug: "pavillon-qa", tracks: [{ id: "track-1", previewUrl: url, durationMs: 59_000 }] });
const digital = () => ({ membersPreviewOnly: true,
  album: { id: "album-offer", priceCents: 990, version: 3, trackCount: 1, owned: false },
  tracks: [{ id: "track-1", title: "Titre original", position: 1, publication: "RELEASED", previewUrl: null as string | null, previewDurationMs: null as number | null,
    fullDurationMs: 184_000, owned: false, offer: { id: "track-offer", priceCents: 129, version: 2 } }],
});

test("direct member previews: anonymous, unverified, inactive and unknown roles get no protected URL", () => {
  for (const actor of [null, undefined, { ...member, emailVerified: false }, { ...member, status: "SUSPENDED" }, { ...member, role: "VISITOR" }]) {
    assert.deepEqual(memberPremiereTracks(actor, "pavillon-qa", [premiere()]), []);
    assert.equal(jukeboxMemberPremierePreview(actor, "pavillon-qa", [premiere()]), null);
    const result = withMemberPremierePreviews(actor, "pavillon-qa", digital(), [premiere()]);
    assert.equal(result.tracks[0].previewUrl, null);
    assert.doesNotMatch(JSON.stringify(result), /media\/members-premieres/);
  }
});

test("direct member previews: only active verified permitted roles use the exact member route", () => {
  for (const role of ["MEMBER", "CUSTOMER", "ADMIN"]) {
    assert.deepEqual(memberPremiereTracks({ ...member, role }, "pavillon-qa", [premiere()]), [{ id: "track-1", previewUrl: url, previewDurationMs: 59_000 }]);
    assert.deepEqual(jukeboxMemberPremierePreview({ ...member, role }, "pavillon-qa", [premiere()]), { url, durationMs: 59_000 });
  }
});

test("direct member previews: no matching exact published projection means no audio or invented offer", () => {
  for (const projects of [[], [{ ...premiere(), slug: "different-project" }], [premiere(), premiere()]]) {
    assert.deepEqual(memberPremiereTracks(member, "pavillon-qa", projects), []);
    const source = digital(), view = withMemberPremierePreviews(member, "pavillon-qa", source, projects);
    assert.equal(view.memberPreviewAccess, "unavailable");
    assert.equal(view.tracks[0].previewUrl, null);
    assert.equal(view.album, source.album);
    assert.equal(view.tracks[0].offer, source.tracks[0].offer);
  }
});

test("direct member previews: exact track matching leaves prices, offers, ownership and source objects unchanged", () => {
  const source = digital(), before = JSON.stringify(source);
  const view = withMemberPremierePreviews(member, "pavillon-qa", source, [premiere()]);
  assert.equal(view.memberPreviewAccess, "available");
  assert.deepEqual(view.tracks[0], { ...source.tracks[0], previewUrl: url, previewDurationMs: 59_000 });
  assert.equal(view.album, source.album);
  assert.equal(view.tracks[0].offer, source.tracks[0].offer);
  assert.equal(JSON.stringify(source), before);
  const otherTrack = { ...premiere(), tracks: [{ ...premiere().tracks[0], id: "other-track" }] };
  assert.equal(withMemberPremierePreviews(member, "pavillon-qa", source, [otherTrack]).tracks[0].previewUrl, null);
});

test("direct member previews: never substitutes public excerpts or modifies non-member catalogue projects", () => {
  const source = digital(); source.tracks[0].previewUrl = `/media/digital/previews/${excerptId}`; source.tracks[0].previewDurationMs = 30_000;
  const view = withMemberPremierePreviews(member, "pavillon-qa", source, [premiere()]);
  assert.equal(view.tracks[0], source.tracks[0]);
  const publicSource = { ...digital(), membersPreviewOnly: false };
  assert.equal(withMemberPremierePreviews(member, "pavillon-qa", publicSource, [premiere()]), publicSource);
});

test("direct member previews: full files, public/signed/storage URLs and malformed route values are rejected", () => {
  for (const previewUrl of [`https://www.lnxbeats.fr${url}`, `//example.test${url}`, `https://bucket.example/file.mp3?signature=private`,
    `/media/digital/previews/${excerptId}`, `/api/digital/downloads/${excerptId}`, `/media/members-premieres/covers/${excerptId}`,
    `digital/studio/${excerptId}/source.wav`, `/media/members-premieres/../${excerptId}`, `${url}?token=private`, `${url}#test`, `${url}.wav`, ""]) {
    const projects = [{ ...premiere(), tracks: [{ ...premiere().tracks[0], previewUrl }] }];
    assert.deepEqual(memberPremiereTracks(member, "pavillon-qa", projects), [], previewUrl);
    assert.equal(jukeboxMemberPremierePreview(member, "pavillon-qa", projects), null);
  }
});

test("direct member previews: only bounded positive integral excerpt durations are accepted", () => {
  for (const durationMs of [null, 0, -1, 60_001, 184_000, 1.5, NaN, Infinity]) {
    assert.deepEqual(memberPremiereTracks(member, "pavillon-qa", [{ ...premiere(), tracks: [{ ...premiere().tracks[0], durationMs }] }]), [], String(durationMs));
  }
  for (const durationMs of [1, 60_000]) assert.equal(memberPremiereTracks(member, "pavillon-qa", [{ ...premiere(), tracks: [{ ...premiere().tracks[0], durationMs }] }])[0].previewDurationMs, durationMs);
});

test("direct member previews: projection cannot leak source storage, documentary bindings or full asset fields", () => {
  const project = { ...premiere(), binding: "private-binding", storageKey: "digital/studio/private.wav", masterAsset: { storageKey: "full.wav" },
    tracks: [{ ...premiere().tracks[0], mp3Asset: { storageKey: "full.mp3" }, sourceUrl: "https://private.example" }] };
  assert.deepEqual(memberPremiereTracks(member, "pavillon-qa", [project]), [{ id: "track-1", previewUrl: url, previewDurationMs: 59_000 }]);
  assert.doesNotMatch(JSON.stringify(withMemberPremierePreviews(member, "pavillon-qa", digital(), [project])), /storageKey|binding|Asset|sourceUrl|private\.example/);
});

test("direct member previews: duplicate track identities fail closed without matching by title", () => {
  assert.deepEqual(memberPremiereTracks(member, "pavillon-qa", [{ ...premiere(), tracks: [premiere().tracks[0], premiere().tracks[0]] }]), []);
});

test("direct member previews: anonymous and unverified visitors have actionable member-specific hints", () => {
  assert.equal(withMemberPremierePreviews(null, "pavillon-qa", digital(), []).memberPreviewAccess, "sign-in");
  assert.equal(withMemberPremierePreviews({ ...member, emailVerified: false }, "pavillon-qa", digital(), []).memberPreviewAccess, "verify-email");
  for (const copy of ["Extrait réservé aux membres", "Se connecter pour écouter les extraits", "Vérifier mon e-mail pour écouter les extraits", "Extraits membres — écoutez directement ci-dessous."]) {
    assert.equal(messages[copy].length, 5); assert(messages[copy].every(value => value.length > 0));
  }
});

test("direct member previews: album page reuses exact publication gates and player stays lazy, coordinated and protected", async () => {
  const page = await readFile(new URL("../../app/album/[slug]/page.tsx", import.meta.url), "utf8");
  const player = await readFile(new URL("../../components/digital-catalog.tsx", import.meta.url), "utf8");
  assert.match(page, /listMemberPremieres\(session\?\.user, undefined, undefined, \{ slug: project\.slug \}\)/);
  assert.match(page, /withMemberPremierePreviews\(session\?\.user, project\.slug, publicDigital, premieres\)/);
  assert.match(player, /preload="none"/); assert.match(player, /listenForOtherMediaPlayback/);
  assert.match(player, /memberPreviewAccess === "sign-in" \|\| memberPreviewAccess === "verify-email" \? "Extrait réservé aux membres"/);
  assert.doesNotMatch(player, /storageKey|masterAssetId/);
});
