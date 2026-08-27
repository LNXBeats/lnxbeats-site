import assert from "node:assert/strict";
import test from "node:test";

import {
  handleProductImageAltUpdate,
  handleProductImageDelete,
  handleProductImageUpload,
  type ProductImageMutationDependencies,
} from "@/lib/shop/product-image-route-handler";
import { PRODUCT_IMAGE_DELETION_CONFIRMATION } from "@/lib/shop/product-domain";
import { ProductImageError } from "@/lib/shop/product-image";
import { ProductImageRequestError } from "@/lib/shop/product-image-request";

const baseUrl = "http://127.0.0.1:31750";
const productId = "10000000-0000-4000-8000-000000000001";
const assetId = "20000000-0000-4000-8000-000000000001";

function request(method: string, body?: BodyInit, contentType?: string, origin = baseUrl) {
  return new Request(`${baseUrl}/api/admin/boutique/products/${productId}/image`, {
    method,
    headers: {
      origin,
      ...(contentType ? { "content-type": contentType } : {}),
    },
    body,
  });
}

function validForm() {
  const form = new FormData();
  form.set("expectedLockVersion", "1");
  form.set("expectedAssetId", "");
  form.set("alt", "Coffret LNX Beats");
  form.set("rightsConfirmed", "on");
  form.set("image", new File(["image"], "product.jpg", { type: "image/jpeg" }));
  return form;
}

function harness(overrides: Partial<ProductImageMutationDependencies> = {}) {
  let adminCalls = 0;
  let readCalls = 0;
  let replaceInput: Parameters<ProductImageMutationDependencies["replace"]>[0] | null = null;
  const dependencies: ProductImageMutationDependencies = {
    baseUrl: () => baseUrl,
    sameOrigin: (incoming, expected) => incoming.headers.get("origin") === expected,
    admin: async () => {
      adminCalls += 1;
      return { user: { id: "30000000-0000-4000-8000-000000000001" } };
    },
    readForm: async () => {
      readCalls += 1;
      return validForm();
    },
    readJson: async (incoming) => {
      readCalls += 1;
      return incoming.json();
    },
    replace: async (input) => {
      replaceInput = input;
      return { assetId, slug: "coffret-lnx" };
    },
    updateAlt: async () => ({ assetId, slug: "coffret-lnx" }),
    remove: async () => ({ slug: "coffret-lnx" }),
    ...overrides,
  };
  return {
    dependencies,
    counts: () => ({ adminCalls, readCalls }),
    replaceInput: () => replaceInput,
  };
}

test("hostile origin and non-admin are refused before multipart parsing", async () => {
  const hostile = harness();
  const hostileResponse = await handleProductImageUpload(request("POST", undefined, undefined, "https://example.com"), productId, hostile.dependencies);
  assert.equal(hostileResponse.status, 403);
  assert.deepEqual(hostile.counts(), { adminCalls: 0, readCalls: 0 });

  const denied = harness({ admin: async () => { throw new Error("NEXT_REDIRECT: /compte?acces=refuse"); } });
  await assert.rejects(handleProductImageUpload(request("POST"), productId, denied.dependencies), /NEXT_REDIRECT/);
  assert.equal(denied.counts().readCalls, 0);
});

test("valid upload accepts only the fixed product context and returns an admin-local redirect", async () => {
  const current = harness();
  const response = await handleProductImageUpload(request("POST"), productId, current.dependencies);
  assert.equal(response.status, 200);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.assetId, assetId);
  assert.equal(payload.location, `${baseUrl}/admin/boutique/coffret-lnx?etat=image-enregistree`);
  assert.equal(current.replaceInput()?.productId, productId);
  assert.equal(current.replaceInput()?.expectedLockVersion, "1");
  assert.equal(current.replaceInput()?.actorAdminId, "30000000-0000-4000-8000-000000000001");
  assert.equal(current.replaceInput()?.rightsConfirmed, true);
});

test("multipart payload is closed and duplicate or arbitrary asset fields are refused", async () => {
  for (const mutate of [
    (form: FormData) => form.set("assetId", assetId),
    (form: FormData) => form.append("alt", "second"),
    (form: FormData) => form.set("rightsConfirmed", "yes"),
    (form: FormData) => form.delete("image"),
  ]) {
    const form = validForm();
    mutate(form);
    const current = harness({ readForm: async () => form });
    const response = await handleProductImageUpload(request("POST"), productId, current.dependencies);
    assert.equal(response.status, 400);
    assert.equal(current.replaceInput(), null);
  }
});

test("route maps transport, image, missing product and published product failures without provider details", async () => {
  const cases = [
    { error: new ProductImageRequestError("TRANSPORT_TOO_LARGE"), status: 413, state: "image-trop-lourde" },
    { error: new ProductImageError("UNSUPPORTED_FORMAT"), status: 422, state: "image-format" },
    { error: new ProductImageError("NOT_FOUND"), status: 404, state: "image-produit-absent" },
    { error: new ProductImageError("NOT_DRAFT"), status: 409, state: "image-produit-publie" },
    { error: new ProductImageError("SHARED_ASSET"), status: 409, state: "image-partagee" },
  ];
  for (const item of cases) {
    const current = harness({ readForm: async () => { throw item.error; } });
    const response = await handleProductImageUpload(request("POST"), productId, current.dependencies);
    assert.equal(response.status, item.status);
    assert.equal((await response.json()).state, item.state);
  }
});

test("alt update and deletion accept only exact closed JSON confirmations", async () => {
  const altHarness = harness();
  const altResponse = await handleProductImageAltUpdate(
    request("PATCH", JSON.stringify({ expectedLockVersion: 1, expectedAssetId: assetId, alt: "Nouveau texte" }), "application/json"),
    productId,
    altHarness.dependencies,
  );
  assert.equal(altResponse.status, 200);

  const openAlt = await handleProductImageAltUpdate(
    request("PATCH", JSON.stringify({ expectedLockVersion: 1, expectedAssetId: assetId, alt: "Nouveau texte", role: "ADMIN" }), "application/json"),
    productId,
    harness().dependencies,
  );
  assert.equal(openAlt.status, 400);

  const deleteHarness = harness();
  const deleted = await handleProductImageDelete(
    request("DELETE", JSON.stringify({ expectedLockVersion: 1, expectedAssetId: assetId, confirmation: PRODUCT_IMAGE_DELETION_CONFIRMATION }), "application/json"),
    productId,
    deleteHarness.dependencies,
  );
  assert.equal(deleted.status, 200);

  const refused = await handleProductImageDelete(
    request("DELETE", JSON.stringify({ expectedLockVersion: 1, expectedAssetId: assetId, confirmation: "yes" }), "application/json"),
    productId,
    harness().dependencies,
  );
  assert.equal(refused.status, 400);
  assert.equal((await refused.json()).state, "image-confirmation");
});
