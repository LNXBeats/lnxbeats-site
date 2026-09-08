import assert from "node:assert/strict";
import test from "node:test";

import { licenseExpiresAt, withdrawalEndsAt } from "@/lib/rights/license-calendar";

test("the withdrawal period is fourteen Paris calendar days across spring DST", () => {
  const paidAt = new Date("2027-03-20T11:30:00.000Z"); // 12:30 Europe/Paris
  assert.equal(withdrawalEndsAt(paidAt).toISOString(), "2027-04-03T10:30:00.000Z"); // still 12:30 after DST
});

test("the withdrawal period preserves local wall-clock time across autumn DST", () => {
  const paidAt = new Date("2027-10-20T10:30:00.000Z"); // 12:30 Europe/Paris
  assert.equal(withdrawalEndsAt(paidAt).toISOString(), "2027-11-03T11:30:00.000Z"); // still 12:30 after DST
});

test("five calendar years preserve the Paris date and clamp leap day", () => {
  const effectiveAt = new Date("2028-02-29T11:00:00.000Z"); // 12:00 Europe/Paris
  assert.equal(licenseExpiresAt(effectiveAt).toISOString(), "2033-02-28T11:00:00.000Z");
});
