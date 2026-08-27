import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import {
  loadAndAssertShopPhase2QaEnvironment,
  shopPhase2QaChildEnvironment,
} from "@/lib/shop/qa-guard";

async function run() {
  await loadAndAssertShopPhase2QaEnvironment();
  const prismaCli = fileURLToPath(new URL("../node_modules/prisma/build/index.js", import.meta.url));
  console.info("Applying migrations to the guarded Shop Phase 2 local database.");
  const child = spawn(process.execPath, [prismaCli, "migrate", "deploy"], {
    cwd: process.cwd(),
    env: shopPhase2QaChildEnvironment(),
    stdio: "inherit",
  });
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) process.exitCode = exitCode;
}

run().catch(() => {
  console.error("The guarded Shop Phase 2 migration command failed.");
  process.exitCode = 1;
});
