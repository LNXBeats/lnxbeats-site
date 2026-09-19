import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  CreationValidationError,
  parseCreationCollaboratorInput,
  parseCreationCollaboratorLinkInput,
} from "@/lib/creations/validation";

test("creation collaborators accept 0..N ordered people with optional extensible roles", () => {
  assert.deepEqual(parseCreationCollaboratorInput({ displayName: "  Da Lord ", role: " Artiste invité ", position: "2" }), {
    displayName: "Da Lord",
    role: "Artiste invité",
    position: 2,
  });
  assert.deepEqual(parseCreationCollaboratorInput({ displayName: "Artiste B", role: "", position: 0 }), {
    displayName: "Artiste B",
    role: null,
    position: 0,
  });
});

test("official collaborator links are HTTPS-only and platform-host bound", () => {
  const valid = [
    ["YOUTUBE", "https://www.youtube.com/@dalord"],
    ["INSTAGRAM", "https://instagram.com/dalord"],
    ["TIKTOK", "https://www.tiktok.com/@dalord"],
    ["SPOTIFY", "https://open.spotify.com/artist/example"],
    ["APPLE_MUSIC", "https://music.apple.com/fr/artist/example/1"],
    ["DEEZER", "https://link.deezer.com/s/example"],
    ["WEBSITE", "https://artist.example/"],
    ["OTHER", "https://profiles.example/artist"],
  ] as const;
  for (const [platform, url] of valid) {
    assert.equal(parseCreationCollaboratorLinkInput({ platform, url, label: "", position: "0" }).url, url);
  }
  for (const [platform, url] of [
    ["YOUTUBE", "https://youtube.com.evil.example/@dalord"],
    ["INSTAGRAM", "https://example.com/dalord"],
    ["SPOTIFY", "javascript:alert(1)"],
    ["OTHER", "http://example.com"],
    ["WEBSITE", "https://user:pass@example.com"],
  ]) {
    assert.throws(
      () => parseCreationCollaboratorLinkInput({ platform, url, label: "", position: "0" }),
      CreationValidationError,
    );
  }
});

test("V3.4 collaborator migration is additive, creation-scoped and Rights-free", async () => {
  const sql = await readFile("prisma/migrations/20260919120000_creation_video_ingest_collaborators/migration.sql", "utf8");
  assert.match(sql, /CREATE TABLE "creation_collaborators"/);
  assert.match(sql, /CREATE TABLE "creation_collaborator_links"/);
  assert.match(sql, /REFERENCES "creations"\("id"\) ON DELETE RESTRICT/);
  assert.match(sql, /REFERENCES "creation_collaborators"\("id"\) ON DELETE RESTRICT/);
  assert.match(sql, /creation_collaborator_links_url_valid/);
  assert.match(sql, /creation_collaborators_position_valid/);
  assert.match(sql, /ADD VALUE IF NOT EXISTS 'ANALYZING'/);
  assert.match(sql, /ADD VALUE IF NOT EXISTS 'TRANSCODING'/);
  assert.match(sql, /DROP CONSTRAINT "creation_media_upload_sessions_size_valid"/);
  assert.match(sql, /"declaredSizeBytes" > 0 AND "declaredSizeBytes" <= 524288000/);
  assert.match(sql, /"declaredMimeType" IN \('video\/mp4', 'video\/quicktime', 'video\/x-m4v', 'video\/webm'\)/);
  assert.doesNotMatch(sql, /DROP\s+(?:TABLE|COLUMN|TYPE)|publication_license_contract_v4|Rights V4/i);
});

test("Admin CRUD stays protected and public collaborator links are safe external anchors", async () => {
  const [actions, page, publicComponent, publicPage, publicStyles] = await Promise.all([
    readFile("app/admin/creations/actions.ts", "utf8"),
    readFile("app/admin/creations/[slug]/page.tsx", "utf8"),
    readFile("components/creations/creation-collaborators.tsx", "utf8"),
    readFile("app/creations/[slug]/page.tsx", "utf8"),
    readFile("app/creations/creations.css", "utf8"),
  ]);
  for (const action of [
    "createCreationCollaboratorAction", "updateCreationCollaboratorAction", "deleteCreationCollaboratorAction",
    "createCreationCollaboratorLinkAction", "updateCreationCollaboratorLinkAction", "deleteCreationCollaboratorLinkAction",
  ]) assert.match(actions, new RegExp(`export async function ${action}\\([\\s\\S]*?await authorize\\(\\)`));
  assert.match(page, /Collaborateurs/);
  assert.match(page, /Liens officiels/);
  assert.match(publicComponent, /target="_blank" rel="noopener noreferrer"/);
  assert.match(publicComponent, /aria-label=\{`\$\{label\} — \$\{collaborator\.displayName\}, nouvel onglet`\}/);
  assert.doesNotMatch(publicComponent, /dangerouslySetInnerHTML/);
  assert.match(publicPage, /CreationCollaborators/);
  assert.match(publicStyles, /\.creation-collaborators__grid/);
  assert.match(publicStyles, /@media \(max-width: 540px\)[\s\S]*?\.creation-collaborator ul \{ display: grid; grid-template-columns: 1fr; \}/);
});

test("removing a collaborator deletes only its local links and never another creation or artist", async () => {
  const service = await readFile("lib/creations/service.ts", "utf8");
  assert.match(service, /creationCollaborator\.findFirst\(\{ where: \{ id: collaboratorId, creationId \} \}\)/);
  assert.match(service, /creationCollaboratorLink\.deleteMany\(\{ where: \{ collaboratorId \} \}\)/);
  assert.match(service, /creationCollaborator\.delete\(\{ where: \{ id: collaboratorId \} \}\)/);
  assert.doesNotMatch(service, /artist\.delete|deleteMany\(\{ where: \{ creationId \} \}\)/);
});
