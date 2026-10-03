import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("Web supplies the measured glibc arena bound before starting Next", async () => {
  const { scripts } = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  const directory = await mkdtemp(path.join(os.tmpdir(), "lnx-web-start-test-"));
  try {
    await writeFile(path.join(directory, "next"), '#!/bin/sh\nprintf "%s\\n" "$MALLOC_ARENA_MAX" "$1"\n', { mode: 0o700 });
    const result = spawnSync("/bin/sh", ["-c", scripts.start], {
      env: { NODE_ENV: "test", PATH: `${directory}:/usr/bin:/bin` },
      encoding: "utf8",
      timeout: 5_000,
    });
    assert.equal(result.status, 0);
    assert.equal(result.stdout, "2\nstart\n");
    assert.equal(result.stderr, "");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("the Web allocator bound does not alter worker, notification or maintenance commands", async () => {
  const { scripts } = JSON.parse(await readFile(new URL("../../package.json", import.meta.url), "utf8"));
  for (const name of ["creations:media-worker", "notifications:scheduler:run", "shop:maintenance:run", "database:provision-creations-runtime"]) {
    assert.equal(typeof scripts[name], "string");
    assert.doesNotMatch(scripts[name], /MALLOC_ARENA_MAX|max-old-space-size|expose-gc/);
  }
});
