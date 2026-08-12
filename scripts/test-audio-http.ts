import assert from "node:assert/strict";
import { access } from "node:fs/promises";

import { createInternalAuthUser } from "@/lib/auth/internal-user";
import { CATALOG_AUDIO_SOURCE_MAXIMUM_BYTES } from "@/lib/catalog/audio-request";
import { removeCatalogAudioPreview } from "@/lib/catalog/media-storage";
import { prisma } from "@/lib/prisma";
import { createAudioFixture } from "@/tests/audio/fixture";

const ADMIN_EMAIL = "lnx-v0604-audio-admin@example.invalid";
const MEMBER_EMAIL = "lnx-v0604-audio-member@example.invalid";
const QA_TARGET = "lnx-studio-v0604-test";

function validateEnvironment() {
  assert.equal(process.env.LNX_DATABASE_TARGET, QA_TARGET);
  assert.ok(process.env.DATABASE_URL);
  const databaseUrl = new URL(process.env.DATABASE_URL);
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(databaseUrl.hostname));
  assert.ok(databaseUrl.port && databaseUrl.port !== "5432");
  const baseUrl = new URL(process.env.AUTH_URL ?? "");
  assert.equal(baseUrl.protocol, "http:");
  assert.ok(["127.0.0.1", "localhost", "::1"].includes(baseUrl.hostname));
  assert.notEqual(baseUrl.port, "3000");
  assert.ok(process.env.MEDIA_STORAGE_ROOT?.startsWith("/private/tmp/lnx-studio-v0604-audio-qa-"));
  assert.ok(process.env.LNX_AUTH_QA_PASSWORD && process.env.LNX_AUTH_QA_PASSWORD.length >= 12);
  return baseUrl.origin;
}

async function cleanupUsers() {
  const emails = [ADMIN_EMAIL, MEMBER_EMAIL];
  await prisma.$transaction(async (transaction) => {
    await transaction.rateLimit.deleteMany();
    await transaction.session.deleteMany({ where: { user: { email: { in: emails } } } });
    await transaction.account.deleteMany({ where: { user: { email: { in: emails } } } });
    await transaction.user.deleteMany({ where: { email: { in: emails } } });
  });
}

async function cleanupAudio(projectId: string) {
  const relations = await prisma.projectAsset.findMany({ where: { projectId, role: "AUDIO_PREVIEW" }, include: { asset: true } });
  await prisma.$transaction(async (transaction) => {
    await transaction.projectAsset.deleteMany({ where: { projectId, role: "AUDIO_PREVIEW" } });
    for (const relation of relations) await transaction.asset.deleteMany({ where: { id: relation.assetId } });
  });
  for (const relation of relations) await removeCatalogAudioPreview(relation.asset.storageKey);
}

function sessionCookie(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const values = headers.getSetCookie?.() ?? [headers.get("set-cookie") ?? ""];
  const raw = values.find((value) => /^(?:__Secure-)?lnx-studio\.session_token=/.test(value));
  assert.ok(raw);
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

function audioForm(
  project: { id: string; slug: string },
  expectedAudioAssetId: string | null,
  file: File,
  { rights = true, offsetMs = 0, durationMs = 60_000 }: { rights?: boolean; offsetMs?: number; durationMs?: number } = {},
) {
  const body = new FormData();
  body.set("projectId", project.id);
  body.set("slug", project.slug);
  body.set("expectedAudioAssetId", expectedAudioAssetId ?? "");
  if (rights) body.set("rightsConfirmed", "on");
  body.set("offsetMs", String(offsetMs));
  body.set("requestedDurationMs", String(durationMs));
  body.set("audio", file, file.name);
  return body;
}

async function fileFixture(name: string, seconds = 150, format: "mp3" | "wav" = "mp3", type?: string) {
  const generated = await createAudioFixture({ seconds, format });
  try {
    return new File([generated.bytes!], name, { type: type ?? (format === "mp3" ? "audio/mpeg" : "audio/wav") });
  } finally {
    await generated.cleanup();
  }
}

async function upload(baseUrl: string, body: FormData, cookie?: string, origin = baseUrl) {
  return fetch(`${baseUrl}/api/admin/catalogue/audio`, {
    method: "POST",
    redirect: "manual",
    headers: {
      origin,
      referer: `${baseUrl}/admin/catalogue/jai-adopte-un-humain`,
      accept: "application/json",
      "x-lnx-audio-upload": "browser",
      ...(cookie ? { cookie } : {}),
    },
    body,
  });
}

function after(delayMs: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
}

async function remove(baseUrl: string, project: { id: string; slug: string }, expectedAudioAssetId: string, cookie: string) {
  return fetch(`${baseUrl}/api/admin/catalogue/audio`, {
    method: "DELETE",
    redirect: "manual",
    headers: { origin: baseUrl, cookie, accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ projectId: project.id, slug: project.slug, expectedAudioAssetId }),
  });
}

async function currentAudio(projectId: string) {
  return prisma.asset.findFirstOrThrow({ where: { projects: { some: { projectId, role: "AUDIO_PREVIEW" } } } });
}

async function run() {
  const baseUrl = validateEnvironment();
  const password = process.env.LNX_AUTH_QA_PASSWORD!;
  await cleanupUsers();
  await createInternalAuthUser({ email: ADMIN_EMAIL, password, displayName: "Audio Admin QA", role: "ADMIN" });
  await createInternalAuthUser({ email: MEMBER_EMAIL, password, displayName: "Audio Member QA", role: "MEMBER" });
  const project = await prisma.project.findUniqueOrThrow({ where: { slug: "jai-adopte-un-humain" } });
  const originalStatus = project.status;
  const originalPublicVisible = project.publicVisible;
  await cleanupAudio(project.id);

  try {
    const adminCookie = await login(baseUrl, ADMIN_EMAIL, password);
    const memberCookie = await login(baseUrl, MEMBER_EMAIL, password);
    const firstFile = await fileFixture("qa-full-track.mp3");

    const visitor = await upload(baseUrl, audioForm(project, null, firstFile));
    assert.equal(visitor.status, 303);
    assert.match(visitor.headers.get("location") ?? "", /\/connexion\?retour=/);
    const member = await upload(baseUrl, audioForm(project, null, firstFile), memberCookie);
    assert.equal(member.status, 303);
    assert.match(member.headers.get("location") ?? "", /\/compte\?acces=refuse/);
    assert.equal((await upload(baseUrl, audioForm(project, null, firstFile), adminCookie, "https://attacker.invalid")).status, 403);
    assert.equal((await upload(baseUrl, audioForm(project, null, firstFile, { rights: false }), adminCookie)).status, 422);
    assert.equal((await upload(baseUrl, audioForm(project, null, new File([Buffer.from("fake")], "fake.mp3", { type: "audio/mpeg" })), adminCookie)).status, 400);
    assert.equal((await upload(baseUrl, audioForm(project, null, new File([], "empty.wav", { type: "audio/wav" })), adminCookie)).status, 400);

    const startedAt = performance.now();
    const uploaded = await upload(baseUrl, audioForm(project, null, firstFile, { offsetMs: 45_000 }), adminCookie);
    const mp3HttpElapsedMs = Math.round(performance.now() - startedAt);
    const firstPayload = await uploaded.json() as { state?: string; currentAudioAssetId: string; durationMs: number; sourceDurationMs: number; offsetMs: number };
    assert.equal(uploaded.status, 200, `Full MP3 upload failed with ${firstPayload.state ?? "unknown state"}.`);
    assert.ok(firstPayload.sourceDurationMs >= 149_000);
    assert.ok(firstPayload.durationMs >= 59_000 && firstPayload.durationMs <= 61_000);
    assert.equal(firstPayload.offsetMs, 45_000);
    const first = await currentAudio(project.id);
    assert.equal(first.id, firstPayload.currentAudioAssetId);
    assert.equal(first.type, "AUDIO_PREVIEW");
    assert.equal(first.mimeType, "audio/mpeg");
    assert.equal(first.filename, "audio-preview.mp3");

    const publicUrl = `${baseUrl}/media/catalog/audio/${first.id}`;
    const full = await fetch(publicUrl);
    assert.equal(full.status, 200);
    assert.equal(full.headers.get("content-type"), "audio/mpeg");
    assert.equal(full.headers.get("accept-ranges"), "bytes");
    assert.equal(full.headers.get("content-disposition"), null);
    assert.equal((await full.arrayBuffer()).byteLength, Number(first.sizeBytes));
    const range = await fetch(publicUrl, { headers: { range: "bytes=0-1023" } });
    assert.equal(range.status, 206);
    assert.equal(range.headers.get("content-range"), `bytes 0-1023/${first.sizeBytes}`);
    assert.equal((await range.arrayBuffer()).byteLength, 1_024);
    const tail = await fetch(publicUrl, { headers: { range: "bytes=-512" } });
    assert.equal(tail.status, 206);
    assert.equal((await tail.arrayBuffer()).byteLength, 512);
    assert.equal((await fetch(publicUrl, { headers: { range: "bytes=999999999-" } })).status, 416);
    assert.equal((await fetch(publicUrl, { method: "HEAD" })).status, 200);

    await prisma.project.update({ where: { id: project.id }, data: { legacySourceVersion: null } });
    const wav = await fileFixture("complete-source.wav", 65, "wav", "application/octet-stream");
    const wavStartedAt = performance.now();
    const replaced = await upload(baseUrl, audioForm(project, first.id, wav), adminCookie);
    const wavHttpElapsedMs = Math.round(performance.now() - wavStartedAt);
    assert.equal(replaced.status, 200, "An unrelated Project.updatedAt change must not conflict with audio.");
    const secondPayload = await replaced.json() as { currentAudioAssetId: string };
    const second = await currentAudio(project.id);
    assert.equal(second.id, secondPayload.currentAudioAssetId);
    assert.notEqual(second.id, first.id);
    assert.equal(second.mimeType, "audio/mpeg");
    await assert.rejects(access(process.env.MEDIA_STORAGE_ROOT + "/" + first.storageKey));

    const stale = await upload(baseUrl, audioForm(project, first.id, await fileFixture("stale.mp3", 70)), adminCookie);
    assert.equal(stale.status, 409);
    assert.equal((await stale.json() as { currentAudioAssetId: string }).currentAudioAssetId, second.id);
    assert.equal((await remove(baseUrl, project, first.id, adminCookie)).status, 409);
    assert.equal((await currentAudio(project.id)).id, second.id);

    await prisma.project.update({ where: { id: project.id }, data: { status: "IN_DEVELOPMENT" } });
    assert.equal((await fetch(`${baseUrl}/media/catalog/audio/${second.id}`)).status, 200);
    await prisma.project.update({ where: { id: project.id }, data: { publicVisible: false } });
    assert.equal((await fetch(`${baseUrl}/media/catalog/audio/${second.id}`)).status, 404);
    assert.equal((await fetch(`${baseUrl}/api/admin/catalogue/audio/${second.id}`, { headers: { cookie: adminCookie } })).status, 200);
    await prisma.project.update({ where: { id: project.id }, data: { status: originalStatus, publicVisible: originalPublicVisible } });

    const deleted = await remove(baseUrl, project, second.id, adminCookie);
    assert.equal(deleted.status, 200);
    assert.equal(await prisma.asset.findUnique({ where: { id: second.id } }), null);
    await assert.rejects(access(process.env.MEDIA_STORAGE_ROOT + "/" + second.storageKey));

    const short = await upload(baseUrl, audioForm(project, null, await fileFixture("short.mp3", 20)), adminCookie);
    assert.equal(short.status, 200);
    const shortPayload = await short.json() as { currentAudioAssetId: string; durationMs: number; adjustedToSourceEnd: boolean };
    assert.ok(shortPayload.durationMs >= 19_000 && shortPayload.durationMs <= 21_000);
    assert.equal(shortPayload.adjustedToSourceEnd, true);
    assert.equal((await remove(baseUrl, project, shortPayload.currentAudioAssetId, adminCookie)).status, 200);

    const nearEnd = await upload(baseUrl, audioForm(project, null, await fileFixture("near-end.mp3", 70), { offsetMs: 65_000 }), adminCookie);
    assert.equal(nearEnd.status, 200);
    const nearEndPayload = await nearEnd.json() as { currentAudioAssetId: string; durationMs: number; adjustedToSourceEnd: boolean };
    assert.ok(nearEndPayload.durationMs >= 4_000 && nearEndPayload.durationMs <= 6_000);
    assert.equal(nearEndPayload.adjustedToSourceEnd, true);
    assert.equal((await remove(baseUrl, project, nearEndPayload.currentAudioAssetId, adminCookie)).status, 200);

    const raceFileA = await fileFixture("race-a.mp3", 20);
    const raceFileB = await fileFixture("race-b.wav", 20, "wav");
    const firstRaceRequest = upload(baseUrl, audioForm(project, null, raceFileA), adminCookie);
    await after(50);
    const race = await Promise.all([
      firstRaceRequest,
      upload(baseUrl, audioForm(project, null, raceFileB), adminCookie),
    ]);
    assert.deepEqual(race.map(({ status }) => status).sort(), [200, 409]);
    const winner = await currentAudio(project.id);
    assert.equal((await remove(baseUrl, project, winner.id, adminCookie)).status, 200);

    const largeFixture = await createAudioFixture({ seconds: 316, format: "wav" });
    try {
      assert.ok(largeFixture.bytes!.length > 79 * 1024 * 1024);
      assert.ok(largeFixture.bytes!.length <= CATALOG_AUDIO_SOURCE_MAXIMUM_BYTES);
      const nearLimitStartedAt = performance.now();
      const nearLimit = await upload(baseUrl, audioForm(project, null, new File([largeFixture.bytes!], "near-80-mib.wav", { type: "audio/wav" })), adminCookie);
      const nearLimitElapsedMs = Math.round(performance.now() - nearLimitStartedAt);
      assert.equal(nearLimit.status, 200);
      const nearLimitPayload = await nearLimit.json() as { currentAudioAssetId: string; durationMs: number };
      assert.ok(nearLimitPayload.durationMs >= 59_000 && nearLimitPayload.durationMs <= 61_000);
      assert.equal((await remove(baseUrl, project, nearLimitPayload.currentAudioAssetId, adminCookie)).status, 200);
      console.info(`Audio performance: MP3 HTTP ${mp3HttpElapsedMs} ms; WAV HTTP ${wavHttpElapsedMs} ms; near-80 MiB WAV HTTP ${nearLimitElapsedMs} ms; output ${first.sizeBytes} bytes.`);
    } finally {
      await largeFixture.cleanup();
    }

    const oversizedBytes = Buffer.alloc(CATALOG_AUDIO_SOURCE_MAXIMUM_BYTES + 1);
    oversizedBytes.write("ID3", 0, "ascii");
    const oversized = new File([oversizedBytes], "over-80-mib.mp3", { type: "audio/mpeg" });
    assert.equal((await upload(baseUrl, audioForm(project, null, oversized), adminCookie)).status, 413);
    console.info("Audio HTTP passed: full MP3/WAV transcoding, near-80 MiB streaming upload, public Range/HEAD, privacy, conflicts, delete and security refusals.");
  } finally {
    await prisma.project.update({ where: { id: project.id }, data: { status: originalStatus, publicVisible: originalPublicVisible } });
    await cleanupAudio(project.id);
    await cleanupUsers();
  }
}

run().finally(() => prisma.$disconnect()).catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack ?? error.message : "Audio HTTP QA failed.");
  process.exitCode = 1;
});
