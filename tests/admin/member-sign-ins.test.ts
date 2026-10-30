import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { requireMemberSignInAdmin } from "@/lib/admin/member-sign-in-policy";
import { listAdminMembersWithSignIns } from "@/lib/admin/member-sign-ins";

test("member connection dates are private to an active ADMIN", async () => {
  let reads = 0;
  const db = { async members() { reads++; return []; }, async signIns() { reads++; return []; } };
  for (const actor of [null, undefined, { role: "MEMBER", status: "ACTIVE" }, { role: "CUSTOMER", status: "ACTIVE" }, { role: "ADMIN", status: "SUSPENDED" }]) {
    assert.throws(() => requireMemberSignInAdmin(actor), /ADMIN_REQUIRED/);
    await assert.rejects(() => listAdminMembersWithSignIns(actor, "", db), /ADMIN_REQUIRED/);
  }
  assert.equal(reads, 0);
  assert.deepEqual(await listAdminMembersWithSignIns({ role: "ADMIN", status: "ACTIVE" }, "", db), []);
  assert.equal(reads, 1);
});

test("member projection never exposes session tokens, IPs, user agents or the session collection", async () => {
  const at = new Date("2026-10-22T16:30:00Z");
  const member = { id: "member", displayName: "Synthetic", firstName: null, lastName: null, email: "synthetic@example.test", role: "MEMBER" as const, status: "ACTIVE" as const, emailVerified: true, createdAt: at, _count: { orders: 0, shopOrders: 0 } };
  const db = { async members() { return [member]; }, async signIns(ids: string[]) { assert.deepEqual(ids, ["member"]); return [{ id: "member", lastSignedInAt: null, sessions: [{ createdAt: at }] }]; } };
  const result = await listAdminMembersWithSignIns({ role: "ADMIN", status: "ACTIVE" }, "", db);
  assert.equal(result[0].lastSignIn.source, "RETAINED_SESSION");
  assert.deepEqual(Object.keys(result[0]).sort(), [...Object.keys(member), "lastSignIn"].sort());
  for (const name of ["sessions", "token", "ipAddress", "userAgent", "password"]) assert.equal(Object.hasOwn(result[0], name), false);
});

test("Admin page keeps its route guard and displays labelled Paris authentication evidence", async () => {
  const source = await readFile(new URL("../../app/admin/membres/page.tsx", import.meta.url), "utf8");
  assert.match(source, /const session = await requireAdmin\(\)/);
  assert.match(source, /listAdminMembersWithSignIns\(session\.user, query\)/);
  assert.match(source, /Dernière session conservée/);
  assert.match(source, /<time dateTime=/);
  const service = await readFile(new URL("../../lib/admin/member-sign-ins.ts", import.meta.url), "utf8");
  assert.ok(service.indexOf("requireMemberSignInAdmin(actor)") < service.indexOf("const members = await db.members(query)"));
  assert.match(service, /take: 1, select: \{ createdAt: true \}/);
  assert.equal(service.includes("updatedAt"), false);
  assert.equal(service.includes("ipAddress"), false);
  assert.equal(service.includes("userAgent"), false);
});
