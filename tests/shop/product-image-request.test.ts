import assert from "node:assert/strict";
import test from "node:test";

import {
  PRODUCT_IMAGE_TRANSPORT_MAXIMUM_BYTES,
  ProductImageRequestError,
  readProductImageFormData,
  readProductImageJson,
} from "@/lib/shop/product-image-request";

async function encodedProductForm(contentLength: "exact" | "zero" | "absent" = "exact") {
  const form = new FormData();
  form.set("expectedLockVersion", "1");
  form.set("expectedAssetId", "");
  form.set("alt", "Visuel du coffret");
  form.set("rightsConfirmed", "on");
  form.set("image", new File(["real bytes"], "coffret.jpg", { type: "image/jpeg" }));
  const encoded = new Request("http://127.0.0.1:31750/api/admin/boutique/products/id/image", { method: "POST", body: form });
  const body = Buffer.from(await encoded.arrayBuffer());
  const headers = new Headers({ "content-type": encoded.headers.get("content-type")! });
  if (contentLength === "exact") headers.set("content-length", String(body.length));
  if (contentLength === "zero") headers.set("content-length", "0");
  return new Request(encoded.url, { method: "POST", headers, body });
}

test("product image multipart parses exact, chunked and Safari zero-length transports", async () => {
  for (const mode of ["exact", "zero", "absent"] as const) {
    const form = await readProductImageFormData(await encodedProductForm(mode));
    assert.equal(form.get("alt"), "Visuel du coffret");
    assert.ok(form.get("image") instanceof File);
  }
});

test("product image transport rejects invalid multipart and declared overflow before parsing", async () => {
  await assert.rejects(
    readProductImageFormData(new Request("http://127.0.0.1:31750", {
      method: "POST",
      headers: { "content-type": "multipart/form-data" },
      body: "bad",
    })),
    (error: unknown) => error instanceof ProductImageRequestError && error.code === "INVALID_MULTIPART",
  );
  const request = await encodedProductForm("absent");
  const body = Buffer.from(await request.arrayBuffer());
  await assert.rejects(
    readProductImageFormData(new Request(request.url, {
      method: "POST",
      headers: {
        "content-type": request.headers.get("content-type")!,
        "content-length": String(PRODUCT_IMAGE_TRANSPORT_MAXIMUM_BYTES + 1),
      },
      body,
    })),
    (error: unknown) => error instanceof ProductImageRequestError && error.code === "TRANSPORT_TOO_LARGE",
  );
});

test("bounded JSON accepts small objects and rejects non-JSON or oversized declarations", async () => {
  const valid = new Request("http://127.0.0.1:31750", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedLockVersion: 1, expectedAssetId: "", alt: "Coffret" }),
  });
  assert.deepEqual(await readProductImageJson(valid), { expectedLockVersion: 1, expectedAssetId: "", alt: "Coffret" });
  await assert.rejects(
    readProductImageJson(new Request("http://127.0.0.1:31750", {
      method: "PATCH",
      headers: { "content-type": "text/plain" },
      body: "{}",
    })),
    ProductImageRequestError,
  );
  await assert.rejects(
    readProductImageJson(new Request("http://127.0.0.1:31750", {
      method: "PATCH",
      headers: { "content-type": "application/json", "content-length": "3000" },
      body: "{}",
    })),
    ProductImageRequestError,
  );
});
