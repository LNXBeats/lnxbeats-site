import assert from "node:assert/strict";
import test from "node:test";

import nativeSharp from "sharp";

import applicationSharp, {
  APPLICATION_SHARP_CACHE,
  APPLICATION_SHARP_CONCURRENCY,
  configureApplicationSharp,
  getApplicationSharpState,
} from "@/lib/media/sharp";
import { normalizeAdminImage } from "@/lib/media/admin-image";
import { normalizeOrderImage } from "@/lib/orders/upload";

test("configure le singleton Sharp une seule fois avec les limites applicatives", () => {
  const first = configureApplicationSharp();
  const second = configureApplicationSharp();

  assert.deepEqual(APPLICATION_SHARP_CACHE, { memoryMiB: 0, files: 0, items: 0 });
  assert.equal(APPLICATION_SHARP_CONCURRENCY, 1);
  assert.strictEqual(first, second);
  assert.strictEqual(first, applicationSharp);
  assert.strictEqual(first, nativeSharp);
  assert.deepEqual(getApplicationSharpState(), {
    configurationApplications: 1,
    cache: { memoryMiB: 0, files: 0, items: 0 },
    concurrency: 1,
  });
});

test("les transformations commande et administration restent opérationnelles", async () => {
  const source = await applicationSharp({
    create: {
      width: 32,
      height: 24,
      channels: 3,
      background: { r: 18, g: 36, b: 54 },
    },
  }).jpeg().toBuffer();

  const orderImage = await normalizeOrderImage({
    buffer: source,
    originalFilename: "photo.jpg",
    declaredMimeType: "image/jpeg",
  });
  assert.deepEqual(
    { format: (await applicationSharp(orderImage.buffer).metadata()).format, width: orderImage.width, height: orderImage.height },
    { format: "webp", width: 32, height: 24 },
  );

  const adminImage = await normalizeAdminImage(
    new File([source], "cover.jpg", { type: "image/jpeg" }),
    "contained-product",
  );
  assert.deepEqual(
    { format: (await applicationSharp(adminImage.bytes).metadata()).format, width: adminImage.width, height: adminImage.height },
    { format: "webp", width: 32, height: 24 },
  );
  assert.deepEqual(getApplicationSharpState(), {
    configurationApplications: 1,
    cache: { memoryMiB: 0, files: 0, items: 0 },
    concurrency: 1,
  });
});
