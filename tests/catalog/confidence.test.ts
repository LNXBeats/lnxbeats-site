import assert from "node:assert/strict";
import test from "node:test";

import { deriveCatalogConfidence, projectCompletenessLabel } from "@/lib/catalog/confidence";

function project(overrides: Partial<Parameters<typeof deriveCatalogConfidence>[0]> = {}) {
  return {
    status: "PUBLISHED",
    slug: "projet-qa",
    title: "Projet QA",
    shortDescription: "Court récit",
    description: "Récit documenté",
    releaseDate: null,
    trackCount: null,
    seoTitle: null,
    seoDescription: null,
    tracks: [],
    platformLinks: [],
    credits: [],
    assets: [],
    ...overrides,
  };
}

test("cover presence, release date and platforms are derived from real data", () => {
  const missing = deriveCatalogConfidence(project());
  assert.equal(missing.artwork, "placeholder");
  assert.equal(missing.release, "unknown");
  assert.equal(missing.platforms, "unknown");

  const complete = deriveCatalogConfidence(project({ assets: [{}], releaseDate: new Date("2026-08-11T00:00:00Z"), platformLinks: [{}] }));
  assert.equal(complete.artwork, "confirmed");
  assert.equal(complete.release, "confirmed");
  assert.equal(complete.platforms, "confirmed");
});

test("tracklist is complete only when named tracks reach the declared count", () => {
  assert.equal(deriveCatalogConfidence(project({ trackCount: 12 })).tracklist, "partial");
  assert.equal(deriveCatalogConfidence(project({ trackCount: 2, tracks: [{}, {}] })).tracklist, "confirmed");
  assert.equal(deriveCatalogConfidence(project({ tracks: [{}] })).tracklist, "partial");
  assert.equal(deriveCatalogConfidence(project()).tracklist, "unknown");
});

test("global completeness is calculated from the principal domains", () => {
  const complete = deriveCatalogConfidence(project({
    releaseDate: new Date("2026-08-11T00:00:00Z"), assets: [{}], trackCount: 1, tracks: [{}], platformLinks: [{}],
    seoTitle: "Projet QA — LNX Beats", seoDescription: "Description SEO", legacy: { editorial: "confirmed" },
  }));
  assert.equal(complete.overall, "confirmed");
  assert.equal(projectCompletenessLabel(complete), "Informations principales complètes");
  assert.equal(projectCompletenessLabel(deriveCatalogConfidence(project())), "Projet à compléter");
});

test("SEO is effective when safe automatic fallbacks exist", () => {
  assert.equal(deriveCatalogConfidence(project()).seo, "confirmed");
  assert.equal(deriveCatalogConfidence(project({ description: null, shortDescription: null })).seo, "confirmed");
});
