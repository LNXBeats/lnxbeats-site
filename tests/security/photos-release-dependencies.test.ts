import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const manifest = JSON.parse(readFileSync("package.json", "utf8"));
const packages = JSON.parse(readFileSync("package-lock.json", "utf8")).packages as Record<string, { version?: string }>;

test("the framework and its lint configuration use the same patched 16.3 release", () => {
  assert.equal(manifest.dependencies.next, "16.3.8");
  assert.equal(manifest.devDependencies["eslint-config-next"], "16.3.8");
  for (const name of ["next", "eslint-config-next"]) {
    assert.equal(packages[`node_modules/${name}`]?.version, "16.3.8");
    assert.equal(JSON.parse(readFileSync(`node_modules/${name}/package.json`, "utf8")).version, "16.3.8");
  }
});

test("brace-expansion keeps each compatible major on its patched version", () => {
  const entries = Object.entries(packages).filter(([name]) => name.endsWith("/node_modules/brace-expansion") || name === "node_modules/brace-expansion");
  assert.ok(entries.length > 0);
  for (const [name, value] of entries) {
    assert.ok(["1.1.21", "5.0.12"].includes(value.version ?? ""), `Unreviewed brace-expansion release at ${name}`);
    assert.equal(JSON.parse(readFileSync(`${name}/package.json`, "utf8")).version, value.version);
  }
});
