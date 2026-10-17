/** Local Express demo only. No provider credentials are inherited. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
const config = JSON.parse(await readFile(".private/express-qa.json", "utf8")) as Record<string,string>;
const u = new URL(config.DATABASE_URL);
assert.equal(u.hostname, "127.0.0.1"); assert.equal(u.port, "55522"); assert.equal(u.pathname, "/lnx_dcn_v12_express_test_20261017"); assert.equal(u.username, "dcn_v12_express_runtime");
assert.equal(config.AUTH_URL, "http://127.0.0.1:3162"); assert.equal(config.MEDIA_STORAGE_DRIVER, "local");
for (const key of Object.keys(config)) assert.doesNotMatch(key, /STRIPE|PAYPAL|RESEND|AWS|S3|R2|RAILWAY/);
const env: NodeJS.ProcessEnv = { PATH: process.env.PATH, HOME: process.env.HOME, TMPDIR: process.env.TMPDIR, NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1", ...config };
const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--webpack", "--hostname", "127.0.0.1", "--port", "3162"], { env, stdio: "inherit" });
const audio = spawn(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/music-express-local-worker.ts"], { env, stdio: "inherit" });
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => { stopping = true; child.kill(signal); audio.kill(signal); });
child.on("exit", code => { stopping = true; audio.kill("SIGTERM"); process.exitCode = code ?? 1; });
audio.on("exit", code => { if(!stopping) { stopping = true; console.error("[express] Local audio worker stopped; shutting down QA web safely."); child.kill("SIGTERM"); process.exitCode=code || 1; } });
