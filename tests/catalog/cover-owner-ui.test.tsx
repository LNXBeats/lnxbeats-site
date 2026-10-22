import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CatalogCoverForm } from "../../components/catalog-cover-form";

const props = { projectId: "00000000-0000-4000-8000-000000000001", slug: "synthetic-only", currentCoverAssetId: null, alt: "", altPlaceholder: "Synthetic cover", hasCover: false };
test("Express owner upload has no repeated image-rights checkbox and still requires a real upload action", () => {
  const html = renderToStaticMarkup(<CatalogCoverForm {...props} ownerDeclarationAtUpload />);
  assert.doesNotMatch(html, /name="rightsConfirmed"|Je confirme disposer des droits/);
  assert.match(html, /type="file"/); assert.match(html, /accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(html, /type="button"[^>]*>Ajouter la cover/);
  assert.doesNotMatch(html, /action=|autoFocus/);
});
test("Existing Catalogue cover review remains explicit, with native file selection and its rights confirmation", () => {
  const html = renderToStaticMarkup(<CatalogCoverForm {...props} />);
  assert.match(html, /<input[^>]*type="checkbox"[^>]*required=""[^>]*name="rightsConfirmed"/);
  assert.match(html, /Je confirme disposer des droits nécessaires pour publier cette image/);
});
