import assert from "node:assert/strict";
import test from "node:test";

import {
  CREATION_ACTION_CONFIRMATIONS,
  getCreationPublicationBlockers,
  isPublishableCreationAsset,
} from "../../lib/creations/domain";
import {
  CreationAdminFormError,
  CreationValidationError,
  normalizeCreationSlug,
  parseCreationEditorInput,
  parseCreationExternalLinkInput,
  strictCreationFormData,
} from "../../lib/creations/validation";

const editorInput = {
  slug: "clip-avec-anna",
  title: "Clip avec Anna",
  summary: "Une collaboration musicale et audiovisuelle.",
  description: "Le récit complet de la création.",
  collaborator: "Anna",
  credits: "Musique : LNX Beats",
  category: "Collaboration",
  primaryMedia: "VIDEO",
  position: "3",
  seoTitle: "Clip avec Anna · LNX Beats",
  seoDescription: "Découvrez cette collaboration de LNX Beats.",
};

const publishableVideo = {
  role: "VIDEO",
  asset: { visibility: "PUBLIC", type: "VIDEO", mimeType: "video/mp4", rightsStatus: "CLEARED" },
};

test("normalizes creation slugs and keeps reserved Admin paths closed", () => {
  assert.equal(normalizeCreationSlug("  Création d’Été — LNX  "), "creation-d-ete-lnx");
  assert.throws(
    () => parseCreationEditorInput({ ...editorInput, slug: "nouveau" }),
    (error: unknown) => error instanceof CreationValidationError && error.code === "INVALID_SLUG",
  );
});

test("parses the complete editor contract without accepting lifecycle fields", () => {
  assert.deepEqual(parseCreationEditorInput(editorInput), {
    slug: "clip-avec-anna",
    title: "Clip avec Anna",
    summary: "Une collaboration musicale et audiovisuelle.",
    description: "Le récit complet de la création.",
    collaborator: "Anna",
    credits: "Musique : LNX Beats",
    category: "Collaboration",
    primaryMedia: "VIDEO",
    position: 3,
    seoTitle: "Clip avec Anna · LNX Beats",
    seoDescription: "Découvrez cette collaboration de LNX Beats.",
  });
  assert.throws(
    () => parseCreationEditorInput({ ...editorInput, status: "PUBLISHED" }),
    (error: unknown) => error instanceof CreationValidationError && error.code === "UNEXPECTED_FIELD",
  );
  assert.throws(() => parseCreationEditorInput({ ...editorInput, primaryMedia: "STREAM" }), /média principal/);
  assert.throws(() => parseCreationEditorInput({ ...editorInput, position: "1.5" }), /entier/);
});

test("strict FormData rejects duplicates, files and unknown fields", () => {
  const valid = new FormData();
  valid.set("title", "Titre");
  assert.deepEqual(strictCreationFormData(valid, ["title"]), { title: "Titre" });

  const duplicate = new FormData();
  duplicate.append("title", "A");
  duplicate.append("title", "B");
  assert.throws(
    () => strictCreationFormData(duplicate, ["title"]),
    (error: unknown) => error instanceof CreationAdminFormError && error.code === "INVALID_FORM",
  );

  const unexpected = new FormData();
  unexpected.set("status", "PUBLISHED");
  assert.throws(() => strictCreationFormData(unexpected, ["title"]), CreationAdminFormError);
});

test("accepts only credential-free HTTPS external links", () => {
  assert.deepEqual(parseCreationExternalLinkInput({
    label: "Voir sur YouTube",
    url: "https://www.youtube.com/watch?v=abc",
    position: "2",
  }), {
    label: "Voir sur YouTube",
    url: "https://www.youtube.com/watch?v=abc",
    position: 2,
  });
  assert.throws(() => parseCreationExternalLinkInput({ label: "HTTP", url: "http://example.com", position: 0 }), /HTTPS/);
  assert.throws(() => parseCreationExternalLinkInput({ label: "Secret", url: "https://user:pass@example.com", position: 0 }), /HTTPS/);
});

test("publication accepts only public, cleared and role-coherent media", () => {
  assert.equal(isPublishableCreationAsset(publishableVideo), true);
  assert.equal(isPublishableCreationAsset({ ...publishableVideo, asset: { ...publishableVideo.asset, visibility: "PRIVATE" } }), false);
  assert.equal(isPublishableCreationAsset({ ...publishableVideo, asset: { ...publishableVideo.asset, rightsStatus: "PENDING" } }), false);
  assert.equal(isPublishableCreationAsset({ ...publishableVideo, asset: { ...publishableVideo.asset, mimeType: "video/webm" } }), false);
  assert.equal(isPublishableCreationAsset({ ...publishableVideo, role: "AUDIO" }), false);
  assert.equal(isPublishableCreationAsset({
    role: "COVER",
    asset: { visibility: "PUBLIC", type: "COVER", mimeType: "image/jpeg", rightsStatus: "CLEARED" },
  }), false);

  assert.deepEqual(getCreationPublicationBlockers({
    title: "Clip avec Anna",
    summary: "Une collaboration.",
    primaryMedia: "VIDEO",
    assets: [publishableVideo],
  }), []);
  assert.deepEqual(getCreationPublicationBlockers({
    title: "Clip avec Anna",
    summary: null,
    primaryMedia: "AUDIO",
    assets: [publishableVideo],
  }), ["SUMMARY_MISSING", "PRIMARY_MEDIA_ASSET_MISSING"]);
  assert.deepEqual(getCreationPublicationBlockers({
    title: "Affiche seule",
    summary: "Un visuel sans média jouable.",
    primaryMedia: "COVER",
    assets: [{
      role: "COVER",
      asset: { visibility: "PUBLIC", type: "COVER", mimeType: "image/webp", rightsStatus: "CLEARED" },
    }],
  }), ["PLAYABLE_MEDIA_MISSING"]);
});

test("lifecycle operations require distinct explicit confirmations", () => {
  assert.deepEqual(CREATION_ACTION_CONFIRMATIONS, {
    publish: "CONFIRM_CREATION_PUBLICATION",
    unpublish: "CONFIRM_CREATION_UNPUBLICATION",
    archive: "CONFIRM_CREATION_ARCHIVAL",
    deleteExternalLink: "CONFIRM_CREATION_EXTERNAL_LINK_DELETION",
  });
  assert.equal(new Set(Object.values(CREATION_ACTION_CONFIRMATIONS)).size, 4);
});
