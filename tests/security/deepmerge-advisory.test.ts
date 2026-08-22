import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { deepmerge, deepmergeInto } from "deepmerge-ts";

type CircularRecord = Record<string, unknown> & { self?: CircularRecord };

function installedVersion() {
  const manifest = JSON.parse(
    readFileSync(join(process.cwd(), "node_modules/deepmerge-ts/package.json"), "utf8"),
  ) as { version?: string };
  assert.match(manifest.version ?? "", /^\d+\.\d+\.\d+$/);
  return manifest.version!;
}

test("the Prisma transitive override resolves deepmerge-ts to a patched release", () => {
  const manifest = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as {
    overrides?: Record<string, string>;
  };
  const lock = JSON.parse(readFileSync(join(process.cwd(), "package-lock.json"), "utf8")) as {
    packages?: Record<string, { version?: string }>;
  };

  assert.equal(manifest.overrides?.["deepmerge-ts"], "8.0.2");
  assert.equal(lock.packages?.["node_modules/deepmerge-ts"]?.version, "8.0.2");
  assert.ok(Number(installedVersion().split(".")[0]) >= 8);
});

test("deepmerge safely handles the recursive graph from CVE-2026-40345", { timeout: 2_000 }, () => {
  const left: CircularRecord = {};
  left.self = left;
  const right: CircularRecord = {};
  right.self = right;

  const merged = deepmerge(left, right) as CircularRecord;
  assert.equal(merged.self, merged);
});

test("deepmergeInto safely handles the recursive graph from CVE-2026-40345", { timeout: 2_000 }, () => {
  const target: CircularRecord = {};
  target.self = target;
  const source: CircularRecord = {};
  source.self = source;

  deepmergeInto(target, source);
  assert.equal(target.self, target);
});
