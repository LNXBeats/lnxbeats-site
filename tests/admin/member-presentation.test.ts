import assert from "node:assert/strict";
import test from "node:test";

import { formatMemberLastLogin } from "@/lib/admin/member-presentation";

test("member login timestamps use Paris summer time and a 24-hour clock", () => {
  assert.equal(formatMemberLastLogin(new Date("2026-10-22T05:53:00.000Z")), "22/10/2026 à 07:53");
});

test("member login timestamps follow the Paris daylight saving transition", () => {
  assert.equal(formatMemberLastLogin(new Date("2026-10-25T00:59:00.000Z")), "25/10/2026 à 02:59");
  assert.equal(formatMemberLastLogin(new Date("2026-10-25T02:00:00.000Z")), "25/10/2026 à 03:00");
  assert.equal(formatMemberLastLogin(new Date("2026-12-01T06:05:00.000Z")), "01/12/2026 à 07:05");
});

test("member login timestamps show the local date when Paris crosses midnight", () => {
  assert.equal(formatMemberLastLogin(new Date("2026-10-21T22:05:00.000Z")), "22/10/2026 à 00:05");
});

test("missing history does not invent a login date", () => {
  assert.equal(formatMemberLastLogin(null), null);
  assert.equal(formatMemberLastLogin(new Date("invalid")), null);
});
