import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("dedicated worker build checks its runtime graph without Next pages or migrations", async () => {
  const pkg = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  const config = await readFile(new URL("../../railway.media-worker.toml", import.meta.url), "utf8");
  const ts = JSON.parse(await readFile(new URL("../../tsconfig.media-worker.json", import.meta.url), "utf8"));
  assert.match(config, /npm ci --include=dev && npm run creations:media-worker:build/);
  assert.match(config, /preDeployCommand = \[\]/);
  assert.match(pkg.scripts["creations:media-worker:build"], /prisma generate && tsc --project tsconfig.media-worker.json/);
  assert.doesNotMatch(pkg.scripts["creations:media-worker:build"], /next build|migrate|db push/);
  assert.match(pkg.scripts["creations:media-worker"], /node --import tsx scripts\/creation-media-worker.ts/);
  assert.ok(ts.include.includes("scripts/creation-media-worker.ts"));
  assert.ok(ts.exclude.includes(".next"));
  assert.equal(pkg.scripts.start, "MALLOC_ARENA_MAX=2 next start");
});
