/** Album-scoped local QA excerpt worker. No provider, document, email or historical upload queue. */
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { assertSafeDigitalLocalPostgresUrl } from "@/lib/digital/local-review-database";
import { assertDigitalUuid } from "@/lib/digital/domain";

const args = process.argv.slice(2), projectIndex = args.indexOf("--project"), once = args.includes("--once");
assert.ok(projectIndex >= 0 && args.length === (once ? 3 : 2) && args.every((value, index) => index === projectIndex + 1 || ["--project", "--once"].includes(value)), "Use --project <QA album UUID> [--once].");
const projectId = args[projectIndex + 1]; assertDigitalUuid(projectId);
const profile = ".private/dcn-france-commercial-config.json"; assert.equal((await stat(profile)).mode & 0o077, 0, "The local QA profile must remain private.");
const config = JSON.parse(await readFile(profile, "utf8")) as Record<string, string>, url = assertSafeDigitalLocalPostgresUrl(config.DATABASE_URL);
assert.equal(url.hostname, "127.0.0.1"); assert.equal(url.port, "55473"); assert.equal(url.pathname, "/lnx_dcn_france_commercial_test_20261015");
assert.equal(url.username, "dcn_runtime_a"); assert.equal(url.searchParams.get("options"), "-c timezone=UTC");
assert.equal(config.AUTH_URL, "http://127.0.0.1:3140"); assert.equal(config.MEDIA_STORAGE_DRIVER, "local"); assert.equal(config.EMAIL_PROVIDER, "capture");
assert.equal(config.DCN_MODE, "TEST"); assert.equal(config.DCN_NEW_PAYMENTS_ENABLED, "false");
for (const key of Object.keys(config)) assert.ok(!/STRIPE|PAYPAL|RESEND|RAILWAY|AWS|R2|SMTP|LIVE/i.test(key), "No provider credentials are permitted.");
const safe = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR ?? "/private/tmp" };
for (const key of Object.keys(process.env)) delete process.env[key];
Object.assign(process.env, safe, config, { NODE_ENV: "development", DCN_ENABLED: "true", DCN_MODE: "TEST", DCN_NEW_PAYMENTS_ENABLED: "false",
  DCN_EXTERNAL_TEST_AUTHORIZED: "false", DCN_LOCAL_REVIEW_AUTHORIZED: "true", NEXT_TELEMETRY_DISABLED: "1", ADS_ENABLED: "false" });
globalThis.fetch = (async () => { throw new Error("External HTTP is forbidden in this local excerpt worker."); }) as typeof fetch;
const { processDigitalExcerpt } = await import("@/lib/digital/excerpt-worker"), { prisma } = await import("@/lib/prisma");
let stopping = false; for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { stopping = true; });
const started = Date.now();
try {
  do {
    try {
      const result = await processDigitalExcerpt({ projectId });
      if (result.processed || once) console.log(JSON.stringify({ scope: "LOCAL_QA_EXCERPT_ONLY", ...result }));
    } catch { console.error("[digital-excerpt] Scoped local derivation unavailable; no private detail logged."); if (once) process.exitCode = 1; }
    if (!once && !stopping) await new Promise(resolve => setTimeout(resolve, 1500));
  } while (!once && !stopping && Date.now() - started < 2 * 60 * 60_000);
} finally { await prisma.$disconnect(); }
