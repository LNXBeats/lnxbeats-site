import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import uri from "fast-uri";

test("the lock retains the qualified security versions and coordinated Better Auth release", async () => {
  const lock = JSON.parse(await readFile(new URL("../../package-lock.json", import.meta.url), "utf8"));
  const manifest = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  assert.equal(lock.packages["node_modules/zod"].version, "4.6.7");
  assert.equal(lock.packages["node_modules/fast-uri"].version, "3.1.9");
  assert.equal(manifest.dependencies["better-auth"], "1.7.14");
  assert.equal(lock.packages[""].dependencies["better-auth"], "1.7.14");
  assert.equal(lock.packages["node_modules/better-auth"].version, "1.7.14");
  for (const [path, entry] of Object.entries(lock.packages) as Array<[string, { version: string }]>) {
    if (/(?:^|\/)node_modules\/@better-auth\/[^/]+$/.test(path) && !path.endsWith("/@better-auth/utils")) {
      assert.equal(entry.version, "1.7.14", path);
    }
  }
  assert.equal(lock.packages["node_modules/@prisma/client"].version, "7.9.1");
});

test("Zod rejects an oversized constrained array before expanding every invalid element", () => {
  // Small, local fixture only: no stress test or public request.
  const result = z.array(z.object({ value: z.string() })).max(2)
    .safeParse(Array.from({ length: 1000 }, () => ({ value: 0 })));
  assert.equal(result.success, false);
  if (!result.success) {
    assert.equal(result.error.issues.length, 1);
    assert.equal(result.error.issues[0].code, "too_big");
  }
});

test("fast-uri does not decode an invalid encoded scheme into executable javascript", () => {
  for (const input of ["%6Aavascript:alert(1)", "%u006Aavascript:alert(1)"]) {
    assert.notEqual(uri.parse(input).scheme, "javascript");
    assert.ok(!uri.normalize(input).startsWith("javascript:"));
  }
  assert.equal(uri.normalize("https://example.test/music"), "https://example.test/music");
});
