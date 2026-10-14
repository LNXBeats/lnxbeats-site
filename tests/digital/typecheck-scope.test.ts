import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const root = fileURLToPath(new URL("../../", import.meta.url));
const archived = [
  "output/dcn-external-20261013/stripe-campaign.ts",
  "output/dcn-external-20261013/stripe-download-proof.ts",
];
const loaded = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
const config = loaded.config;

test("DCN typecheck excludes only the two historical opt-in artifacts, not an output subtree", () => {
  assert.equal(loaded.error, undefined);
  assert.deepEqual(config.exclude, ["node_modules", ...archived]);
  assert.equal(config.compilerOptions.strict, true);
  assert.equal(config.compilerOptions.noEmit, true);
});

test("DCN archive exclusion preserves every active application, script and test in the standard typecheck", () => {
  const before = ts.parseJsonConfigFileContent({ ...config, exclude: ["node_modules"] }, ts.sys, root);
  const after = ts.parseJsonConfigFileContent(config, ts.sys, root);
  assert.deepEqual(before.errors, []);
  assert.deepEqual(after.errors, []);
  const includedBefore = new Set(before.fileNames);
  const includedAfter = new Set(after.fileNames);
  assert.deepEqual([...includedBefore].filter(p => !includedAfter.has(p)).sort(), archived.map(p => path.join(root, p)).filter(existsSync).sort());
  assert.deepEqual([...includedAfter].filter(p => !includedBefore.has(p)), []);
  for (const directory of ["app", "components", "lib", "scripts", "tests"]) {
    const prefix = path.join(root, directory) + path.sep;
    assert.deepEqual(after.fileNames.filter(p => p.startsWith(prefix)), before.fileNames.filter(p => p.startsWith(prefix)));
  }
  for (const active of ["app/api/digital/webhooks/[provider]/route.ts", "lib/digital/providers.ts", "lib/digital/finance.ts", "tests/digital/library-labels.test.ts"]) assert.ok(includedAfter.has(path.join(root, active)));
});

test("DCN dedicated workers still use their own explicit sources and exclusions", () => {
  for (const file of ["tsconfig.media-worker.json", "tsconfig.digital-worker.json"]) {
    const worker = ts.readConfigFile(path.join(root, file), ts.sys.readFile);
    assert.equal(worker.error, undefined);
    assert.deepEqual(worker.config.exclude, ["node_modules", ".next"]);
    const parsed = ts.parseJsonConfigFileContent(worker.config, ts.sys, root);
    assert.deepEqual(parsed.errors, []);
    assert.ok(parsed.fileNames.some(p => p.startsWith(path.join(root, "scripts") + path.sep)));
    assert.ok(archived.every(p => !parsed.fileNames.includes(path.join(root, p))));
  }
});
