import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { SHOP_PHASE2_QA_HTTP_PORT, SHOP_PHASE2_QA_ORIGIN } from "@/lib/shop/qa-contract";
import {
  loadAndAssertShopPhase3CPaypalSandboxQaEnvironment,
  shopPhase3CPaypalSandboxQaChildEnvironment,
} from "@/lib/shop/paypal-sandbox-qa-guard";

async function run() {
  const operation = process.argv[2];
  assert.ok(operation === "build" || operation === "start", "Use build or start.");
  const runtime = await loadAndAssertShopPhase3CPaypalSandboxQaEnvironment();
  assert.equal(runtime.baseUrl, SHOP_PHASE2_QA_ORIGIN);
  const nextCli = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
  const args = operation === "build"
    ? [nextCli, "build", "--webpack"]
    : [nextCli, "start", "-H", "127.0.0.1", "-p", SHOP_PHASE2_QA_HTTP_PORT];
  const child = spawn(process.execPath, args, {
    cwd: process.cwd(),
    env: shopPhase3CPaypalSandboxQaChildEnvironment(process.env),
    stdio: "inherit",
  });
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) process.exitCode = exitCode;
}

run().catch(() => {
  console.error("The guarded Shop PayPal Sandbox preview command failed.");
  process.exitCode = 1;
});
