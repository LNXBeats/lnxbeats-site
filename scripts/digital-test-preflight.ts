import { readFile, lstat } from "node:fs/promises";
import assert from "node:assert/strict";
import { digitalTestPreflight } from "../lib/digital/test-preflight";
// No .env/global LIVE inheritance, SDK construction or fetch. An external QA profile is opt-in and private.
let profile: Record<string, string> = {};
const args=process.argv.slice(2);
assert.ok(args.length===0||args.length===2&&args[0]==="--profile"&&args[1]===".private/dcn-external-test-config.json","Only the explicit DCN QA profile is accepted.");
const file=args[1]??".private/dcn-review-config.json";
try { const s=await lstat(file);assert.ok(s.isFile()&&!s.isSymbolicLink()&&(s.mode&0o077)===0,"DCN QA profile must be private and regular.");profile = JSON.parse(await readFile(file, "utf8")); }
catch { if(args.length)throw new Error("DCN external QA profile is absent, invalid or not private; no value logged."); }
console.log(JSON.stringify(digitalTestPreflight(profile), null, 2));
