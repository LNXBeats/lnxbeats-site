import assert from "node:assert/strict";
import test from "node:test";

import { automaticCatalogCoverAlt, catalogCoverAltOverride, resolveCatalogCoverAlt } from "@/lib/catalog/cover-alt";
import { catalogSeoMode, effectiveCatalogSeoDescription, effectiveCatalogSeoTitle } from "@/lib/catalog/seo";

test("cover alt follows a title change when no custom override exists", () => {
  assert.equal(automaticCatalogCoverAlt("J’ai adopté un humain"), "Pochette de « J’ai adopté un humain » — LNX Beats");
  assert.equal(resolveCatalogCoverAlt("J’ai adopté un humain TEST", null), "Pochette de « J’ai adopté un humain TEST » — LNX Beats");
  assert.equal(catalogCoverAltOverride("Pochette de J’ai adopté un humain", "J’ai adopté un humain"), null);
});

test("a custom cover alt is preserved exactly apart from surrounding spaces", () => {
  assert.equal(resolveCatalogCoverAlt("J’ai adopté un humain", "  Pochette alternative personnalisée  "), "Pochette alternative personnalisée");
});

test("effective SEO fallbacks do not create artificial missing-data warnings", () => {
  const automatic = { title: "Projet QA", shortDescription: "Récit court", description: "Récit complet", seoTitle: null, seoDescription: null };
  assert.equal(effectiveCatalogSeoTitle(automatic), "Projet QA — LNX Beats");
  assert.equal(effectiveCatalogSeoDescription(automatic), "Récit complet");
  assert.equal(catalogSeoMode(automatic), "automatic");
  assert.equal(catalogSeoMode({ ...automatic, seoTitle: "Titre sur mesure" }), "mixed");
  assert.equal(catalogSeoMode({ ...automatic, seoTitle: "Titre sur mesure", seoDescription: "Description sur mesure" }), "custom");
});
