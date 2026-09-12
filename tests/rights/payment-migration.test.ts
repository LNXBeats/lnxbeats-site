import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the Rights payment migration is additive and keeps an exact-one business parent", async () => {
  const sql = await readFile("prisma/migrations/20260909130000_rights_publication_license_commerce/migration.sql", "utf8");
  assert.match(sql, /ADD COLUMN\s+"rightsRequestId" UUID/i);
  assert.match(sql, /payments_parent_xor/);
  assert.match(sql, /\("orderId" IS NOT NULL\)::INTEGER\s*\+ \("shopOrderId" IS NOT NULL\)::INTEGER\s*\+ \("rightsRequestId" IS NOT NULL\)::INTEGER\) = 1/);
  assert.match(sql, /CREATE TABLE "rights_payment_winners"/);
  assert.match(sql, /CREATE TABLE "rights_licenses"/);
  assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE|DELETE FROM/);
});

test("Rights invoices and notifications remain owned by exactly one business aggregate", async () => {
  const sql = await readFile("prisma/migrations/20260909130000_rights_publication_license_commerce/migration.sql", "utf8");
  assert.match(sql, /invoices_parent_xor/);
  assert.match(sql, /order_notifications_parent_xor/);
  assert.match(sql, /"rightsRequestId"\) REFERENCES "rights_requests"/);
});

test("the final operator policy is a new unapproved template version without early performance", async () => {
  const sql = await readFile("prisma/migrations/20260909125000_publication_license_operator_policy_v3/migration.sql", "utf8");
  assert.match(sql, /'PUBLICATION_LICENSE',\s*3,\s*'Conditions particulières/s);
  assert.match(sql, /'DRAFT'/);
  assert.match(sql, /Aucun commencement anticipé ni renoncement anticipé/);
  assert.match(sql, /quatorze jours/);
  assert.doesNotMatch(sql, /\bUPDATE\b|\bDELETE\b|\bAPPROVED\b/);
});

test("the v4 contract candidate is additive, DRAFT, and leaves every historical template untouched", async () => {
  const sql = await readFile("prisma/migrations/20260912120000_publication_license_contract_v4/migration.sql", "utf8");
  assert.match(sql, /'PUBLICATION_LICENSE',\s*4,\s*'Conditions particulières/s);
  assert.match(sql, /'DRAFT'/);
  assert.match(sql, /WHERE NOT EXISTS/);
  assert.match(sql, /Ne sont proposés ni commencement anticipé ni renonciation anticipée/);
  assert.match(sql, /Transparence et reddition des informations d’exploitation/);
  assert.doesNotMatch(sql, /\bUPDATE\b|\bDELETE\b|\bAPPROVED\b|DROP TABLE|TRUNCATE/i);
});

test("the Rights withdrawal migration is additive and guards activation and refund parentage", async () => {
  const sql = await readFile("prisma/migrations/20260909131000_rights_withdrawal_lifecycle/migration.sql", "utf8");
  assert.match(sql, /CREATE TABLE "rights_withdrawal_requests"/);
  assert.match(sql, /ADD COLUMN "rightsWithdrawalId" UUID/);
  assert.match(sql, /RIGHTS_REFUND_PARENT_MISMATCH/);
  assert.match(sql, /RIGHTS_WITHDRAWAL_BLOCKS_ACTIVATION/);
  assert.match(sql, /pg_advisory_xact_lock/);
  assert.match(sql, /p\."amountCents" = NEW\."amountCents"/);
  assert.doesNotMatch(sql, /DROP TABLE|TRUNCATE|DELETE FROM|UPDATE\s+"/i);
});
