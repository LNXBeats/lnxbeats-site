import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrderActor } from "@/lib/orders/domain";
import { assertDigitalLiveNewSale, digitalSalesControl, setDigitalSalesControl, DIGITAL_SALES_CONTROL_EVENT } from "@/lib/digital/sales-control";

function fixture() {
  const actor: OrderActor = { id: randomUUID(), role: "ADMIN", status: "ACTIVE", emailVerified: true, email: "synthetic@example.invalid", name: "Synthetic Admin" };
  const reviewer = { role: "ADMIN", status: "ACTIVE", emailVerified: true };
  const events: Array<{ id: string; actorId: string; kind: string; externalKey: string; createdAt: Date; details: { policy: string; mode: string; enabled: boolean; previousEventId: string | null } }> = [];
  const locks: string[] = [];
  const db = { user: { async findUnique() { return reviewer; } },
    $queryRaw: async (strings: TemplateStringsArray) => { locks.push(strings.join("?")); return []; },
    digitalEvent: {
      async findFirst({ where }: { where: { kind: string; details: { equals: string } } }) {
        assert.equal(where.kind, DIGITAL_SALES_CONTROL_EVENT);
        return events.filter(event => event.details.mode === where.details.equals).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0] ?? null;
      },
      async findUnique({ where }: { where: { externalKey: string } }) { return events.find(event => event.externalKey === where.externalKey) ?? null; },
      async create({ data }: { data: Omit<(typeof events)[number], "id"> }) { const event = { ...data, id: randomUUID() }; events.push(event); return event; },
    },
  } as unknown as Prisma.TransactionClient;
  return { actor, reviewer, events, locks, db };
}
async function isolated(f: ReturnType<typeof fixture>, run: () => Promise<void>) {
  const env = { DCN_ENABLED: "true", DCN_MODE: "LIVE", NODE_ENV: "production", RAILWAY_ENVIRONMENT_NAME: "production",
    MEDIA_DEPLOYMENT_ENV: "production", PAYMENT_DEPLOYMENT_ENV: "production", DCN_STORAGE_MODE: "OBJECT",
    PAYMENT_PRODUCTION_CONFIRM: "payments-production-live-approved", DCN_NEW_PAYMENTS_ENABLED: "true", PAYMENTS_ENABLED: "true" };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]])), transaction = prisma.$transaction;
  Object.assign(process.env, env);
  prisma.$transaction = (async (callback: (db: Prisma.TransactionClient) => Promise<unknown>) => callback(f.db)) as typeof transaction;
  try { await run(); } finally { prisma.$transaction = transaction; for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
}
test("new LIVE sales default to the explicit environment capability; TEST bypass remains unchanged", async () => {
  const f = fixture(); await isolated(f, async () => {
    assert.equal((await digitalSalesControl(f.db, "LIVE")).enabled, true);
    await assertDigitalLiveNewSale(f.db, "LIVE");
    process.env.DCN_NEW_PAYMENTS_ENABLED = "false";
    await assert.rejects(assertDigitalLiveNewSale(f.db, "LIVE"), { code: "NEW_DIGITAL_PAYMENTS_CLOSED" });
    const count = f.locks.length; await assertDigitalLiveNewSale(f.db, "TEST"); assert.equal(f.locks.length, count);
  });
});
test("fresh Admin pause/resume is append-only, serialized, idempotent and rejects stale reopening", async () => {
  const f = fixture(); await isolated(f, async () => {
    const request = { enabled: false, expectedEventId: null, idempotencyKey: randomUUID() };
    const paused = await setDigitalSalesControl(f.actor, request);
    assert.equal(paused.enabled, false); assert.equal(f.events.length, 1);
    await assert.rejects(assertDigitalLiveNewSale(f.db, "LIVE"), { code: "NEW_DIGITAL_PAYMENTS_CLOSED" });
    assert.deepEqual(await setDigitalSalesControl(f.actor, request), paused); assert.equal(f.events.length, 1);
    await assert.rejects(setDigitalSalesControl(f.actor, { ...request, enabled: true }), { code: "IDEMPOTENCY_CONFLICT" });
    await assert.rejects(setDigitalSalesControl(f.actor, { enabled: true, expectedEventId: null, idempotencyKey: randomUUID() }), { code: "STALE_SALES_CONTROL" });
    const resumed = await setDigitalSalesControl(f.actor, { enabled: true, expectedEventId: paused.eventId, idempotencyKey: randomUUID() });
    assert.equal(resumed.enabled, true); assert.equal(f.events.length, 2);
    assert.ok(f.events[1].createdAt > f.events[0].createdAt);
    await assertDigitalLiveNewSale(f.db, "LIVE");
    assert.ok(f.locks.some(lock => lock.includes("pg_advisory_xact_lock_shared")));
    assert.ok(f.locks.some(lock => lock.includes("pg_advisory_xact_lock(")));
  });
});
test("no client or stale/unverified Admin can record an instruction", async () => {
  const f = fixture(); await isolated(f, async () => {
    await assert.rejects(setDigitalSalesControl({ ...f.actor, role: "CUSTOMER" }, { enabled: false, expectedEventId: null, idempotencyKey: randomUUID() }), { code: "ADMIN_REQUIRED" });
    f.reviewer.status = "DISABLED";
    await assert.rejects(setDigitalSalesControl(f.actor, { enabled: false, expectedEventId: null, idempotencyKey: randomUUID() }), { code: "ADMIN_REQUIRED" });
    assert.equal(f.events.length, 0);
  });
});
test("invalid instruction provenance fails closed and a valid resume cannot override environment closure", async () => {
  const f = fixture(); await isolated(f, async () => {
    await setDigitalSalesControl(f.actor, { enabled: true, expectedEventId: null, idempotencyKey: randomUUID() });
    f.events[0].details.policy = "UNTRUSTED";
    assert.equal((await digitalSalesControl(f.db, "LIVE")).reviewRequired, true);
    await assert.rejects(assertDigitalLiveNewSale(f.db, "LIVE"), { code: "NEW_DIGITAL_PAYMENTS_CLOSED" });
    f.events[0].details.policy = "DCN_NEW_SALES_CONTROL_1";
    process.env.DCN_NEW_PAYMENTS_ENABLED = "false";
    await assert.rejects(assertDigitalLiveNewSale(f.db, "LIVE"), { code: "NEW_DIGITAL_PAYMENTS_CLOSED" });
    f.reviewer.role = "CUSTOMER";
    assert.equal((await digitalSalesControl(f.db, "LIVE")).enabled, false);
  });
});
