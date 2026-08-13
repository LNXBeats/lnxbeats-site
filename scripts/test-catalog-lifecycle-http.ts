import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { createInternalAuthUser } from "@/lib/auth/internal-user";
import { prisma } from "@/lib/prisma";
import { assertApprovedCatalogDatabase } from "@/scripts/catalog-guard";

const ADMIN_EMAIL = "lnx-v06301-lifecycle-admin@example.invalid";
const MEMBER_EMAIL = "lnx-v06301-lifecycle-member@example.invalid";
const QA_SLUG = "qa-catalogue-action-v06301";
const QA_TARGET = "lnx-studio-v0603-test";

async function validateEnvironment() {
  const { target } = await assertApprovedCatalogDatabase();
  assert.equal(target, QA_TARGET);
  assert.ok(process.env.DATABASE_URL);

  const databaseUrl = new URL(process.env.DATABASE_URL);
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(databaseUrl.hostname));
  assert.ok(databaseUrl.port && databaseUrl.port !== "5432");

  const proofPath = process.env.LNX_PRISMA_DEV_SERVER_FILE;
  assert.ok(proofPath, "The isolated Prisma runtime proof is required.");
  const proof = JSON.parse(await readFile(proofPath, "utf8")) as {
    name?: string;
    exports?: { database?: { connectionString?: string } };
  };
  assert.equal(proof.name, target);
  assert.equal(proof.exports?.database?.connectionString, process.env.DATABASE_URL);

  const baseUrl = new URL(process.env.AUTH_URL ?? "");
  assert.equal(baseUrl.protocol, "http:");
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(baseUrl.hostname));
  assert.notEqual(baseUrl.port, "3000", "HTTP QA must not use the personal preview origin.");
  assert.ok(process.env.LNX_AUTH_QA_PASSWORD && process.env.LNX_AUTH_QA_PASSWORD.length >= 12);
  return baseUrl.origin;
}

async function cleanup() {
  await prisma.$transaction(async (transaction) => {
    await transaction.project.deleteMany({ where: { slug: QA_SLUG } });
    const emails = [ADMIN_EMAIL, MEMBER_EMAIL];
    await transaction.session.deleteMany({ where: { user: { email: { in: emails } } } });
    await transaction.account.deleteMany({ where: { user: { email: { in: emails } } } });
    await transaction.user.deleteMany({ where: { email: { in: emails } } });
  });
}

function sessionCookie(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const values = headers.getSetCookie?.() ?? [headers.get("set-cookie") ?? ""];
  const raw = values.find((value) => /^(?:__Secure-)?lnx-studio\.session_token=/.test(value));
  assert.ok(raw, "The real sign-in endpoint must issue the session cookie.");
  return raw.split(";", 1)[0];
}

async function login(baseUrl: string, email: string, password: string) {
  const response = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify({ email, password, rememberMe: true }),
  });
  assert.equal(response.status, 200);
  return sessionCookie(response);
}

async function createActionField(baseUrl: string, adminCookie: string) {
  const response = await fetch(`${baseUrl}/admin/catalogue/nouveau`, {
    redirect: "manual",
    headers: { cookie: adminCookie, accept: "text/html" },
  });
  assert.equal(response.status, 200, "The authenticated Admin creation page must render.");
  const html = await response.text();
  const forms = html.match(/<form\b[\s\S]*?<\/form>/gi) ?? [];
  const createForm = forms.find((form) => /name=["']title["']/.test(form) && /name=["']slug["']/.test(form));
  assert.ok(createForm, "The real catalogue creation form must be present in the Admin HTML.");
  const field = createForm.match(/name=["'](\$ACTION_ID_[A-Za-z0-9_-]+)["']/)?.[1];
  assert.ok(field, "The real catalogue creation Server Action identifier must be present in its form.");
  return field;
}

function creationForm(actionField: string) {
  const body = new FormData();
  body.set(actionField, "");
  body.set("slug", QA_SLUG);
  body.set("title", "QA Catalogue Action V06301");
  body.set("subtitle", "");
  body.set("type", "project");
  body.set("status", "draft");
  body.set("releaseDate", "");
  body.set("jukeboxPlacement", "none");
  body.set("jukeboxPosition", "");
  body.set("catalogPosition", "");
  body.set("shortDescription", "");
  body.set("description", "");
  return body;
}

async function submitCreation(baseUrl: string, actionField: string, cookie?: string, origin = baseUrl) {
  return fetch(`${baseUrl}/admin/catalogue/nouveau`, {
    method: "POST",
    redirect: "manual",
    headers: {
      origin,
      referer: `${baseUrl}/admin/catalogue/nouveau`,
      accept: "text/html",
      ...(cookie ? { cookie } : {}),
    },
    body: creationForm(actionField),
  });
}

async function assertProjectAbsent(context: string) {
  assert.equal(await prisma.project.count({ where: { slug: QA_SLUG } }), 0, context);
}

async function run() {
  const baseUrl = await validateEnvironment();
  const password = process.env.LNX_AUTH_QA_PASSWORD!;
  await cleanup();
  await createInternalAuthUser({ email: ADMIN_EMAIL, password, displayName: "Catalogue Lifecycle Admin QA", role: "ADMIN" });
  await createInternalAuthUser({ email: MEMBER_EMAIL, password, displayName: "Catalogue Lifecycle Member QA", role: "MEMBER" });

  try {
    const adminCookie = await login(baseUrl, ADMIN_EMAIL, password);
    const memberCookie = await login(baseUrl, MEMBER_EMAIL, password);
    const actionField = await createActionField(baseUrl, adminCookie);

    const visitor = await submitCreation(baseUrl, actionField);
    assert.equal(visitor.status, 303, "A visitor must be refused by the real creation Server Action.");
    assert.match(visitor.headers.get("location") ?? "", /\/connexion\?retour=/);
    await assertProjectAbsent("A visitor must not create a project.");

    const member = await submitCreation(baseUrl, actionField, memberCookie);
    assert.equal(member.status, 303, "A MEMBER must be refused by requireAdmin().");
    assert.match(member.headers.get("location") ?? "", /\/compte\?acces=refuse/);
    await assertProjectAbsent("A MEMBER must not create a project.");

    const crossOrigin = await submitCreation(baseUrl, actionField, adminCookie, "https://attacker.invalid");
    assert.ok(crossOrigin.status >= 400, "A cross-origin Admin mutation must be refused.");
    await assertProjectAbsent("A cross-origin Admin request must not create a project.");

    const admin = await submitCreation(baseUrl, actionField, adminCookie);
    assert.equal(admin.status, 303, "An Admin must create through the real Server Action.");
    assert.match(admin.headers.get("location") ?? "", new RegExp(`/admin/catalogue/${QA_SLUG}\\?etat=projet-cree`));

    const created = await prisma.project.findUniqueOrThrow({
      where: { slug: QA_SLUG },
      include: { tracks: true, assets: true },
    });
    assert.equal(created.status, "DRAFT");
    assert.equal(created.publicVisible, false);
    assert.equal(created.featured, false);
    assert.equal(created.jukeboxPlacement, null);
    assert.equal(created.tracks.length, 0);
    assert.equal(created.assets.length, 0);

    await prisma.project.delete({ where: { id: created.id } });
    await assertProjectAbsent("The Admin HTTP fixture must be removed after the successful assertion.");
    console.info("Catalogue lifecycle HTTP passed: real Server Action refused visitor, MEMBER and cross-origin requests, allowed ADMIN, then left no project behind.");
  } finally {
    await cleanup();
  }
}

run()
  .finally(() => prisma.$disconnect())
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack ?? error.message : "Catalogue lifecycle HTTP QA failed.");
    process.exitCode = 1;
  });
