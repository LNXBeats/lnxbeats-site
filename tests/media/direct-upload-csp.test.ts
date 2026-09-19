import assert from "node:assert/strict";
import test from "node:test";

import { directUploadConnectOrigin } from "@/lib/media/storage/csp";

test("direct-upload CSP permits only the exact account-scoped R2 origin", () => {
  assert.equal(directUploadConnectOrigin({ MEDIA_STORAGE_DRIVER: "local" }), null);
  assert.equal(directUploadConnectOrigin({
    MEDIA_STORAGE_DRIVER: "s3", MEDIA_STORAGE_PROVIDER: "r2",
    MEDIA_S3_ENDPOINT: "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com",
  }), "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com");
  for (const endpoint of ["http://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com", "https://example.com", "https://0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com/path", "https://user:pass@0123456789abcdef0123456789abcdef.r2.cloudflarestorage.com"]) {
    assert.throws(() => directUploadConnectOrigin({ MEDIA_STORAGE_DRIVER: "s3", MEDIA_STORAGE_PROVIDER: "r2", MEDIA_S3_ENDPOINT: endpoint }));
  }
});
