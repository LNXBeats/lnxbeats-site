import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

function json<T>(path: string) {
  return JSON.parse(readFileSync(join(process.cwd(), path), "utf8")) as T;
}

test("the Prisma transitive mysql2 dependency resolves to the first patched release", () => {
  const manifest = json<{ overrides?: Record<string, string> }>("package.json");
  const lock = json<{ packages?: Record<string, { version?: string; dependencies?: Record<string, string> }> }>("package-lock.json");
  const installed = json<{ version?: string }>("node_modules/mysql2/package.json");

  assert.equal(manifest.overrides?.mysql2, "3.22.0");
  assert.equal(lock.packages?.["node_modules/mysql2"]?.version, "3.22.0");
  assert.equal(installed.version, "3.22.0");
  assert.equal(lock.packages?.["node_modules/prisma"]?.dependencies?.mysql2, "3.15.3");
});

test("the application remains PostgreSQL-only and has no direct mysql2 dependency", () => {
  const manifest = json<{
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  }>("package.json");
  assert.equal(manifest.dependencies?.mysql2, undefined);
  assert.equal(manifest.devDependencies?.mysql2, undefined);
  assert.equal(manifest.dependencies?.["@prisma/adapter-pg"], "7.9.1");
  assert.equal(manifest.dependencies?.pg, "8.23.0");
});
