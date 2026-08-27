import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import sharp from "sharp";

import { assertMediaStorageKey } from "@/lib/media/storage/policy";
import {
  PRODUCT_IMAGE_MAXIMUM_BYTES,
  ProductImageError,
  normalizeProductImage,
  parseProductImageAlt,
  productImageVersionMatches,
} from "@/lib/shop/product-image";

async function fixture(format: "jpeg" | "png" | "webp", width = 2_400, height = 1_200) {
  const pipeline = sharp({ create: { width, height, channels: 3, background: { r: 32, g: 26, b: 18 } } });
  if (format === "jpeg") return pipeline.jpeg({ quality: 88 }).toBuffer();
  if (format === "png") return pipeline.png({ compressionLevel: 9 }).toBuffer();
  return pipeline.webp({ quality: 88 }).toBuffer();
}

async function expectImageError(file: File, code: ProductImageError["code"]) {
  await assert.rejects(
    normalizeProductImage(file),
    (error: unknown) => error instanceof ProductImageError && error.code === code,
  );
}

for (const format of ["jpeg", "png", "webp"] as const) {
  test(`product image accepts a genuine ${format.toUpperCase()} and preserves its full ratio`, async () => {
    const bytes = await fixture(format);
    const extension = format === "jpeg" ? "jpg" : format;
    const normalized = await normalizeProductImage(new File([bytes], `produit.${extension}`, { type: `image/${format}` }));
    const metadata = await sharp(normalized.bytes).metadata();
    assert.deepEqual({ format: metadata.format, width: metadata.width, height: metadata.height }, {
      format: "webp",
      width: 1_600,
      height: 800,
    });
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.icc, undefined);
  });
}

test("a small portrait product image is not enlarged or destructively cropped", async () => {
  const bytes = await fixture("png", 320, 640);
  const normalized = await normalizeProductImage(new File([bytes], "portrait.png", { type: "image/png" }));
  assert.deepEqual({ width: normalized.width, height: normalized.height }, { width: 320, height: 640 });
});

test("product image rejects forged formats, mismatched extensions, corruption and oversized bodies", async () => {
  await expectImageError(new File(["<svg></svg>"], "image.svg", { type: "image/svg+xml" }), "UNSUPPORTED_FORMAT");
  await expectImageError(new File(["not jpeg"], "fake.jpg", { type: "image/jpeg" }), "UNSUPPORTED_FORMAT");
  const png = await fixture("png", 32, 32);
  await expectImageError(new File([png], "forged.jpg", { type: "image/jpeg" }), "MIME_MISMATCH");
  await expectImageError(new File([png], "forged.jpg", { type: "image/png" }), "MIME_MISMATCH");
  await expectImageError(new File([Buffer.from([0xff, 0xd8, 0xff, 0x00])], "broken.jpg", { type: "image/jpeg" }), "UNREADABLE_IMAGE");
  const oversized = Buffer.alloc(PRODUCT_IMAGE_MAXIMUM_BYTES + 1);
  oversized.set([0xff, 0xd8, 0xff]);
  await expectImageError(new File([oversized], "large.jpg", { type: "image/jpeg" }), "FILE_TOO_LARGE");
});

test("alt text is mandatory, bounded and product image optimistic identity is exact", () => {
  assert.equal(parseProductImageAlt("  Coffret LNX Beats vu de face  "), "Coffret LNX Beats vu de face");
  assert.throws(() => parseProductImageAlt("   "), (error: unknown) => error instanceof ProductImageError && error.code === "INVALID_ALT");
  assert.throws(() => parseProductImageAlt("x".repeat(501)), (error: unknown) => error instanceof ProductImageError && error.code === "INVALID_ALT");
  const a = "10000000-0000-4000-8000-000000000001";
  const b = "10000000-0000-4000-8000-000000000002";
  assert.equal(productImageVersionMatches(null, null), true);
  assert.equal(productImageVersionMatches(a, a), true);
  assert.equal(productImageVersionMatches(null, a), false);
  assert.equal(productImageVersionMatches(a, b), false);
});

test("admin product image source keeps preview private and publication tied to position zero", async () => {
  const [route, page, service, imageService, component, css] = await Promise.all([
    readFile(new URL("../../app/api/admin/boutique/products/[productId]/image/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../../app/admin/boutique/[slug]/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../lib/shop/product-service.ts", import.meta.url), "utf8"),
    readFile(new URL("../../lib/shop/product-image.ts", import.meta.url), "utf8"),
    readFile(new URL("../../components/admin-product-image-form.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/admin/admin.css", import.meta.url), "utf8"),
  ]);
  assert.match(route, /await requireAdmin\(\)/);
  assert.match(route, /private, no-store/);
  assert.match(route, /x-content-type-options/);
  assert.match(page, /<h2>Visuel du produit<\/h2>/);
  assert.match(page, /position === 0/);
  assert.match(page, /IMAGE_MISSING: "visuel principal public avec texte alternatif requis"/);
  assert.match(service, /where: \{ position: 0 \}/);
  assert.match(imageService, /const stagedAsset = await prisma\.asset\.create[\s\S]*await writeCatalogImage/);
  assert.match(
    imageService,
    /async function removeNewObjectAfterFailure[\s\S]*prisma\.\$transaction[\s\S]*pg_advisory_xact_lock[\s\S]*transaction\.asset\.count[\s\S]*if \(!stillOrphaned\) return;[\s\S]*await removeCatalogImage/,
  );
  assert.match(imageService, /await removeCatalogImage\(candidate\)[\s\S]*await prisma\.asset\.deleteMany/);
  assert.doesNotMatch(imageService, /await transaction\.asset\.delete/);
  assert.match(imageService, /SHARED_ASSET/);
  assert.match(css, /admin-product-image__preview img[\s\S]*object-fit: contain/);
  assert.match(css, /admin-product-image__delete summary \{[^}]*min-height: 44px/);
  assert.match(component, /file\.arrayBuffer\(\)/);
  assert.match(component, /file\.size > PRODUCT_IMAGE_MAXIMUM_BYTES[\s\S]*file\.arrayBuffer\(\)/);
  assert.match(component, /currentImage && !selected/);
  assert.match(component, /JPEG, PNG ou WebP/);
  assert.match(component, /Nom/);
  assert.match(component, /Type/);
  assert.match(component, /Taille/);
  assert.doesNotThrow(() => assertMediaStorageKey("public", "catalog/images/10000000-0000-4000-8000-000000000001.webp"));
  assert.doesNotMatch(`${route}\n${component}`, /stripe|paypal|checkout\.sessions|PaymentIntent/i);
});
