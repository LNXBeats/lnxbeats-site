import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import type { Prisma } from "@/generated/prisma/client";
import { emptyMemberCommerce, listAdminMemberCommerce, type MemberCommerce } from "@/lib/admin/member-commerce";

const admin = { role: "ADMIN", status: "ACTIVE" };
const member = "10000000-0000-4000-8000-000000000001";
const other = "10000000-0000-4000-8000-000000000002";

test("commerce counters authorize before reading and bound the member scope", async () => {
  let reads = 0;
  const db = { async read() { reads++; return []; } };
  for (const actor of [null, undefined, { role: "MEMBER", status: "ACTIVE" }, { role: "ADMIN", status: "SUSPENDED" }]) {
    await assert.rejects(() => listAdminMemberCommerce(actor, [member], db), /ADMIN_REQUIRED/);
  }
  assert.deepEqual(await listAdminMemberCommerce(admin, [], db), new Map());
  await assert.rejects(() => listAdminMemberCommerce(admin, ["not-an-id"], db), /INVALID_MEMBER_SCOPE/);
  await assert.rejects(() => listAdminMemberCommerce(admin, Array.from({ length: 201 }, (_, i) => `10000000-0000-4000-8000-${String(i).padStart(12, "0")}`), db), /INVALID_MEMBER_SCOPE/);
  assert.equal(reads, 0);
});

test("member commerce SQL counts synthetic payment evidence without writing or multiplying orders", async t => {
  const pg = new PGlite();
  let reads = 0;
  const db = { async read(query: Prisma.Sql) {
    reads++;
    assert.doesNotMatch(query.text, /\b(?:INSERT|UPDATE|DELETE|TRUNCATE|ALTER|CREATE|DROP)\b/i);
    assert.ok(!query.text.includes(member), "member ids are bound parameters");
    return (await pg.query<MemberCommerce & { userId: string }>(query.text, query.values)).rows;
  } };
  const counters = async (ids = [member]) => listAdminMemberCommerce(admin, ids, db);
  const digital = async (id: string, options: { user?: string; mode?: string; status?: string; attempt?: string; ref?: string | null; provider?: string; total?: number; scopes?: string[] } = {}) => {
    await pg.query(`INSERT INTO digital_orders VALUES ($1,$2,$3,$4,$5)`, [id, options.user ?? member, options.mode ?? "LIVE", options.status ?? "PAID", options.total ?? 129]);
    await pg.query(`INSERT INTO digital_payment_attempts VALUES ($1,$2,$3,$4)`, [id, options.provider ?? "STRIPE", options.attempt ?? "PAID", options.ref === undefined ? `payment-${id}` : options.ref]);
    for (const scope of options.scopes ?? ["TRACK"]) await pg.query(`INSERT INTO digital_order_lines VALUES ($1,$2)`, [id, scope]);
  };
  try {
    await pg.exec(`
      CREATE TABLE orders (id text PRIMARY KEY, "userId" uuid, status text, "submittedAt" timestamptz);
      CREATE TABLE payments ("orderId" text, mode text, "paidAt" timestamptz, "amountCents" integer, "providerPaymentId" text);
      CREATE TABLE digital_orders (id text PRIMARY KEY, "userId" uuid, mode text, status text, "totalCents" integer);
      CREATE TABLE digital_payment_attempts ("orderId" text, provider text, status text, "paymentReference" text);
      CREATE TABLE digital_order_lines ("orderId" text, scope text);
    `);

    await t.test("Dadou: cancelled unpaid checkout is zero purchases and one request, even with submittedAt", async () => {
      await pg.query(`INSERT INTO orders VALUES ('abandoned',$1,'CANCELLED','2026-08-26T10:00:00Z')`, [member]);
      assert.deepEqual((await counters()).get(member), { ...emptyMemberCommerce, musicUnpaidRequests: 1 });
    });

    await t.test("music drafts and awaiting payment stay separate; paid LIVE remains historical after refund", async () => {
      await pg.query(`INSERT INTO orders VALUES ('draft',$1,'DRAFT',NULL),('pending',$1,'AWAITING_PAYMENT',NOW()),('paid',$1,'REFUNDED',NOW()),('test',$1,'DELIVERED',NOW()),('no-proof',$1,'PAYMENT_CONFIRMED',NOW())`, [member]);
      await pg.exec(`INSERT INTO payments VALUES ('paid','LIVE',NOW(),2000,'capture-real'),('paid','LIVE',NOW(),2000,'capture-second'),('test','TEST',NOW(),2000,'test-payment'),('pending','LIVE',NULL,2000,'opened-checkout'),('no-proof','LIVE',NOW(),2000,NULL)`);
      const count = (await counters()).get(member)!;
      assert.equal(count.musicPaidOrders, 1);
      assert.equal(count.musicUnpaidRequests, 3);
    });

    await t.test("two albums in one purchase plus one single means two purchases, two albums and one title", async () => {
      await digital("albums", { total: 1980, scopes: ["ALBUM", "ALBUM"], provider: "PAYPAL" });
      await digital("single");
      // A failed retry never duplicates the successful order or its lines.
      await pg.exec(`INSERT INTO digital_payment_attempts VALUES ('albums','PAYPAL','FAILED',NULL),('albums','PAYPAL','OPEN',NULL)`);
      const count = (await counters()).get(member)!;
      assert.equal(count.digitalPaidOrders, 2);
      assert.equal(count.digitalAlbums, 2);
      assert.equal(count.digitalTracks, 1);
      assert.equal(count.digitalReviewOrders, 0);
    });

    await t.test("TEST, pending/failed attempts, missing references, free grants and status-only PAID do not prove purchases", async () => {
      await digital("test", { mode: "TEST" });
      await digital("pending", { status: "PENDING", attempt: "OPEN" });
      await digital("failed", { status: "FAILED", attempt: "FAILED" });
      await digital("no-reference", { ref: null });
      await digital("blank-reference", { ref: "   " });
      await digital("granted", { status: "GRANTED", total: 0 });
      await digital("unknown-provider", { provider: "MANUAL" });
      const count = (await counters()).get(member)!;
      assert.equal(count.digitalPaidOrders, 2);
      assert.equal(count.digitalAlbums, 2);
      assert.equal(count.digitalTracks, 1);
    });

    await t.test("refunds and disputes remain explicitly distinguished; duplicate paid attempts count one order under review", async () => {
      await digital("refunded", { status: "REFUNDED" });
      await digital("partial", { status: "PARTIALLY_REFUNDED" });
      await digital("disputed", { status: "DISPUTED" });
      await digital("review", { status: "REQUIRES_REVIEW" });
      await digital("duplicate");
      await pg.exec(`INSERT INTO digital_payment_attempts VALUES ('duplicate','STRIPE','PAID','second-reference')`);
      const count = (await counters()).get(member)!;
      assert.equal(count.digitalPaidOrders, 7);
      assert.equal(count.digitalRefundedOrders, 2);
      assert.equal(count.digitalReviewOrders, 3);
      assert.equal(count.digitalTracks, 6);
    });

    await t.test("batched results isolate members, deduplicate ids and contain counts only", async () => {
      await digital("other-member", { user: other, scopes: ["ALBUM"] });
      const before = reads;
      const result = await counters([member, other, member]);
      assert.equal(reads - before, 1);
      assert.equal(result.size, 2);
      assert.equal(result.get(member)!.digitalPaidOrders, 7);
      assert.deepEqual(result.get(other), { ...emptyMemberCommerce, digitalPaidOrders: 1, digitalAlbums: 1 });
      assert.deepEqual(Object.keys(result.get(member)!).sort(), Object.keys(emptyMemberCommerce).sort());
    });
  } finally { await pg.close(); }
});

test("member UI replaces raw musical-order count with explicit paid purchases and preserves sign-in display", async () => {
  const source = await readFile("app/admin/membres/page.tsx", "utf8");
  assert.match(source, /const session = await requireAdmin\(\)/);
  assert.match(source, /listAdminMemberCommerce\(session.user, members.map\(member => member.id\)\)/);
  assert.doesNotMatch(source, /member\._count\.orders/);
  assert.match(source, /Commandes musicales payées/);
  assert.match(source, /Demandes sans achat/);
  assert.match(source, /Achats audio payés/);
  assert.match(source, /200 maximum/);
  assert.match(source, /digitalRefundedOrders/);
  assert.match(source, /digitalReviewOrders/);
  assert.match(source, /Dernière session conservée/);
});
