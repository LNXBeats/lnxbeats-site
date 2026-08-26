import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertProductPublishable,
  countPublishableProductImages,
  getProductPublicationBlockers,
  normalizeProductSlug,
  parseProductEditorInput,
  parseProductLockVersion,
  parseStockAdjustmentInput,
  PRODUCT_ACTION_CONFIRMATIONS,
  ProductValidationError,
} from "../../lib/shop/product-domain";

const completeInput = {
  slug: "cd-histoires",
  title: "CD Histoires",
  description: "Un album physique LNX Beats.",
  priceCents: "2500",
  currency: "EUR",
  trackInventory: "on",
  stock: "12",
  shippingRequired: "on",
  shippingPriceCents: "500",
  position: "1",
};

test("normalizes a product slug without accepting reserved paths", () => {
  assert.equal(normalizeProductSlug("  Édition LNX — 2026  "), "edition-lnx-2026");
  assert.throws(() => parseProductEditorInput({ ...completeInput, slug: "nouveau" }), ProductValidationError);
});

test("parses only integer cents, EUR and coherent inventory values", () => {
  assert.deepEqual(parseProductEditorInput(completeInput), {
    slug: "cd-histoires",
    title: "CD Histoires",
    description: "Un album physique LNX Beats.",
    priceCents: 2500,
    currency: "EUR",
    trackInventory: true,
    stock: 12,
    shippingRequired: true,
    shippingPriceCents: 500,
    position: 1,
  });
  assert.throws(() => parseProductEditorInput({ ...completeInput, priceCents: "25.50" }), /nombre entier/);
  assert.throws(() => parseProductEditorInput({ ...completeInput, priceCents: "-1" }), /hors limites/);
  assert.throws(() => parseProductEditorInput({ ...completeInput, currency: "USD" }), /EUR/);
  assert.throws(() => parseProductEditorInput({ ...completeInput, stock: "-1" }), /hors limites/);
});

test("rejects an altered or open payload", () => {
  assert.throws(
    () => parseProductEditorInput({ ...completeInput, status: "PUBLISHED" }),
    (error: unknown) => error instanceof ProductValidationError && error.code === "UNEXPECTED_FIELD",
  );
  assert.throws(() => parseProductEditorInput({ ...completeInput, trackInventory: "false" }), /invalide/);
});

test("normalizes disabled inventory and shipping without trusting hidden values", () => {
  const parsed = parseProductEditorInput({
    ...completeInput,
    trackInventory: undefined,
    stock: "999999",
    shippingRequired: undefined,
    shippingPriceCents: "999999",
  });
  assert.equal(parsed.trackInventory, false);
  assert.equal(parsed.stock, null);
  assert.equal(parsed.shippingRequired, false);
  assert.equal(parsed.shippingPriceCents, 0);
});

test("requires a positive lock version and a reasoned non-zero stock adjustment", () => {
  assert.equal(parseProductLockVersion("1"), 1);
  assert.throws(() => parseProductLockVersion("0"), /hors limites/);
  assert.deepEqual(parseStockAdjustmentInput({ delta: "-2", reason: "Deux exemplaires endommagés" }), {
    delta: -2,
    reason: "Deux exemplaires endommagés",
  });
  assert.throws(() => parseStockAdjustmentInput({ delta: "0", reason: "Inventaire" }), /ne peut pas être nul/);
  assert.throws(() => parseStockAdjustmentInput({ delta: "1", reason: "ok", productId: "forged" }), /champ inattendu/);
});

test("keeps publication fail-closed until at least one image exists", () => {
  const state = {
    title: "CD Histoires",
    description: "Un album physique LNX Beats.",
    priceCents: 2500,
    currency: "EUR",
    trackInventory: true,
    stock: 12,
    shippingRequired: true,
    shippingPriceCents: 500,
    assetCount: 0,
  };
  assert.deepEqual(getProductPublicationBlockers(state), ["IMAGE_MISSING"]);
  assert.throws(() => assertProductPublishable(state), /ne peut pas être publié/);
  assert.doesNotThrow(() => assertProductPublishable({ ...state, assetCount: 1 }));
});

test("counts only public cleared product images with meaningful alt text", () => {
  const eligible = {
    visibility: "PUBLIC",
    type: "IMAGE",
    mimeType: "image/webp",
    alt: "CD LNX Beats vu de face",
    rightsStatus: "CLEARED",
  };
  assert.equal(countPublishableProductImages([eligible]), 1);
  assert.equal(countPublishableProductImages([{ ...eligible, visibility: "PRIVATE" }]), 0);
  assert.equal(countPublishableProductImages([{ ...eligible, type: "AUDIO" }]), 0);
  assert.equal(countPublishableProductImages([{ ...eligible, mimeType: "application/pdf" }]), 0);
  assert.equal(countPublishableProductImages([{ ...eligible, alt: null }]), 0);
  assert.equal(countPublishableProductImages([{ ...eligible, alt: "   " }]), 0);
  assert.equal(countPublishableProductImages([{ ...eligible, rightsStatus: "PENDING" }]), 0);
});

test("admin product surface has closed guards and no payment provider coupling", async () => {
  const [actions, productPage, service] = await Promise.all([
    readFile(new URL("../../app/admin/boutique/actions.ts", import.meta.url), "utf8"),
    readFile(new URL("../../app/admin/boutique/[slug]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../lib/shop/product-service.ts", import.meta.url), "utf8"),
  ]);
  assert.match(actions, /isSameOriginMutation/);
  assert.match(actions, /requireAdmin/);
  assert.match(actions, /strictFormData/);
  assert.match(service, /pg_advisory_xact_lock/);
  assert.match(service, /lockVersion: \{ increment: 1 \}/);
  assert.match(service, /values\.slug !== current\.slug/);
  assert.match(service, /SLUG_IMMUTABLE/);
  assert.match(service, /countPublishableProductImages\(current\.assets\.map/);
  assert.deepEqual(PRODUCT_ACTION_CONFIRMATIONS, {
    publish: "CONFIRM_PRODUCT_PUBLICATION",
    unpublish: "CONFIRM_PRODUCT_UNPUBLICATION",
    archive: "CONFIRM_PRODUCT_ARCHIVAL",
    stock: "CONFIRM_PRODUCT_STOCK_ADJUSTMENT",
  });
  assert.match(actions, /\["productId", "lockVersion", "confirmation"\]/);
  assert.match(actions, /\["productId", "lockVersion", "delta", "reason", "confirmation"\]/);
  assert.match(actions, /requireExactConfirmation\(input\.confirmation, expectedConfirmation\)/);
  assert.match(actions, /stockChangeConfirmed: input\.confirmation === PRODUCT_ACTION_CONFIRMATIONS\.stock/);
  assert.match(service, /stockConfigurationChanged && options\.stockChangeConfirmed !== true/);
  assert.match(
    actions,
    /requireExactConfirmation\(input\.confirmation, PRODUCT_ACTION_CONFIRMATIONS\.stock\)/,
  );
  for (const key of Object.keys(PRODUCT_ACTION_CONFIRMATIONS)) {
    assert.match(
      productPage,
      new RegExp(`name="confirmation" value=\\{PRODUCT_ACTION_CONFIRMATIONS\\.${key}\\} required`),
    );
  }
  assert.equal((productPage.match(/name="confirmation"/g) ?? []).length, 5);
  assert.doesNotMatch(productPage, /\b(?:checked|defaultChecked)=/);
  assert.doesNotMatch(`${actions}\n${service}`, /stripe|paypal|PaymentIntent|checkout\.sessions/i);
});
