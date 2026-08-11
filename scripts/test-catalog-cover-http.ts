import assert from "node:assert/strict";
import { randomFillSync } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, extname } from "node:path";

import sharp from "sharp";

import { createInternalAuthUser } from "@/lib/auth/internal-user";
import { readCatalogCover, removeCatalogCover } from "@/lib/catalog/media-storage";
import { prisma } from "@/lib/prisma";

const ADMIN_EMAIL = "lnx-v0603-cover-admin@example.invalid";
const MEMBER_EMAIL = "lnx-v0603-cover-member@example.invalid";
const QA_TARGET = "lnx-studio-v0603-test";

function validateEnvironment() {
  assert.equal(process.env.LNX_DATABASE_TARGET, QA_TARGET);
  assert.ok(process.env.DATABASE_URL);
  const databaseUrl = new URL(process.env.DATABASE_URL);
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(databaseUrl.hostname));
  assert.ok(databaseUrl.port && databaseUrl.port !== "5432");

  const baseUrl = new URL(process.env.AUTH_URL ?? "");
  assert.equal(baseUrl.protocol, "http:");
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(baseUrl.hostname));
  assert.notEqual(baseUrl.port, "3000", "HTTP QA must not use the personal preview origin.");
  assert.ok(process.env.MEDIA_STORAGE_ROOT?.startsWith("/private/tmp/lnx-studio-v0603-cover-qa-"));
  assert.ok(process.env.LNX_AUTH_QA_PASSWORD && process.env.LNX_AUTH_QA_PASSWORD.length >= 12);
  return baseUrl.origin;
}

async function cleanupUsers() {
  await prisma.$transaction(async (transaction) => {
    const emails = [ADMIN_EMAIL, MEMBER_EMAIL];
    await transaction.rateLimit.deleteMany();
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

function uploadForm(project: { id: string; slug: string; updatedAt: Date }, file: File, alt?: string) {
  const body = new FormData();
  body.set("projectId", project.id);
  body.set("slug", project.slug);
  body.set("updatedAt", project.updatedAt.toISOString());
  if (alt !== undefined) body.set("alt", alt);
  body.set("rightsConfirmed", "on");
  body.set("cover", file);
  return body;
}

async function upload(baseUrl: string, body: FormData, cookie?: string, origin = baseUrl) {
  return fetch(`${baseUrl}/api/admin/catalogue/cover`, {
    method: "POST",
    redirect: "manual",
    headers: {
      origin,
      referer: `${baseUrl}/admin/catalogue/laboratoire-narratif`,
      ...(cookie ? { cookie } : {}),
    },
    body,
  });
}

async function largeRealJpeg() {
  const raw = Buffer.allocUnsafe(3_000 * 3_000 * 3);
  randomFillSync(raw);
  const jpeg = await sharp(raw, { raw: { width: 3_000, height: 3_000, channels: 3 } })
    .jpeg({ quality: 82, chromaSubsampling: "4:2:0" })
    .toBuffer();
  assert.ok(jpeg.length > 1024 * 1024, "The HTTP fixture must exceed the former 1 MB Server Action limit.");
  assert.ok(jpeg.length < 10 * 1024 * 1024, "The HTTP fixture must remain below the 10 MB business limit.");
  return jpeg;
}

async function optionalReferenceFixture() {
  const fixturePath = process.argv[2];
  if (!fixturePath) return null;
  const extension = extname(fixturePath).toLowerCase();
  const mimeType = extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : null;
  assert.ok(mimeType, "The optional reference fixture must be a JPEG, PNG or WebP file.");
  const bytes = await readFile(fixturePath);
  return new File([bytes], basename(fixturePath), { type: mimeType });
}

async function run() {
  const baseUrl = validateEnvironment();
  const password = process.env.LNX_AUTH_QA_PASSWORD!;
  await cleanupUsers();
  await createInternalAuthUser({ email: ADMIN_EMAIL, password, displayName: "Cover Admin QA", role: "ADMIN" });
  await createInternalAuthUser({ email: MEMBER_EMAIL, password, displayName: "Cover Member QA", role: "MEMBER" });

  let storedKey: string | null = null;
  try {
    const adminCookie = await login(baseUrl, ADMIN_EMAIL, password);
    const memberCookie = await login(baseUrl, MEMBER_EMAIL, password);
    const project = await prisma.project.findUniqueOrThrow({ where: { slug: "laboratoire-narratif" } });
    const smallJpeg = await sharp({ create: { width: 32, height: 32, channels: 3, background: "#2c2219" } }).jpeg().toBuffer();
    const smallFile = new File([smallJpeg], "small.jpg", { type: "image/jpeg" });

    const visitor = await upload(baseUrl, uploadForm(project, smallFile));
    assert.equal(visitor.status, 303, "A visitor must be refused before multipart parsing.");
    assert.match(visitor.headers.get("location") ?? "", /\/connexion\?retour=/);
    const member = await upload(baseUrl, uploadForm(project, smallFile), memberCookie);
    assert.equal(member.status, 303, "A MEMBER must be refused by requireAdmin().");
    assert.match(member.headers.get("location") ?? "", /\/compte\?acces=refuse/);
    assert.equal((await upload(baseUrl, uploadForm(project, smallFile), adminCookie, "https://attacker.invalid")).status, 403, "A cross-origin ADMIN request must be refused.");

    const jpeg = await largeRealJpeg();
    const response = await upload(baseUrl, uploadForm(project, new File([jpeg], "cover-3000.jpg", { type: "image/jpeg" })), adminCookie);
    assert.equal(response.status, 303);
    assert.match(response.headers.get("location") ?? "", /etat=cover-enregistree/);

    const referenceFixture = await optionalReferenceFixture();
    if (referenceFixture) {
      const afterGeneric = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
      const referenceResponse = await upload(baseUrl, uploadForm(afterGeneric, referenceFixture), adminCookie);
      assert.equal(referenceResponse.status, 303);
      assert.match(referenceResponse.headers.get("location") ?? "", /etat=cover-enregistree/);
    }

    const asset = await prisma.asset.findFirstOrThrow({ where: { projects: { some: { projectId: project.id, role: "COVER" } } } });
    storedKey = asset.storageKey;
    assert.equal(asset.width, 1_600);
    assert.equal(asset.height, 1_600);
    assert.equal(asset.mimeType, "image/webp");
    assert.equal(asset.alt, null, "The automatic cover alt must not be stored as an override.");
    const stored = await readCatalogCover(asset.storageKey);
    const metadata = await sharp(stored).metadata();
    assert.equal(metadata.width, 1_600);
    assert.equal(metadata.height, 1_600);
    assert.equal(metadata.format, "webp");

    const refreshed = await prisma.project.findUniqueOrThrow({ where: { id: project.id } });
    const oversized = Buffer.alloc(10 * 1024 * 1024 + 1);
    oversized.set([0xff, 0xd8, 0xff]);
    const refused = await upload(baseUrl, uploadForm(refreshed, new File([oversized], "too-large.jpg", { type: "image/jpeg" })), adminCookie);
    assert.equal(refused.status, 303);
    assert.match(refused.headers.get("location") ?? "", /etat=cover-trop-lourde/);
    assert.equal(await prisma.asset.count({ where: { projects: { some: { projectId: project.id, role: "COVER" } } } }), 1);

    console.info(`PASS real HTTP/FormData 3000x3000 JPEG (${jpeg.length} bytes) exceeded 1 MB and was normalized to 1600x1600 WebP.`);
    if (referenceFixture) console.info(`PASS exact reference fixture ${referenceFixture.name} (${referenceFixture.size} bytes) passed the real HTTP Route Handler.`);
    console.info("PASS visitor, MEMBER, cross-origin and >10 MB requests were refused without replacing the active cover.");
  } finally {
    if (storedKey) {
      const asset = await prisma.asset.findFirst({ where: { storageKey: storedKey } });
      if (asset) {
        await prisma.$transaction(async (transaction) => {
          await transaction.projectAsset.deleteMany({ where: { assetId: asset.id } });
          await transaction.asset.delete({ where: { id: asset.id } });
        });
      }
      await removeCatalogCover(storedKey);
    }
    await cleanupUsers();
  }
}

run()
  .finally(() => prisma.$disconnect())
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Catalogue cover HTTP QA failed.");
    process.exitCode = 1;
  });
