import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  countRightsAdminViews,
  parseRightsAdminView,
  rightsRequestMatchesAdminView,
} from "@/lib/rights/admin-views";

test("rights Admin views reflect workflow responsibility rather than opened/unread state", () => {
  assert.equal(rightsRequestMatchesAdminView({ status: "SUBMITTED", archived: false }, "attention"), true);
  assert.equal(rightsRequestMatchesAdminView({ status: "CLIENT_ACCEPTED", archived: false }, "attention"), true);
  assert.equal(rightsRequestMatchesAdminView({ status: "INFORMATION_REQUIRED", archived: false }, "waiting-client"), true);
  assert.equal(rightsRequestMatchesAdminView({ status: "UNDER_REVIEW", archived: false }, "active"), true);
  assert.equal(rightsRequestMatchesAdminView({ status: "READY_FOR_PAYMENT", archived: false }, "payment-closed"), true);
  assert.equal(rightsRequestMatchesAdminView({ status: "CANCELLED", archived: false }, "completed"), true);
  assert.equal(rightsRequestMatchesAdminView({ status: "ACTIVE", archived: false }, "completed"), false);
});

test("archived rights requests leave every daily view and remain explicitly retrievable", () => {
  const archived = { status: "SUBMITTED" as const, archived: true };
  assert.equal(rightsRequestMatchesAdminView(archived, "attention"), false);
  assert.equal(rightsRequestMatchesAdminView(archived, "all"), false);
  assert.equal(rightsRequestMatchesAdminView(archived, "archives"), true);

  const counts = countRightsAdminViews([
    { id: "open", status: "SUBMITTED" },
    { id: "archived", status: "CANCELLED" },
  ], new Set(["archived"]));
  assert.deepEqual({ attention: counts.attention, completed: counts.completed, archives: counts.archives, all: counts.all }, {
    attention: 1,
    completed: 0,
    archives: 1,
    all: 1,
  });
});

test("unknown rights Admin views fail closed to the actionable default", () => {
  assert.equal(parseRightsAdminView(undefined), "attention");
  assert.equal(parseRightsAdminView("paid"), "attention");
  assert.equal(parseRightsAdminView("archives"), "archives");
});

test("rights Admin page labels payment readiness truthfully and queries the archive overlay", async () => {
  const [page, workflow, views] = await Promise.all([
    readFile("app/admin/droits/page.tsx", "utf8"),
    readFile("lib/rights/workflow.ts", "utf8"),
    readFile("lib/rights/admin-views.ts", "utf8"),
  ]);
  assert.match(views, /Prêtes \/ paiement fermé/);
  assert.match(page, /ne sont pas des paiements confirmés/);
  assert.match(page, /listAdminRightsArchiveIds/);
  assert.match(workflow, /recordType: "RIGHTS_REQUEST"/);
  assert.doesNotMatch(workflow.slice(workflow.indexOf("export async function listAdminRightsCases")), /owner: \{ select: \{ displayName: true, email: true \} \}/);
});
