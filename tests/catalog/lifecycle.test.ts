import assert from "node:assert/strict";
import test from "node:test";

import { CatalogValidationError } from "@/lib/catalog/validation";
import { getCatalogDeletionEligibility, normalizeCatalogSlug, parseCatalogSlug } from "@/lib/catalog/lifecycle";

test("catalogue slugs are deterministic, accent-free and route-safe", () => {
  assert.equal(normalizeCatalogSlug("  J’ai adopté un humain !  "), "j-ai-adopte-un-humain");
  assert.equal(normalizeCatalogSlug("L’ÉTÉ & l'hiver"), "l-ete-l-hiver");
  assert.equal(parseCatalogSlug(" Projet QA 06301 "), "projet-qa-06301");
  assert.match(parseCatalogSlug("a".repeat(200)), /^[a-z0-9-]{1,160}$/);
  assert.throws(() => parseCatalogSlug("---"), CatalogValidationError);
  assert.throws(() => parseCatalogSlug("nouveau"), CatalogValidationError);
  assert.throws(() => parseCatalogSlug({ slug: "forged" }), CatalogValidationError);
});

test("permanent deletion requires a hidden draft or archive and never a featured project", () => {
  assert.equal(getCatalogDeletionEligibility({ featured: false, publicVisible: false, status: "DRAFT" }).eligible, true);
  assert.equal(getCatalogDeletionEligibility({ featured: false, publicVisible: false, status: "ARCHIVED" }).eligible, true);
  assert.match(getCatalogDeletionEligibility({ featured: true, publicVisible: false, status: "ARCHIVED" }).reason, /mise en avant/i);
  assert.match(getCatalogDeletionEligibility({ featured: false, publicVisible: true, status: "DRAFT" }).reason, /masquez/i);
  assert.match(getCatalogDeletionEligibility({ featured: false, publicVisible: false, status: "PUBLISHED" }).reason, /archivez/i);
  assert.equal(getCatalogDeletionEligibility({ featured: false, publicVisible: false, status: "IN_DEVELOPMENT" }).eligible, false);
});
