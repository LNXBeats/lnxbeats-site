/** Node --import entry point. Default is fail-closed, with approved loopback only. */
import { lstat, realpath, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createPaypalQaBudgetAuthority } from "./paypal-dcn-qa-budget.mjs";
import { installPaypalQaNetworkGuard } from "./paypal-dcn-qa-runtime.mjs";

const worktree = fileURLToPath(new URL("../../", import.meta.url));
if (process.env.DCN_PAYPAL_QA_RECIPE_APPROVED !== "YES") {
  // No profile/credential read, no network, no ledger initialization.
  installPaypalQaNetworkGuard();
} else {
  const file = path.resolve(process.env.DCN_PAYPAL_QA_PRIVATE_BINDING ?? "");
  const root = path.join(worktree, ".private", "dcn-paypal-qa-budget");
  if (!file.startsWith(`${root}${path.sep}`) || path.basename(file) !== "binding.json"
    || await realpath(path.dirname(file)) !== path.dirname(file)) throw new Error("QA_PRELOAD_BLOCKED:PRIVATE_BINDING_REQUIRED");
  const parent = await lstat(path.dirname(file)), stat = await lstat(file);
  if (!parent.isDirectory() || parent.isSymbolicLink() || parent.uid !== process.getuid() || parent.mode & 0o077
    || !stat.isFile() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o777) !== 0o600
    || stat.size > 65536) throw new Error("QA_PRELOAD_BLOCKED:PRIVATE_BINDING_REQUIRED");
  let privateBinding;
  try { privateBinding = JSON.parse(await readFile(file, "utf8")); } catch { throw new Error("QA_PRELOAD_BLOCKED:INVALID_PRIVATE_BINDING"); }
  const keys = ["approval", "scope", "clientId", "expectedClientId", "clientSecret", "requiredScopes", "webhookId", "webhookEvents", "expectedOAuthAppId"];
  if (!privateBinding || Object.keys(privateBinding).length !== keys.length || Object.keys(privateBinding).some(key => !keys.includes(key))
    || privateBinding.approval !== "USER_APPROVED_EXACT_ROUTE_AND_RECIPE") throw new Error("QA_PRELOAD_BLOCKED:EXACT_RECIPE_APPROVAL_REQUIRED");
  const ledger = path.join(path.dirname(file), "ledger.jsonl");
  const budget = await createPaypalQaBudgetAuthority(ledger, privateBinding.scope);
  installPaypalQaNetworkGuard({ budget, binding: { ...privateBinding.scope,
    clientId: privateBinding.clientId, clientSecret: privateBinding.clientSecret,
    expectedClientId: privateBinding.expectedClientId, expectedOAuthAppId: privateBinding.expectedOAuthAppId,
    requiredScopes: privateBinding.requiredScopes, webhookId: privateBinding.webhookId,
    webhookEvents: privateBinding.webhookEvents } });
  privateBinding = undefined;
}
