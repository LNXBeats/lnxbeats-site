import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import uri from "fast-uri";

test("the locked security update changes only the qualified Zod and fast-uri packages", async () => {
  const lock = JSON.parse(await readFile(new URL("../../package-lock.json", import.meta.url), "utf8"));
  assert.equal(lock.packages["node_modules/zod"].version, "4.6.7");
  assert.equal(lock.packages["node_modules/fast-uri"].version, "3.1.9");
  assert.equal(lock.packages["node_modules/better-auth"].version, "1.6.26");
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
