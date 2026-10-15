/** Run only the isolated local DCN profile; never inherit global payment credentials. */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { assertSafeDigitalLocalPostgresUrl as assertSafeLocalPostgresUrl } from "@/lib/digital/local-review-database";
const finalPaths=process.argv[3]==="final-paths";
const commercialFrance=process.argv[3]==="commercial-france";
assert.ok(process.argv[3]===undefined||["final-paths","commercial-france","consolidation"].includes(process.argv[3]),"Unknown local DCN profile.");
const profile = commercialFrance?".private/dcn-france-commercial-config.json":finalPaths?".private/dcn-final-paths-config.json":process.argv[3] === "consolidation" ? ".private/dcn-consolidation-config.json" : ".private/dcn-review-config.json";
const config = JSON.parse(await readFile(profile, "utf8")) as Record<string,string>;
const url = assertSafeLocalPostgresUrl(config.DATABASE_URL);
assert.equal(url.pathname, commercialFrance?"/lnx_dcn_france_commercial_test_20261015":finalPaths?"/lnx_dcn_final_paths_test_20261015":profile.includes("consolidation")?"/lnx_dcn_consolidation_test":"/lnx_dcn_runtime_test"); assert.equal(url.port, "55473"); assert.equal(url.username, "dcn_runtime_a");
if(finalPaths||commercialFrance)assert.equal(url.searchParams.get("options"),"-c timezone=UTC","The final DCN QA profiles require explicit UTC database sessions.");
assert.equal(config.DCN_MODE, "TEST"); assert.equal(config.DCN_NEW_PAYMENTS_ENABLED, "false");
for (const key of Object.keys(config)) assert.ok(!/(STRIPE|PAYPAL|RESEND|LIVE)/i.test(key), "This local review profile contains no provider credentials.");
const command = process.argv[2] ?? "web";
assert.ok(["web", "web-built", "worker"].includes(command));
const env:NodeJS.ProcessEnv = { PATH: process.env.PATH!, HOME: process.env.HOME!, TMPDIR: process.env.TMPDIR ?? "/private/tmp", NODE_ENV:command==="web-built"?"production":"development", ...config, NEXT_TELEMETRY_DISABLED:"1", DCN_LOCAL_REVIEW_AUTHORIZED:"true" };
if(finalPaths||commercialFrance){env.DCN_ENABLED="true";env.DCN_MODE="TEST";env.DCN_NEW_PAYMENTS_ENABLED="false";env.DCN_EXTERNAL_TEST_AUTHORIZED="false";}
const child = command === "worker"
  ? spawn(process.execPath, ["--conditions=react-server", "--import", "tsx", "scripts/digital-media-worker.ts"], { env, stdio: "inherit" })
  : spawn(process.execPath, ["node_modules/next/dist/bin/next", ...(command==="web-built"?["start"]:["dev","--webpack"]), "--hostname", "127.0.0.1", "--port", "3140"], { env, stdio: "inherit" });
child.on("exit", code => { process.exitCode = code ?? 1; });
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => child.kill(signal));
