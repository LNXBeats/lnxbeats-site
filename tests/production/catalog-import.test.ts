import assert from "node:assert/strict";
import test from "node:test";

import type { PrismaClient } from "@/generated/prisma/client";
import { applyProductionCatalogImport, canonicalCatalogRecords, planProductionCatalogImport } from "@/lib/production/catalog-import";
import { CATALOG_PRODUCTION_CONFIRMATION, ProductionBootstrapError } from "@/lib/production/bootstrap-environment";

function environment(overrides: Record<string, string | undefined> = {}) {
  return {
    NODE_ENV: "production", LNX_DATABASE_TARGET: "lnx-studio-production",
    AUTH_URL: "https://www.lnxbeats.fr", APP_CANONICAL_URL: "https://www.lnxbeats.fr",
    DATABASE_URL: "postgresql://app:secret@production.internal:5432/lnx_production",
    CATALOG_PRODUCTION_CONFIRM: CATALOG_PRODUCTION_CONFIRMATION,
    ...overrides,
  };
}

function emptyClient() {
  let createCalls = 0;
  const project = {
    findMany: async () => [], findUnique: async () => null,
    create: async () => { createCalls += 1; return {}; },
  };
  const transaction = { project, $queryRaw: async () => [{ locked: true }] };
  return {
    client: { project, $transaction: async (operation: (value: typeof transaction) => unknown) => operation(transaction) } as unknown as PrismaClient,
    createCalls: () => createCalls,
  };
}

test("versioned Git catalogue is the canonical 25-project source without QA markers", () => {
  const source = canonicalCatalogRecords();
  assert.equal(source.length, 25);
  assert.equal(new Set(source.map(({ record }) => record.slug)).size, 25);
  assert.doesNotMatch(JSON.stringify(source), /example\.invalid|\bstaging\b|\bqa[-_:]/i);
});

test("catalogue dry-run plans creation and performs no write", async () => {
  const database = emptyClient();
  const plan = await planProductionCatalogImport(database.client, environment());
  assert.equal(plan.sourceProjects, 25);
  assert.equal(plan.creates.length, 25);
  assert.equal(database.createCalls(), 0);
});

test("catalogue apply refuses missing confirmation before transaction", async () => {
  const database = emptyClient();
  await assert.rejects(
    () => applyProductionCatalogImport(database.client, environment({ CATALOG_PRODUCTION_CONFIRM: undefined })),
    ProductionBootstrapError,
  );
  assert.equal(database.createCalls(), 0);
});

test("catalogue import refuses staging, local and ambiguous targets", async () => {
  const database = emptyClient();
  await assert.rejects(() => planProductionCatalogImport(database.client, environment({ NODE_ENV: "test" })), ProductionBootstrapError);
  await assert.rejects(() => planProductionCatalogImport(database.client, environment({ LNX_DATABASE_TARGET: "lnx-studio-staging" })), ProductionBootstrapError);
  await assert.rejects(() => planProductionCatalogImport(database.client, environment({ DATABASE_URL: "postgresql://x:y@staging.internal:5432/db" })), ProductionBootstrapError);
});

test("catalogue apply creates the complete source in one transaction", async () => {
  const database = emptyClient();
  const result = await applyProductionCatalogImport(database.client, environment());
  assert.equal(result.created, 25);
  assert.equal(database.createCalls(), 25);
});
