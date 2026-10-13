/** Run only the isolated local DCN profile; never inherit global payment credentials. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";
const config = JSON.parse(await readFile(".private/dcn-review-config.json", "utf8")) as Record<string,string>;
const url = assertSafeLocalPostgresUrl(config.DATABASE_URL);
assert.equal(url.pathname, "/lnx_dcn_runtime_test"); assert.equal(url.port, "55473"); assert.equal(url.username, "dcn_runtime_a");
assert.equal(config.DCN_MODE, "TEST"); assert.equal(config.DCN_NEW_PAYMENTS_ENABLED, "false");
for (const key of Object.keys(config)) assert.ok(!/(STRIPE|PAYPAL|RESEND|LIVE)/i.test(key), "This local review profile contains no provider credentials.");
const command = process.argv[2] ?? "web";
assert.ok(["web", "web-built", "worker"].includes(command));
const env:NodeJS.ProcessEnv = { PATH: process.env.PATH!, HOME: process.env.HOME!, TMPDIR: process.env.TMPDIR ?? "/private/tmp", NODE_ENV:command==="web-built"?"production":"development", ...config };
const child = command === "worker"
  ? spawn(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/digital-media-worker.ts"], { env, stdio: "inherit" })
  : spawn(process.execPath, ["node_modules/next/dist/bin/next", ...(command==="web-built"?["start"]:["dev","--webpack"]), "--hostname", "127.0.0.1", "--port", "3140"], { env, stdio: "inherit" });
child.on("exit", code => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
