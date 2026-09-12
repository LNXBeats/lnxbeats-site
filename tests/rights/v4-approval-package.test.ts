import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  isPublicationLicenseV4CanonicalSource,
  normalizedContractTemplateHash,
  PUBLICATION_LICENSE_V4_CANONICAL_SHA256,
  publicationLicenseDraftTemplate,
} from "@/lib/rights/templates";

const migrationPath = "prisma/migrations/20260912120000_publication_license_contract_v4/migration.sql";
const packagePath = "docs/V1.2_RIGHTS_V4_APPROVAL_PACKAGE.md";

test("v4 migration, renderer binding, and approval package carry one exact canonical text", async () => {
  const [migration, approvalPackage] = await Promise.all([
    readFile(migrationPath, "utf8"),
    readFile(packagePath, "utf8"),
  ]);
  const persisted = migration.match(/\$template\$([\s\S]*?)\$template\$/)?.[1];
  const documented = approvalPackage.match(/<!-- RIGHTS_V4_CANONICAL_START -->\n([\s\S]*?)\n<!-- RIGHTS_V4_CANONICAL_END -->/)?.[1];
  assert.ok(persisted);
  assert.ok(documented);
  assert.equal(persisted.trim(), publicationLicenseDraftTemplate.trim());
  assert.equal(documented, publicationLicenseDraftTemplate.trim());
  assert.equal(normalizedContractTemplateHash(documented), PUBLICATION_LICENSE_V4_CANONICAL_SHA256);
  assert.equal(isPublicationLicenseV4CanonicalSource(documented), true);
  assert.equal(createHash("sha256").update(persisted, "utf8").digest("hex"), "701d0b808fc478ff1a1e80966ebd6d9a07d9be8ba393d7ff5dd5e5097c68c579");
});

test("v4 package records the legal blocker without fabricating approval", async () => {
  const approvalPackage = await readFile(packagePath, "utf8");
  assert.match(approvalPackage, /FIXED_FEE_150_LEGAL_BASIS = EXTERNAL_REVIEW_REQUIRED/);
  assert.match(approvalPackage, /L131_5_1_ACCOUNTING_CLAUSE = IMPLEMENTED/);
  assert.match(approvalPackage, /AUCUNE APPROBATION ENREGISTRÉE/);
  assert.doesNotMatch(approvalPackage, /LAWYER_APPROVED|EXTERNAL_COUNSEL_APPROVED/);
});
