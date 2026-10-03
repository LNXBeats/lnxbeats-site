import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { CatalogAudioRequestError, readCatalogAudioUpload } from "@/lib/catalog/audio-request";
import { removeAudioTempFile } from "@/lib/catalog/audio-temp";

function request({ truncated = false, bytes = 12 * 1024 * 1024, filename = "synthetic.mp3" } = {}) {
  const boundary = "lnx-catalog-audio-stream-regression";
  const prefix = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="${filename}"\r\nContent-Type: audio/mpeg\r\n\r\n`);
  const source = Buffer.alloc(bytes);
  source.write("ID3");
  const ending = truncated ? Buffer.alloc(0) : Buffer.from(`\r\n--${boundary}--\r\n`);
  return new Request("http://localhost/api/admin/catalogue/audio", {
    method: "POST", headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
    body: Buffer.concat([prefix, source, ending]),
  });
}

test("catalogue parser streams a source larger than the photo transport cap", async () => {
  const upload = await readCatalogAudioUpload(request());
  try { assert.equal(upload.source.sizeBytes, 12 * 1024 * 1024); }
  finally { await removeAudioTempFile(upload.source.path); }
});

test("a truncated catalogue multipart settles the file pipeline before cleanup without an unhandled rejection", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lnx-audio-truncation-test-"));
  const previous = process.env.AUDIO_TEMP_ROOT;
  process.env.AUDIO_TEMP_ROOT = root;
  try {
    for (const bytes of [32, 10 * 1024 * 1024 + 65536]) {
      await assert.rejects(readCatalogAudioUpload(request({ truncated: true, bytes })),
        (error: unknown) => error instanceof CatalogAudioRequestError && error.code === "INVALID_MULTIPART");
      await new Promise((resolve) => setTimeout(resolve, 25));
      assert.deepEqual(await readdir(path.join(root, "lnx-studio/catalog/audio-sources-temp")), []);
    }
    await assert.rejects(readCatalogAudioUpload(request({ truncated: true, bytes: 32, filename: "invalid.exe" })), CatalogAudioRequestError);
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.deepEqual(await readdir(path.join(root, "lnx-studio/catalog/audio-sources-temp")), []);
  } finally {
    if (previous === undefined) delete process.env.AUDIO_TEMP_ROOT;
    else process.env.AUDIO_TEMP_ROOT = previous;
    await rm(root, { recursive: true, force: true });
  }
});
