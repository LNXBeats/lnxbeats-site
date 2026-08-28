import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = "prisma/migrations/20260828120000_legal_compliance_foundation/migration.sql";
const migration = readFileSync(migrationPath, "utf8");

test("Phase 4 migration is additive and preserves all historical schemas", () => {
  assert.doesNotMatch(migration, /\b(?:DROP|TRUNCATE)\b/i);
  assert.match(migration, /CREATE TABLE "legal_document_versions"/);
  assert.match(migration, /CREATE TABLE "consumer_withdrawal_requests"/);
  assert.match(migration, /one_active_per_type/);
  assert.match(migration, /parent_scope/);
  assert.match(migration, /acknowledgement_state/);
});

test("document and withdrawal evidence constraints remain fail-closed", () => {
  assert.match(migration, /"status" IN \('DRAFT', 'AWAITING_LEGAL_REVIEW'\)/);
  assert.match(migration, /"status" = 'ACTIVE'/);
  assert.match(migration, /"identityMatch" = 'UNMATCHED'/);
  assert.match(migration, /"identityMatch" = 'MATCHED'/);
  assert.match(migration, /"eligibilityReview" = 'PENDING_REVIEW'/);
  assert.match(migration, /"acknowledgementHashSha256" ~ '\^\[0-9a-f\]\{64\}\$'/);
});
