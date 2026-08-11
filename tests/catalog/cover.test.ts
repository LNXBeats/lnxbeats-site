import assert from "node:assert/strict";
import test from "node:test";

import sharp from "sharp";

import {
  CATALOG_COVER_MAXIMUM_BYTES,
  CatalogCoverConflictError,
  CatalogCoverError,
  catalogCoverVersionMatches,
  normalizeCatalogCover,
} from "@/lib/catalog/cover";

async function expectCoverError(file: File, code: CatalogCoverError["code"]) {
  await assert.rejects(
    normalizeCatalogCover(file),
    (error: unknown) => error instanceof CatalogCoverError && error.code === code,
  );
}

async function fixture(format: "jpeg" | "png" | "webp", width = 3_000, height = 3_000) {
  const pipeline = sharp({
    create: { width, height, channels: 3, background: { r: 28, g: 24, b: 20 } },
  });
  if (format === "jpeg") return pipeline.jpeg({ quality: 90 }).toBuffer();
  if (format === "png") return pipeline.png({ compressionLevel: 9 }).toBuffer();
  return pipeline.webp({ quality: 90 }).toBuffer();
}

for (const format of ["jpeg", "png", "webp"] as const) {
  test(`a genuine 3000x3000 ${format.toUpperCase()} below 10 MB is accepted`, async () => {
    const bytes = await fixture(format);
    const mimeType = `image/${format}`;
    const extension = format === "jpeg" ? "jpg" : format;
    assert.ok(bytes.length < CATALOG_COVER_MAXIMUM_BYTES);
    const normalized = await normalizeCatalogCover(new File([bytes], `cover.${extension}`, { type: mimeType }));
    const metadata = await sharp(normalized.bytes).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.width, 1_600);
    assert.equal(metadata.height, 1_600);
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.icc, undefined);
  });
}

test("a source above 10 MB is rejected before decode", async () => {
  const bytes = Buffer.alloc(CATALOG_COVER_MAXIMUM_BYTES + 1);
  bytes.set([0xff, 0xd8, 0xff]);
  await expectCoverError(new File([bytes], "large.jpg", { type: "image/jpeg" }), "FILE_TOO_LARGE");
});

test("an image above 40 million pixels is rejected", async () => {
  const bytes = await fixture("png", 6_500, 6_200);
  assert.ok(bytes.length < CATALOG_COVER_MAXIMUM_BYTES);
  await expectCoverError(new File([bytes], "too-many-pixels.png", { type: "image/png" }), "TOO_MANY_PIXELS");
});

test("fake JPEG, SVG, GIF, forged MIME and corrupted images are rejected", async () => {
  await expectCoverError(new File(["not a jpeg"], "fake.jpg", { type: "image/jpeg" }), "UNSUPPORTED_FORMAT");
  await expectCoverError(new File(["<svg xmlns=\"http://www.w3.org/2000/svg\"></svg>"], "cover.svg", { type: "image/svg+xml" }), "UNSUPPORTED_FORMAT");
  await expectCoverError(new File(["GIF89a"], "cover.gif", { type: "image/gif" }), "UNSUPPORTED_FORMAT");

  const png = await fixture("png", 32, 32);
  await expectCoverError(new File([png], "forged.jpg", { type: "image/jpeg" }), "MIME_MISMATCH");
  await expectCoverError(new File([Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x00])], "corrupted.jpg", { type: "image/jpeg" }), "UNREADABLE_IMAGE");
});

test("cover concurrency compares only the observed active cover", () => {
  const coverA = "00000000-0000-0000-0000-00000000000a";
  const coverB = "00000000-0000-0000-0000-00000000000b";
  assert.equal(catalogCoverVersionMatches(null, null), true, "An unchanged empty cover slot must remain writable.");
  assert.equal(catalogCoverVersionMatches(coverA, coverA), true, "The observed cover may be replaced.");
  assert.equal(catalogCoverVersionMatches(null, coverA), false, "A concurrent first cover must conflict.");
  assert.equal(catalogCoverVersionMatches(coverA, coverB), false, "A stale replacement must conflict.");
  assert.equal(new CatalogCoverConflictError(coverB).message, "La cover a été modifiée depuis l’ouverture de cette fiche.");
});
