import assert from "node:assert/strict";
import test from "node:test";

import { CatalogCoverRequestError, readCatalogCoverFormData } from "@/lib/catalog/cover-request";

async function multipartRequest(withLength: boolean | "zero") {
  const form = new FormData();
  form.set("projectId", "00000000-0000-0000-0000-000000000001");
  form.set("slug", "projet-qa");
  form.set("cover", new File(["payload"], "pochette officielle.png", { type: "image/png" }));
  const encoded = new Request("http://127.0.0.1:3103/api/admin/catalogue/cover", { method: "POST", body: form });
  const body = Buffer.from(await encoded.arrayBuffer());
  const headers = new Headers({ "content-type": encoded.headers.get("content-type")! });
  if (withLength) headers.set("content-length", withLength === "zero" ? "0" : String(body.length));
  return new Request(encoded.url, { method: "POST", headers, body });
}

test("native browser-style multipart is parsed with its original boundary", async () => {
  const form = await readCatalogCoverFormData(await multipartRequest(true));
  assert.equal(form.get("slug"), "projet-qa");
  assert.ok(form.get("cover") instanceof File);
});

test("chunked multipart fallback remains bounded and parseable", async () => {
  const form = await readCatalogCoverFormData(await multipartRequest(false));
  assert.equal(form.get("projectId"), "00000000-0000-0000-0000-000000000001");
});

test("Safari multipart with Content-Length zero uses the bounded stream fallback", async () => {
  const request = await multipartRequest("zero");
  Object.defineProperty(request, "formData", {
    value: async () => { throw new Error("The original parser must not be used for a contradictory zero length."); },
  });
  const form = await readCatalogCoverFormData(request);
  assert.equal(form.get("slug"), "projet-qa");
  const file = form.get("cover");
  assert.ok(file instanceof File);
  assert.equal(file.size, 7);
});

test("multipart without a boundary is refused", async () => {
  await assert.rejects(
    readCatalogCoverFormData(new Request("http://127.0.0.1:3103", { method: "POST", headers: { "content-type": "multipart/form-data" }, body: "invalid" })),
    (error: unknown) => error instanceof CatalogCoverRequestError && error.code === "INVALID_MULTIPART",
  );
});

test("a positive but false Content-Length cannot bypass the actual byte bound", async () => {
  const request = await multipartRequest(false);
  const body = Buffer.from(await request.arrayBuffer());
  const lied = new Request(request.url, {
    method: "POST",
    headers: {
      "content-type": request.headers.get("content-type")!,
      "content-length": String(body.length - 1),
    },
    body,
  });
  await assert.rejects(
    readCatalogCoverFormData(lied),
    (error: unknown) => error instanceof CatalogCoverRequestError && error.code === "INVALID_MULTIPART",
  );
});
