import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { canReadOrderMedia } from "@/lib/media/authorization";

const member = { id: "owner", role: "MEMBER", status: "ACTIVE", emailVerified: true } as const;
const other = { ...member, id: "other" } as const;
const admin = { ...member, id: "admin", role: "ADMIN" } as const;

test("private contract ownership is fail-closed", () => {
  assert.equal(canReadOrderMedia(member, "owner"), true);
  assert.equal(canReadOrderMedia(other, "owner"), false);
  assert.equal(canReadOrderMedia(admin, "owner"), true);
  assert.equal(canReadOrderMedia({ ...member, emailVerified: false }, "owner"), false);
  assert.equal(canReadOrderMedia({ ...member, status: "SUSPENDED" }, "owner"), false);
});

test("the contract route exposes authenticated GET and HEAD with no public URL", async () => {
  const route = await readFile("app/api/rights/documents/[documentId]/route.ts", "utf8");
  assert.match(route, /orderActorFromHeaders/);
  assert.match(route, /getContractDocumentForActor/);
  assert.match(route, /orderDeliveryResponse/);
  assert.match(route, /recordContractDocumentViewed/);
  assert.match(route, /response\.status === 200/);
  assert.match(route, /!request\.headers\.has\("range"\)/);
  assert.match(route, /export function GET/);
  assert.match(route, /export function HEAD/);
  assert.doesNotMatch(route, /presign|signedUrl|NEXT_PUBLIC/);
});

test("rights mutations require same-origin authentication before parsing or writes", async () => {
  const [createRoute, lifecycleRoute] = await Promise.all([
    readFile("app/api/orders/[orderNumber]/rights/route.ts", "utf8"),
    readFile("app/api/rights/[requestNumber]/route.ts", "utf8"),
  ]);
  assert.ok(createRoute.indexOf("isAllowed(request)") < createRoute.indexOf("actor(request.headers)"));
  assert.ok(createRoute.indexOf("actor(request.headers)") < createRoute.indexOf("readRightsJson(request)"));
  assert.ok(lifecycleRoute.indexOf("isAllowed(request)") < lifecycleRoute.indexOf("actor(request.headers)"));
  assert.match(createRoute, /enforceOrderRateLimit/);
  assert.match(lifecycleRoute, /enforceOrderRateLimit/);
});

test("database gates make legal approval and activation non-bypassable", async () => {
  const migration = await readFile("prisma/migrations/20260820071034_rights_contracts/migration.sql", "utf8");
  assert.match(migration, /LEGAL_REVIEW_REQUIRED/);
  assert.match(migration, /ADMIN_APPROVAL_REQUIRED/);
  assert.match(migration, /RIGHTS_ACTIVATION_NOT_IMPLEMENTED/);
  assert.match(migration, /ACCEPTED_DOCUMENT_IMMUTABLE/);
  assert.match(migration, /ACCEPTANCE_RECEIPT/);
  assert.match(migration, /rights_requests_one_active_type_per_order/);
  assert.match(migration, /ON DELETE RESTRICT/g);
});

test("rights application code has no Stripe or rights payment creation path", async () => {
  const sources = await Promise.all([
    readFile("lib/rights/service.ts", "utf8"),
    readFile("lib/rights/workflow.ts", "utf8"),
    readFile("app/api/orders/[orderNumber]/rights/route.ts", "utf8"),
  ]);
  const joined = sources.join("\n");
  assert.doesNotMatch(joined, /from ["']stripe["']/);
  assert.doesNotMatch(joined, /\.payment\.(?:create|upsert|update)/);
  assert.doesNotMatch(joined, /checkout\.sessions|PaymentIntent/);
});

test("contract objects use the private order-document key allowlist", async () => {
  const sources = await Promise.all([
    readFile("lib/rights/service.ts", "utf8"),
    readFile("lib/rights/workflow.ts", "utf8"),
  ]);
  const joined = sources.join("\n");
  assert.doesNotMatch(joined, /`contracts\//);
  assert.match(joined, /`orders\/\$\{request\.orderId\}\/documents\/\$\{randomUUID\(\)\}\.pdf`/);
  assert.match(joined, /`orders\/\$\{candidate\.orderId\}\/documents\/\$\{randomUUID\(\)\}\.pdf`/);
});

test("new personal-use evidence is nullable for non-retroactivity but atomic when present", async () => {
  const migration = await readFile("prisma/migrations/20260820071034_rights_contracts/migration.sql", "utf8");
  assert.match(migration, /orders_personal_use_terms_complete/);
  assert.match(migration, /personalUseTermsVersion.*IS NULL/s);
  assert.match(migration, /personalUseTermsHashSha256.*IS NOT NULL/s);
});
