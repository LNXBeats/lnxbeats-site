import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { runSequentialDatabaseQueries } from "@/lib/database/sequential-queries";

test("transactional database queries never overlap on one PostgreSQL client", async () => {
  let active = 0;
  let maximumActive = 0;
  const calls: string[] = [];
  const operation = (name: string, result: number) => async () => {
    calls.push(`start:${name}`);
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise<void>((resolve) => setImmediate(resolve));
    active -= 1;
    calls.push(`end:${name}`);
    return result;
  };

  const results = await runSequentialDatabaseQueries(
    operation("base", 1),
    operation("relations", 2),
    operation("audit", 3),
  );

  assert.deepEqual(results, [1, 2, 3]);
  assert.equal(maximumActive, 1);
  assert.deepEqual(calls, [
    "start:base", "end:base",
    "start:relations", "end:relations",
    "start:audit", "end:audit",
  ]);
});

test("transactional relation loaders use the sequential query boundary", async () => {
  const sources = await Promise.all([
    readFile(new URL("../../lib/orders/service.ts", import.meta.url), "utf8"),
    readFile(new URL("../../lib/orders/delivery.ts", import.meta.url), "utf8"),
    readFile(new URL("../../lib/admin/service.ts", import.meta.url), "utf8"),
    readFile(new URL("../../lib/production/catalog-import.ts", import.meta.url), "utf8"),
    readFile(new URL("../../lib/catalog/service.ts", import.meta.url), "utf8"),
  ]);
  for (const source of sources) assert.match(source, /runSequentialDatabaseQueries\(/);
  const combined = sources.join("\n");
  assert.doesNotMatch(combined, /const \[deliveries, validDeliveries\] = await Promise\.all/);
  assert.doesNotMatch(combined, /findUniqueOrThrow\(\{ where: \{ id: (?:current|draft)\.id \}, include: orderInclude \}\)/);
  assert.doesNotMatch(combined, /database\.project\.findUnique\(\{ where: \{ slug: project\.slug \}, include \}\)/);
});
