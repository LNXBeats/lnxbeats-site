import assert from "node:assert/strict";
import test from "node:test";
import { automaticSeoSummary } from "@/lib/seo/summary";
import { effectiveCatalogSeoDescription } from "@/lib/catalog/seo";

test("automatic descriptions are bounded at a word boundary without changing stored text", () => {
  const value = "Une histoire musicale authentique. ".repeat(20);
  const summary = automaticSeoSummary(value);
  assert.ok(summary.length <= 180);
  assert.ok(summary.endsWith("…"));
  assert.equal(automaticSeoSummary("Une\n histoire."), "Une histoire.");
  assert.equal(effectiveCatalogSeoDescription({ title: "Projet", description: value, shortDescription: "Le résumé", seoTitle: null, seoDescription: null }), summary);
  assert.equal(effectiveCatalogSeoDescription({ title: "Projet", description: value, shortDescription: "Le résumé", seoTitle: null, seoDescription: "Texte choisi explicitement" }), "Texte choisi explicitement");
});
