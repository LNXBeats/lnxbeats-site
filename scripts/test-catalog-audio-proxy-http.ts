import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { openAsBlob } from "node:fs";
import { readdir, rm } from "node:fs/promises";

import { createInternalAuthUser } from "@/lib/auth/internal-user";
import { prisma } from "@/lib/prisma";
import { createAudioFixture } from "@/tests/audio/fixture";

async function main() {
  assert.equal(process.env.LNX_DATABASE_TARGET, "lnx-catalog-audio-proxy-test");
  const db = new URL(process.env.DATABASE_URL!);
  assert.equal(db.hostname, "127.0.0.1");
  assert.equal(db.pathname, "/lnx_catalog_audio_proxy_test");
  assert.equal(db.port, "55488");
  assert.equal(process.env.MEDIA_STORAGE_DRIVER, "local");
  assert.equal(process.env.MEDIA_DEPLOYMENT_ENV, "test");
  for (const key of ["PAYMENTS_ENABLED", "EMAIL_NOTIFICATIONS_ENABLED", "NOTIFICATION_WORKER_ENABLED", "CREATION_MEDIA_WORKER_ENABLED"]) assert.equal(process.env[key], "false");
  const root = process.env.AUDIO_TEMP_ROOT!;
  assert.match(root, /^\/private\/tmp\/lnx-v3-audio-proxy\.[a-zA-Z0-9]+$/);
  const base = process.env.AUTH_URL!;
  assert.equal(base, "http://localhost:31981");
  const email = `audio-proxy-${randomUUID()}@example.invalid`;
  const password = process.env.LNX_AUTH_QA_PASSWORD!;
  assert.ok(password.length >= 20);
  await createInternalAuthUser({ email, password, displayName: "Synthetic audio proxy QA", role: "ADMIN" });
  const user = await prisma.user.findUniqueOrThrow({ where: { email } });
  const project = await prisma.project.create({ data: { slug: `qa-audio-proxy-${randomUUID()}`, title: "Synthetic audio proxy QA", type: "ALBUM", status: "DRAFT", publicVisible: false, catalogPosition: 999001 } });
  let assetId: string | null = null;
  let cookie = "";
  const checks: Record<string, unknown> = {};
  const send = async (method: string, body: BodyInit, authenticated = true, origin = base) => fetch(`${base}/api/admin/catalogue/audio`, { method, body, headers: { origin, ...(authenticated ? { cookie } : {}), ...(method === "DELETE" ? { "content-type": "application/json" } : {}) }, redirect: "manual" });
  const remove = async () => {
    if (!assetId) return;
    const r = await send("DELETE", JSON.stringify({ projectId: project.id, slug: project.slug, expectedAudioAssetId: assetId }));
    assert.equal(r.status, 200);
    assetId = null;
  };
  try {
    const login = await fetch(`${base}/api/auth/sign-in/email`, { method: "POST", headers: { origin: base, "content-type": "application/json" }, body: JSON.stringify({ email, password }) });
    assert.equal(login.status, 200);
    cookie = login.headers.getSetCookie().find((value) => /^(?:__Secure-)?lnx-studio\.session_token=/.test(value))?.split(";", 1)[0] ?? "";
    assert.ok(cookie);
    for (const seconds of [65, 316]) {
      const filename = `${root}/synthetic-${seconds}.wav`;
      await createAudioFixture({ seconds, format: "wav", outputPath: filename });
      const blob = await openAsBlob(filename, { type: "audio/wav" });
      assert.ok(blob.size > 10 * 1024 * 1024 && blob.size <= 80 * 1024 * 1024);
      const form = () => {
        const f = new FormData();
        for (const [key, value] of Object.entries({ projectId: project.id, slug: project.slug, expectedAudioAssetId: "", rightsConfirmed: "on", offsetMs: "0", requestedDurationMs: "60000" })) f.set(key, value);
        f.set("audio", blob, "synthetic.wav");
        return f;
      };
      if (seconds === 65) {
        assert.ok([303, 307].includes((await send("POST", form(), false)).status));
        assert.equal((await send("POST", form(), true, "https://attacker.invalid")).status, 403);
        checks.adminAndSameOrigin = "PASS";
      }
      const started = Date.now();
      const r = await send("POST", form());
      const payload = await r.json();
      assert.equal(r.status, 200, `UPLOAD_HTTP_${r.status}_${payload.state}`);
      assert.equal(payload.state, "audio-enregistre");
      assetId = payload.currentAudioAssetId;
      assert.ok(assetId);
      assert.ok(payload.durationMs >= 59000 && payload.durationMs <= 61000);
      assert.equal((await fetch(`${base}/media/catalog/audio/${assetId}`)).status, 404);
      const range: Response = await fetch(`${base}/api/admin/catalogue/audio/${assetId}`, { headers: { cookie, range: "bytes=0-1023" } });
      assert.equal(range.status, 206);
      assert.equal((await range.arrayBuffer()).byteLength, 1024);
      checks[`wav_${seconds}`] = { bytes: blob.size, http: r.status, elapsedMs: Date.now() - started, range: 206, draftPublic: 404 };
      await remove();
      assert.deepEqual(await readdir(`${root}/lnx-studio/catalog/audio-sources-temp`), []);
      await rm(filename);
    }
    assert.equal(await prisma.projectAsset.count({ where: { projectId: project.id } }), 0);
    checks.cleanup = "PASS";
    console.log(JSON.stringify({ status: "PASS", checks }));
  } finally {
    await remove();
    await prisma.project.delete({ where: { id: project.id } });
    await prisma.session.deleteMany({ where: { userId: user.id } });
    await prisma.account.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
    await prisma.$disconnect();
  }
}
main().catch((error: unknown) => { console.error(JSON.stringify({ status: "AUDIO_PROXY_LOCAL_HTTP_FAILED", kind: error instanceof Error ? error.name : "unknown", reason: error instanceof assert.AssertionError ? error.message : "operation failed" })); process.exitCode = 1; });
