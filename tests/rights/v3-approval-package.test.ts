import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  isPublicationLicenseV3CanonicalSource,
  normalizedContractTemplateHash,
  PUBLICATION_LICENSE_V3_CANONICAL_SHA256,
  publicationLicenseV3DraftTemplate,
} from "@/lib/rights/templates";

const migrationPath = "prisma/migrations/20260909125000_publication_license_operator_policy_v3/migration.sql";
const packagePath = "docs/V1.2_RIGHTS_V3_APPROVAL_PACKAGE.md";

test("the v3 migration, code binding and human approval package contain one exact canonical text", async () => {
  const [migration, approvalPackage] = await Promise.all([
    readFile(migrationPath, "utf8"),
    readFile(packagePath, "utf8"),
  ]);
  const persisted = migration.match(/\$template\$([\s\S]*?)\$template\$/)?.[1];
  const documented = approvalPackage.match(/<!-- RIGHTS_V3_CANONICAL_START -->\n([\s\S]*?)\n<!-- RIGHTS_V3_CANONICAL_END -->/)?.[1];
  assert.ok(persisted);
  assert.ok(documented);
  assert.equal(persisted.length, 5_265);
  assert.equal(createHash("sha256").update(persisted, "utf8").digest("hex"), "0ad636a04bc3e89c08f8cce2ab95396daa156c97cad4fe38cc46badb1cbc1f5e");
  assert.equal(persisted.trim(), publicationLicenseV3DraftTemplate.trim());
  assert.equal(documented, publicationLicenseV3DraftTemplate.trim());
  assert.equal(normalizedContractTemplateHash(documented), PUBLICATION_LICENSE_V3_CANONICAL_SHA256);
  assert.equal(isPublicationLicenseV3CanonicalSource(documented), true);
});

test("the v3 package does not fabricate approval evidence", async () => {
  const approvalPackage = await readFile(packagePath, "utf8");
  assert.match(approvalPackage, /AUCUNE APPROBATION ENREGISTRÉE/);
  assert.match(approvalPackage, /référence de revue juridique réelle/);
  assert.doesNotMatch(approvalPackage, /CONTRACT_V3_APPROVED_PRODUCTION\s*=\s*YES/);
});
