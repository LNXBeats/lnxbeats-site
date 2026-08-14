import assert from "node:assert/strict";
import test from "node:test";

import sharp from "sharp";

import { orderOffer } from "@/data/order-offer";
import {
  detectImageType,
  detectOrderAudioType,
  normalizeOrderImage,
  OrderUploadError,
  validateOrderAudioIdentity,
} from "@/lib/orders/upload";

async function raster(format: "jpeg" | "png" | "webp", width = 24, height = 18) {
  const image = sharp({ create: { width, height, channels: 3, background: { r: 25, g: 50, b: 75 } } });
  return image[format]().toBuffer();
}

async function expectUploadCode(operation: Promise<unknown>, code: string) {
  await assert.rejects(operation, (error: unknown) => error instanceof OrderUploadError && error.code === code);
}

test("détecte et réencode JPEG, PNG et WebP en WebP privé", async () => {
  for (const [format, filename, mime, detected] of [
    ["jpeg", "photo.jpg", "image/jpeg", "JPEG"],
    ["png", "photo.png", "image/png", "PNG"],
    ["webp", "photo.webp", "image/webp", "WEBP"],
  ] as const) {
    const input = await raster(format);
    assert.equal(detectImageType(input), detected);
    const normalized = await normalizeOrderImage({ buffer: input, originalFilename: filename, declaredMimeType: mime });
    assert.equal(normalized.mimeType, "image/webp");
    assert.equal(normalized.width, 24);
    assert.equal(normalized.height, 18);
    assert.equal(normalized.checksum.length, 64);
    const metadata = await sharp(normalized.buffer).metadata();
    assert.equal(metadata.format, "webp");
    assert.equal(metadata.exif, undefined);
  }
});

test("retire les métadonnées et le chemin du nom original", async () => {
  const jpeg = await sharp({ create: { width: 20, height: 20, channels: 3, background: "red" } })
    .withMetadata({ exif: { IFD0: { Artist: "information-privee" } } })
    .jpeg()
    .toBuffer();
  const normalized = await normalizeOrderImage({ buffer: jpeg, originalFilename: "../../portrait.jpg", declaredMimeType: "image/jpeg" });
  assert.equal(normalized.originalFilename, "portrait.jpg");
  assert.equal((await sharp(normalized.buffer).metadata()).exif, undefined);
});

test("refuse signature, extension, MIME et faux fichier", async () => {
  const jpeg = await raster("jpeg");
  await expectUploadCode(normalizeOrderImage({ buffer: Buffer.from("not-an-image"), originalFilename: "fake.jpg", declaredMimeType: "image/jpeg" }), "UNSUPPORTED_SIGNATURE");
  await expectUploadCode(normalizeOrderImage({ buffer: Buffer.from("GIF89a"), originalFilename: "animation.gif", declaredMimeType: "image/gif" }), "UNSUPPORTED_SIGNATURE");
  await expectUploadCode(normalizeOrderImage({ buffer: jpeg, originalFilename: "photo.png", declaredMimeType: "image/jpeg" }), "EXTENSION_MISMATCH");
  await expectUploadCode(normalizeOrderImage({ buffer: jpeg, originalFilename: "photo.jpg", declaredMimeType: "image/png" }), "MIME_MISMATCH");
  await expectUploadCode(normalizeOrderImage({ buffer: Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x00]), originalFilename: "fake.jpg", declaredMimeType: "image/jpeg" }), "DECODE_FAILED");
});

test("refuse le poids et les dimensions excessifs", async () => {
  const oversized = Buffer.alloc(orderOffer.maxPhotoBytes + 1);
  oversized[0] = 0xff; oversized[1] = 0xd8; oversized[2] = 0xff;
  await expectUploadCode(normalizeOrderImage({ buffer: oversized, originalFilename: "large.jpg", declaredMimeType: "image/jpeg" }), "FILE_TOO_LARGE");

  const tooWide = await raster("png", orderOffer.maxImageWidth + 1, 1);
  await expectUploadCode(normalizeOrderImage({ buffer: tooWide, originalFilename: "wide.png", declaredMimeType: "image/png" }), "DIMENSIONS_TOO_LARGE");
});

test("valide la signature, l’extension et le MIME réels des masters MP3/WAV", () => {
  const mp3 = Buffer.from([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00]);
  const wav = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WAVEfmt ")]);
  assert.equal(detectOrderAudioType(mp3), "MP3");
  assert.equal(detectOrderAudioType(wav), "WAV");
  assert.deepEqual(validateOrderAudioIdentity({
    signature: mp3,
    originalFilename: "../../master.mp3",
    declaredMimeType: "audio/mpeg",
    sizeBytes: 1024,
  }), {
    originalFilename: "master.mp3",
    detectedType: "MP3",
    mimeType: "audio/mpeg",
    extension: "mp3",
  });
  assert.equal(validateOrderAudioIdentity({
    signature: wav,
    originalFilename: "voix.wav",
    declaredMimeType: "audio/x-wav",
    sizeBytes: 2048,
  }).mimeType, "audio/wav");
});

test("refuse les faux audios, les incohérences MIME/extension et plus de 200 Mo", () => {
  const mp3 = Buffer.from("ID3fixture");
  const call = (input: Parameters<typeof validateOrderAudioIdentity>[0], code: string) => {
    assert.throws(
      () => validateOrderAudioIdentity(input),
      (error: unknown) => error instanceof OrderUploadError && error.code === code,
    );
  };
  call({ signature: Buffer.from("not audio"), originalFilename: "fake.mp3", declaredMimeType: "audio/mpeg", sizeBytes: 10 }, "UNSUPPORTED_SIGNATURE");
  call({ signature: mp3, originalFilename: "fake.wav", declaredMimeType: "audio/mpeg", sizeBytes: 10 }, "EXTENSION_MISMATCH");
  call({ signature: mp3, originalFilename: "fake.mp3", declaredMimeType: "application/octet-stream", sizeBytes: 10 }, "MIME_MISMATCH");
  call({ signature: mp3, originalFilename: "large.mp3", declaredMimeType: "audio/mpeg", sizeBytes: orderOffer.maxDeliveryBytes + 1 }, "FILE_TOO_LARGE");
});
