import assert from "node:assert/strict";
import test from "node:test";

import { directUploadConnectOrigin, publicMediaOrigin } from "@/lib/media/storage/csp";

const r2 = {
  MEDIA_STORAGE_DRIVER: "s3",
  MEDIA_STORAGE_PROVIDER: "r2",
  MEDIA_S3_ENDPOINT: "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
  MEDIA_PRIVATE_BUCKET: "lnx-studio-v33-preview-private",
  MEDIA_PUBLIC_BUCKET: "lnx-studio-v33-preview-public",
};

test("R2 CSP permits only the exact configured bucket origins", () => {
  assert.equal(directUploadConnectOrigin({ MEDIA_STORAGE_DRIVER: "local" }), null);
  assert.equal(directUploadConnectOrigin(r2), "https://lnx-studio-v33-preview-private.0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com");
  assert.equal(publicMediaOrigin(r2), "https://lnx-studio-v33-preview-public.0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com");
  for (const endpoint of ["http://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com", "https://example.com", "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/path", "https://user:pass@0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com"]) {
    assert.throws(() => directUploadConnectOrigin({ ...r2, MEDIA_S3_ENDPOINT: endpoint }));
  }
  assert.throws(() => directUploadConnectOrigin({ ...r2, MEDIA_PRIVATE_BUCKET: "bucket.example.invalid/path" }));
  assert.throws(() => publicMediaOrigin({ ...r2, MEDIA_PUBLIC_BUCKET: "" }));
});
