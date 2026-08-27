import assert from "node:assert/strict";
import test from "node:test";

import { Prisma } from "@/generated/prisma/client";
import {
  createAndActivateMusicPricingVersion,
  MusicPricingServiceError,
  type MusicPricingActivationDependencies,
} from "@/lib/pricing/service";

const adminId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const activeVersion = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  version: "2026-08-v2",
  status: "ACTIVE",
  currency: "EUR",
  basePriceCents: 2_000,
  coverPriceCents: 1_000,
  priorityPriceCents: 3_000,
};

function transactionHarness() {
  const calls: Array<{ operation: string; input?: unknown }> = [];
  const configuration = {
    key: "music-order",
    activeVersionId: activeVersion.id,
    revision: 1,
    activeVersion: { ...activeVersion },
  };
  const createdVersion = {
    ...activeVersion,
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    version: "2026-08-v3",
    basePriceCents: 2_500,
  };

  const transaction = {
    async $queryRaw() {
      calls.push({ operation: "lock" });
      return [{ locked: true }];
    },
    musicPricingConfiguration: {
      async findUnique() {
        calls.push({ operation: "configuration.read" });
        return configuration;
      },
      async updateMany(input: unknown) {
        calls.push({ operation: "configuration.update", input });
        return { count: 1 };
      },
    },
    musicPricingVersion: {
      async updateMany(input: unknown) {
        calls.push({ operation: "version.retire", input });
        return { count: 1 };
      },
      async create(input: unknown) {
        calls.push({ operation: "version.create", input });
        return createdVersion;
      },
    },
    musicPricingActivation: {
      async create(input: unknown) {
        calls.push({ operation: "activation.create", input });
        return { id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" };
      },
    },
  };

  const dependencies: MusicPricingActivationDependencies = {
    async transaction<T>(operation: (client: Prisma.TransactionClient) => Promise<T>) {
      calls.push({ operation: "transaction.begin" });
      return operation(transaction as unknown as Prisma.TransactionClient);
    },
  };

  return { dependencies, calls, configuration };
}

test("a changed price creates and activates one immutable version in the locked transaction", async () => {
  const harness = transactionHarness();
  const result = await createAndActivateMusicPricingVersion({
    actorAdminId: adminId,
    expectedRevision: 1,
    pricing: { currency: "EUR", basePrice: "25", coverPrice: "10", priorityPrice: "30" },
  }, harness.dependencies);

  assert.equal(result.version.version, "2026-08-v3");
  assert.equal(result.revision, 2);
  assert.deepEqual(harness.calls.map(({ operation }) => operation), [
    "transaction.begin",
    "lock",
    "configuration.read",
    "version.retire",
    "version.create",
    "configuration.update",
    "activation.create",
  ]);

  const retire = harness.calls.find(({ operation }) => operation === "version.retire")?.input as {
    where: unknown;
    data: Record<string, unknown>;
  };
  assert.deepEqual(retire.where, { id: activeVersion.id, status: "ACTIVE" });
  assert.equal(retire.data.status, "RETIRED");
  assert.equal("basePriceCents" in retire.data, false, "historical amounts must never be rewritten");

  const creation = harness.calls.find(({ operation }) => operation === "version.create")?.input as {
    data: Record<string, unknown>;
  };
  assert.equal(creation.data.version, "2026-08-v3");
  assert.equal(creation.data.basePriceCents, 2_500);
  assert.equal(creation.data.createdByAdminId, adminId);
  assert.equal(creation.data.status, "ACTIVE");

  const configurationUpdate = harness.calls.find(({ operation }) => operation === "configuration.update")?.input as {
    where: Record<string, unknown>;
    data: Record<string, unknown>;
  };
  assert.equal(configurationUpdate.where.revision, 1);
  assert.equal(configurationUpdate.where.activeVersionId, activeVersion.id);
  assert.equal(configurationUpdate.data.revision, 2);
});

test("a stale Admin revision fails before any pricing write", async () => {
  const harness = transactionHarness();
  await assert.rejects(
    createAndActivateMusicPricingVersion({
      actorAdminId: adminId,
      expectedRevision: 2,
      pricing: { currency: "EUR", basePrice: "25", coverPrice: "10", priorityPrice: "30" },
    }, harness.dependencies),
    (error: unknown) => error instanceof MusicPricingServiceError && error.code === "REVISION_CONFLICT",
  );
  assert.deepEqual(harness.calls.map(({ operation }) => operation), [
    "transaction.begin",
    "lock",
    "configuration.read",
  ]);
});

test("unchanged values do not create a redundant version", async () => {
  const harness = transactionHarness();
  await assert.rejects(
    createAndActivateMusicPricingVersion({
      actorAdminId: adminId,
      expectedRevision: 1,
      pricing: { currency: "EUR", basePrice: "20", coverPrice: "10", priorityPrice: "30" },
    }, harness.dependencies),
    (error: unknown) => error instanceof MusicPricingServiceError && error.code === "UNCHANGED",
  );
  assert.deepEqual(harness.calls.map(({ operation }) => operation), [
    "transaction.begin",
    "lock",
    "configuration.read",
  ]);
});

test("a PostgreSQL serialization conflict is exposed as a stable revision conflict", async () => {
  const dependencies: MusicPricingActivationDependencies = {
    async transaction() {
      throw new Prisma.PrismaClientKnownRequestError(
        "Transaction failed due to a write conflict.",
        { code: "P2034", clientVersion: "7.9.1" },
      );
    },
  };

  await assert.rejects(
    createAndActivateMusicPricingVersion({
      actorAdminId: adminId,
      expectedRevision: 1,
      pricing: { currency: "EUR", basePrice: "25", coverPrice: "10", priorityPrice: "30" },
    }, dependencies),
    (error: unknown) => error instanceof MusicPricingServiceError && error.code === "REVISION_CONFLICT",
  );
});

test("a driver-adapter serialization conflict is exposed without relying on instanceof", async () => {
  await assert.rejects(
    createAndActivateMusicPricingVersion(
      {
        expectedRevision: 1,
        actorAdminId: adminId,
        pricing: {
          basePrice: "25,00",
          coverPrice: "10,00",
          priorityPrice: "30,00",
          currency: "EUR",
        },
      },
      {
        transaction: async () => {
          throw Object.assign(new Error("serialization failure"), { code: "P2034" });
        },
      },
    ),
    (error: unknown) => error instanceof MusicPricingServiceError
      && error.code === "REVISION_CONFLICT",
  );
});

test("the adapter-pg concurrent transaction startup error is exposed as a revision conflict", async () => {
  await assert.rejects(
    createAndActivateMusicPricingVersion(
      {
        expectedRevision: 1,
        actorAdminId: adminId,
        pricing: {
          basePrice: "25,00",
          coverPrice: "10,00",
          priorityPrice: "30,00",
          currency: "EUR",
        },
      },
      {
        transaction: async () => {
          throw Object.assign(new Error("driver adapter transaction state"), {
            code: "P2039",
            meta: {
              driverAdapterError: {
                name: "DriverAdapterError",
                cause: {
                  kind: "postgres",
                  originalCode: "25001",
                  originalMessage: "SET TRANSACTION ISOLATION LEVEL must be called before any query",
                },
              },
            },
          });
        },
      },
    ),
    (error: unknown) => error instanceof MusicPricingServiceError
      && error.code === "REVISION_CONFLICT",
  );
});
