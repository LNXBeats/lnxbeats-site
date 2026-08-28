import assert from "node:assert/strict";
import test from "node:test";

import {
  ADMIN_PRODUCT_EDITOR_FORM_FIELDS,
  ProductAdminFormError,
  adminProductEditorPayload,
  assertAdminProductConfirmation,
  strictAdminProductFormData,
} from "@/lib/shop/product-admin-form";
import { MusicPricingValidationError } from "@/lib/pricing/domain";

function productForm(overrides: Record<string, string> = {}) {
  return {
    slug: "vinyle-lnx",
    title: "Vinyle LNX",
    description: "Un produit physique administré en euros.",
    price: "25,00",
    currency: "EUR",
    trackInventory: "on",
    stock: "10",
    shippingRequired: "on",
    shippingPrice: "5,00",
    shippingWeightGrams: "250",
    position: "1",
    ...overrides,
  };
}

function asFormData(values: Record<string, string>) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(values)) formData.append(key, value);
  return formData;
}

test("the closed form boundary ignores only React action metadata", () => {
  const formData = asFormData({
    "$ACTION_ID_productStock": "",
    productId: "11111111-1111-4111-8111-111111111111",
    lockVersion: "1",
    delta: "+5",
    reason: "Réception de cinq exemplaires",
    confirmation: "CONFIRM_PRODUCT_STOCK_ADJUSTMENT",
  });
  assert.deepEqual(
    strictAdminProductFormData(formData, ["productId", "lockVersion", "delta", "reason", "confirmation"]),
    {
      productId: "11111111-1111-4111-8111-111111111111",
      lockVersion: "1",
      delta: "+5",
      reason: "Réception de cinq exemplaires",
      confirmation: "CONFIRM_PRODUCT_STOCK_ADJUSTMENT",
    },
  );

  const extra = asFormData({ productId: "id", status: "PUBLISHED" });
  assert.throws(() => strictAdminProductFormData(extra, ["productId"]), /Formulaire produit invalide/);

  const duplicate = asFormData({ productId: "id" });
  duplicate.append("productId", "other");
  assert.throws(() => strictAdminProductFormData(duplicate, ["productId"]), /Formulaire produit invalide/);

  const file = new FormData();
  file.append("productId", new File(["x"], "x.txt", { type: "text/plain" }));
  assert.throws(() => strictAdminProductFormData(file, ["productId"]), /Formulaire produit invalide/);
});

test("stock confirmation is exact and absent confirmation fails closed", () => {
  assert.doesNotThrow(() => assertAdminProductConfirmation(
    "CONFIRM_PRODUCT_STOCK_ADJUSTMENT",
    "CONFIRM_PRODUCT_STOCK_ADJUSTMENT",
  ));
  for (const value of [undefined, "", "CONFIRM_PRODUCT_PUBLICATION", "confirm_product_stock_adjustment"]) {
    assert.throws(
      () => assertAdminProductConfirmation(value, "CONFIRM_PRODUCT_STOCK_ADJUSTMENT"),
      (error: unknown) => error instanceof ProductAdminFormError && error.code === "CONFIRMATION_REQUIRED",
    );
  }
});

test("product prices are parsed from human EUR input into exact integer cents", () => {
  const accepted = new Map([
    ["25", 2_500],
    ["25,00", 2_500],
    ["25.00", 2_500],
    ["5,50", 550],
  ]);
  for (const [price, expected] of accepted) {
    const input = strictAdminProductFormData(asFormData(productForm({ price })), ADMIN_PRODUCT_EDITOR_FORM_FIELDS);
    assert.equal(adminProductEditorPayload(input).priceCents, expected);
  }

  const complete = strictAdminProductFormData(asFormData(productForm()), ADMIN_PRODUCT_EDITOR_FORM_FIELDS);
  assert.deepEqual(
    { priceCents: adminProductEditorPayload(complete).priceCents, shippingPriceCents: adminProductEditorPayload(complete).shippingPriceCents },
    { priceCents: 2_500, shippingPriceCents: 500 },
  );
  const shippingDecimal = strictAdminProductFormData(
    asFormData(productForm({ shippingPrice: "5,50" })),
    ADMIN_PRODUCT_EDITOR_FORM_FIELDS,
  );
  assert.equal(adminProductEditorPayload(shippingDecimal).shippingPriceCents, 550);
  assert.equal(adminProductEditorPayload(complete).shippingWeightGrams, 250);
});

test("product price input remains nullable in DRAFT and fails closed on altered amounts", () => {
  const withoutPrice = strictAdminProductFormData(asFormData(productForm({ price: "" })), ADMIN_PRODUCT_EDITOR_FORM_FIELDS);
  assert.equal(adminProductEditorPayload(withoutPrice).priceCents, null);

  for (const price of ["0", "-1", "+25", "1,999", "NaN", "texte", "100000,01"] as const) {
    const input = strictAdminProductFormData(asFormData(productForm({ price })), ADMIN_PRODUCT_EDITOR_FORM_FIELDS);
    assert.throws(() => adminProductEditorPayload(input), MusicPricingValidationError);
  }

  for (const shippingPrice of ["-1", "+5", "1,999", "NaN", "texte", "10000,01"] as const) {
    const input = strictAdminProductFormData(
      asFormData(productForm({ shippingPrice })),
      ADMIN_PRODUCT_EDITOR_FORM_FIELDS,
    );
    assert.throws(() => adminProductEditorPayload(input), MusicPricingValidationError);
  }

  const noShipping: Record<string, string> = productForm({ shippingPrice: "texte" });
  delete noShipping.shippingRequired;
  const closed = strictAdminProductFormData(asFormData(noShipping), ADMIN_PRODUCT_EDITOR_FORM_FIELDS);
  assert.equal(adminProductEditorPayload(closed).shippingPriceCents, 0);
  assert.equal(adminProductEditorPayload(closed).shippingWeightGrams, null);

  const altered = asFormData({ ...productForm(), priceCents: "2500" });
  assert.throws(
    () => strictAdminProductFormData(altered, ADMIN_PRODUCT_EDITOR_FORM_FIELDS),
    /Formulaire produit invalide/,
  );
});
