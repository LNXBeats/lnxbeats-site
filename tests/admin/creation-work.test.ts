import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { CREATION_WORK_STATUSES, DEADLINE_NOTE_PREFIX, VISIBILITY_NOTE_PREFIX, deadlineGauge, isWorkHidden, parisDateTime, parseParisDeadline, parseWorkNote } from "@/lib/admin/creation-work-policy";

const requestId = "f274b292-5186-4623-b3cd-1a88a7046e58";
const start = "2026-10-01T10:00:00.000Z", due = "2026-10-11T10:00:00.000Z";

test("creation queue includes active production stages but not payment waiting or terminal finance reviews", () => {
  for (const status of ["ACCEPTED", "IN_PROGRESS", "FINALIZING", "REVISION_REQUESTED", "FIRST_VERSION_READY"] as const) assert.ok(CREATION_WORK_STATUSES.includes(status));
  for (const status of ["REFUSED", "REFUNDED", "CANCELLED", "DELIVERED", "REFUND_PENDING", "DRAFT", "AWAITING_PAYMENT"] as const) assert.ok(!CREATION_WORK_STATUSES.includes(status));
});
test("deadline colors progress from green through yellow/orange to red, overdue remains full", () => {
  const at = (day: number) => deadlineGauge(start, due, Date.parse(start) + day * 86_400_000);
  assert.deepEqual([at(1).tone, at(5).tone, at(8).tone, at(9.5).tone, at(11).tone], ["comfortable", "watch", "urgent", "critical", "overdue"]);
  assert.equal(at(1).percent, 10); assert.equal(at(11).percent, 100); assert.equal(at(-1).percent, 0);
  assert.match(at(11).label, /En retard/);
});
test("missing, invalid or contradictory deadlines never fabricate time remaining", () => {
  assert.equal(deadlineGauge(start, null, Date.now()).tone, "unplanned");
  assert.equal(deadlineGauge(start, start, Date.now()).tone, "unplanned");
  assert.equal(deadlineGauge("invalid", due, Date.now()).tone, "unplanned");
});
test("Paris deadline parsing is independent of host timezone, precise across DST and rejects ambiguous/nonexistent times", () => {
  assert.equal(parseParisDeadline("2026-10-18T17:30")?.toISOString(), "2026-10-18T15:30:00.000Z");
  assert.equal(parseParisDeadline("2026-11-18T17:30")?.toISOString(), "2026-11-18T16:30:00.000Z");
  assert.equal(parisDateTime(new Date("2026-10-18T15:30:00Z")), "2026-10-18T17:30");
  for (const value of ["2026-03-29T02:30", "2026-10-25T02:30", "2026-02-30T12:00", "2026-10-18T25:00", "invalid", null]) assert.equal(parseParisDeadline(value), null, String(value));
});
test("versioned audit notes reject malformed data, other prefixes and reversed dates", () => {
  const value = { orderId: "order", requestId, startedAt: start, dueAt: due };
  assert.deepEqual(parseWorkNote(DEADLINE_NOTE_PREFIX + JSON.stringify(value), "DEADLINE"), value);
  for (const note of [null, "arbitrary note", DEADLINE_NOTE_PREFIX + "{", DEADLINE_NOTE_PREFIX + JSON.stringify({ ...value, dueAt: start }), DEADLINE_NOTE_PREFIX + JSON.stringify({ ...value, requestId: "bad" })]) assert.equal(parseWorkNote(note, "DEADLINE"), null);
});
test("personal test mask is bound to one exact order snapshot and is reversible, never permanent", () => {
  const order = { id: "order", status: "IN_PROGRESS", updatedAt: new Date(start) };
  const note = { orderId: "order", requestId, status: order.status, updatedAt: start, hidden: true, reason: "OWNER_CONFIRMED_TEST" as const };
  assert.equal(isWorkHidden(parseWorkNote(VISIBILITY_NOTE_PREFIX + JSON.stringify(note), "VISIBILITY"), order), true);
  assert.equal(isWorkHidden({ ...note, hidden: false }, order), false);
  assert.equal(isWorkHidden(note, { ...order, id: "another" }), false);
  assert.equal(isWorkHidden(note, { ...order, status: "FINALIZING" }), false);
  assert.equal(isWorkHidden(note, { ...order, updatedAt: new Date(due) }), false);
});
test("scope: Admin-only, same-origin, append-only internal history, shared lock, no payment/catalogue mutation", async () => {
  const service = await readFile(new URL("../../lib/admin/creation-work.ts", import.meta.url), "utf8");
  const actions = await readFile(new URL("../../app/admin/creation-work-actions.ts", import.meta.url), "utf8");
  const ui = await readFile(new URL("../../components/admin-creation-work-center.tsx", import.meta.url), "utf8");
  assert.match(service, /role: "ADMIN", status: "ACTIVE"/);
  assert.match(service, /pg_advisory_xact_lock/);
  assert.match(service, /payments:order:/);
  assert.match(service, /order\.updatedAt\.toISOString\(\) !== input\.expectedUpdatedAt/);
  assert.match(service, /previous\?\.id \?\? ""\) !== input\.expectedRevision/);
  assert.match(service, /orderEvent\.create/);
  assert.match(service, /previous\?\.createdAt\.getTime\(\) \?\? 0\) \+ 1/);
  assert.match(service, /visibility: "INTERNAL"/);
  assert.doesNotMatch(service, /\.(?:delete|deleteMany|update|updateMany|upsert)\(/);
  assert.doesNotMatch(service, /(?:payment|refund|digitalOffer|digitalEntitlement)\.(?:create|update|delete)/);
  assert.match(actions, /isSameOriginMutation/); assert.match(actions, /requireAdmin/);
  assert.match(ui, /<AdminOrderActions/); assert.match(ui, /filter\(\(\{ sensitive \}\) => !sensitive\)/);
  assert.match(ui, /role="meter"/); assert.match(ui, /aria-valuetext/);
  assert.match(ui, /setInterval\(tick, 60_000\)/);
  assert.doesNotMatch(service, /LNX-2026-0000|54233ec6|04a293f8/);
});
