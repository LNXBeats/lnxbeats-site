import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { adminMemberIdentity } from "@/lib/admin/member-identity";

test("Admin prefers the first and last names actually recorded, without rewriting them", () => {
  const source = { firstName: "  Élodie ", lastName: " De  La Tour ", displayName: "Membre LNX" };
  assert.deepEqual(adminMemberIdentity(source), { label: "Élodie De La Tour", initial: "É" });
  assert.equal(source.lastName, " De  La Tour ");
  assert.deepEqual(adminMemberIdentity({ firstName: "Alex", lastName: null }), { label: "Alex", initial: "A" });
});

test("legacy genuine display names remain visible but generic membership placeholders are not personal names", () => {
  assert.deepEqual(adminMemberIdentity({ displayName: "Dadou" }), { label: "Dadou", initial: "D" });
  for (const displayName of ["Membre LNX", "Membre", "member", "MemberLNX", " Membre   LNX ", "MEMBRE-LNX", "lnx_member", "", null]) {
    assert.deepEqual(adminMemberIdentity({ displayName }), { label: "Nom à compléter", initial: "?" });
  }
});

test("missing names never use the email local part as an invented identity", () => {
  const account = { firstName: null, lastName: null, displayName: "Membre LNX", email: "jean.dupont@example.test" };
  assert.deepEqual(adminMemberIdentity(account), { label: "Nom à compléter", initial: "?" });
});

test("Admin projects and searches identity fields while retaining the role label and protected route", async () => {
  const service = await readFile("lib/admin/service.ts", "utf8");
  const memberQuery = service.slice(service.indexOf("export async function listAdminMembers("), service.indexOf("export async function getDatabaseCatalogueAudit("));
  assert.match(memberQuery, /firstName: true/);
  assert.match(memberQuery, /lastName: true/);
  assert.match(memberQuery, /firstName: \{ contains: search, mode: "insensitive" \}/);
  assert.match(memberQuery, /lastName: \{ contains: search, mode: "insensitive" \}/);
  assert.doesNotMatch(memberQuery, /\.update|\.create|\.delete/);
  const page = await readFile("app/admin/membres/page.tsx", "utf8");
  assert.match(page, /await requireAdmin\(\)/);
  assert.match(page, /adminMemberIdentity\(member\)/);
  assert.match(page, /MEMBER: "Membre"/);
  assert.match(page, /\{identity.label\}/);
});
