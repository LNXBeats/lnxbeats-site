import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import sharp from "sharp";

import { orderOffer } from "@/data/order-offer";
import {
  ORDER_PHOTO_MULTIPART_MAX_BYTES,
  ORDER_PHOTO_MULTIPART_OVERHEAD_BYTES,
} from "@/data/order-photo-upload";
import { getMemoryDiagnosticCounters } from "@/lib/memory-diagnostics";
import {
  getOrderPhotoMultipartAdmissionState,
  ORDER_PHOTO_MULTIPART_CONCURRENCY,
  ORDER_PHOTO_MULTIPART_QUEUE_LIMIT,
  withOrderPhotoMultipartAdmission,
} from "@/lib/orders/photo-upload-admission";
import {
  assertOrderPhotoMultipartHeaders,
  readOrderPhotoMultipartFormData,
} from "@/lib/orders/photo-upload-request";
import {
  cleanupUnattachedOrderImages,
  detectImageType,
  detectOrderAudioType,
  getOrderPhotoTransformState,
  normalizeOrderImage,
  orderPhotoCleanupDiagnostic,
  ORDER_PHOTO_TRANSFORM_CONCURRENCY,
  ORDER_PHOTO_TRANSFORM_QUEUE_LIMIT,
  OrderUploadError,
  planOrderPhotoAppend,
  processOrderImageBatch,
  validateOrderAudioIdentity,
  withOrderPhotoTransformSlot,
} from "@/lib/orders/upload";

async function raster(format: "jpeg" | "png" | "webp", width = 24, height = 18) {
  const image = sharp({ create: { width, height, channels: 3, background: { r: 25, g: 50, b: 75 } } });
  return image[format]().toBuffer();
}

async function multipartRequest(file: Uint8Array, rightsConfirmed = "true") {
  const body = new FormData();
  body.set("files", new File([Uint8Array.from(file)], "reference.jpg", { type: "image/jpeg" }));
  body.set("rightsConfirmed", rightsConfirmed);
  const encoded = new Request("http://127.0.0.1/api/orders/test/photos", { method: "POST", body });
  const bytes = await encoded.arrayBuffer();
  const headers = new Headers(encoded.headers);
  headers.set("content-length", String(bytes.byteLength));
  return new Request(encoded.url, { method: "POST", headers, body: bytes });
}

async function expectUploadCode(operation: Promise<unknown>, code: string) {
  await assert.rejects(operation, (error: unknown) => error instanceof OrderUploadError && error.code === code);
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, resolve, reject };
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

test("déduplique le contenu normalisé et ajoute après la dernière position, même après suppression", () => {
  const existing = [
    { checksum: "saved-first", position: 0 },
    { checksum: "saved-last", position: 4 },
    { checksum: null, position: 5 },
  ];
  const incoming = [
    { checksum: "saved-first", key: "retry" },
    { checksum: "new-photo", key: "new" },
    { checksum: "new-photo", key: "duplicate-new" },
    { checksum: "saved-last", key: "retry-last" },
    { checksum: "another-photo", key: "another" },
  ];
  const append = planOrderPhotoAppend(existing, incoming);
  assert.deepEqual(append.newPhotos.map(({ key }) => key), ["new", "another"]);
  assert.deepEqual(append.duplicatePhotos.map(({ key }) => key), ["retry", "duplicate-new", "retry-last"]);
  assert.equal(append.nextPosition, 6);
  assert.equal(planOrderPhotoAppend([], incoming).nextPosition, 0);
});

test("un retry au quota complet ne consomme aucun nouvel emplacement", () => {
  const existing = Array.from({ length: orderOffer.maxPhotos }, (_, position) => ({ checksum: `saved-${position}`, position }));
  const append = planOrderPhotoAppend(existing, [{ checksum: "saved-9", key: "new-attempt-only" }]);
  assert.equal(append.newPhotos.length, 0);
  assert.deepEqual(append.duplicatePhotos.map(({ key }) => key), ["new-attempt-only"]);
  assert.equal(existing.length, orderOffer.maxPhotos);
});

test("traite le lot maximal dans l’ordre sans conserver les buffers normalisés", async () => {
  const jpeg = await raster("jpeg");
  const events: string[] = [];
  const inputs = Array.from({ length: orderOffer.maxPhotos }, (_, index) => ({
    buffer: async () => {
      events.push(`read:${index}`);
      return jpeg;
    },
    originalFilename: `photo-${index}.jpg`,
    declaredMimeType: "image/jpeg",
  }));

  const persisted = await processOrderImageBatch(inputs, {
    persist: async (normalized, index) => {
      events.push(`persist:${index}`);
      assert.equal(normalized.originalFilename, `photo-${index}.jpg`);
      return { storageKey: `mock/${index}` };
    },
    cleanup: async () => assert.fail("aucun cleanup ne doit être nécessaire"),
  });

  assert.equal(persisted.length, orderOffer.maxPhotos);
  assert.deepEqual(persisted.map(({ storageKey }) => storageKey), Array.from(
    { length: orderOffer.maxPhotos },
    (_, index) => `mock/${index}`,
  ));
  assert.deepEqual(events, Array.from({ length: orderOffer.maxPhotos }, (_, index) => [
    `read:${index}`,
    `persist:${index}`,
  ]).flat());
  assert.equal(persisted.some((item) => "buffer" in item), false);
  assert.ok(Reflect.get(
    globalThis,
    Symbol.for("lnx-studio.orders.photo-transform-limiter.v1"),
  ));
  assert.deepEqual(getOrderPhotoTransformState(), {
    active: 0,
    queued: 0,
    concurrency: ORDER_PHOTO_TRANSFORM_CONCURRENCY,
    queueLimit: ORDER_PHOTO_TRANSFORM_QUEUE_LIMIT,
  });
});

test("borne globalement les transformations avec une file déterministe et bornée", async () => {
  const firstEntered = deferred<void>();
  const releaseFirst = deferred<void>();
  const secondEntered = deferred<void>();
  const releaseSecond = deferred<void>();
  let active = 0;
  let peak = 0;

  const guarded = async (entered: ReturnType<typeof deferred<void>>, release: ReturnType<typeof deferred<void>>) => {
    active += 1;
    peak = Math.max(peak, active);
    entered.resolve();
    await release.promise;
    active -= 1;
  };

  const first = withOrderPhotoTransformSlot(() => guarded(firstEntered, releaseFirst));
  await firstEntered.promise;
  const second = withOrderPhotoTransformSlot(() => guarded(secondEntered, releaseSecond));
  assert.deepEqual(getOrderPhotoTransformState(), {
    active: 1,
    queued: 1,
    concurrency: 1,
    queueLimit: 1,
  });

  await assert.rejects(
    withOrderPhotoTransformSlot(async () => undefined),
    (error: unknown) => error instanceof OrderUploadError
      && error.code === "IMAGE_PROCESSING_BUSY"
      && error.status === 503,
  );
  releaseFirst.resolve();
  await secondEntered.promise;
  assert.equal(active, 1);
  releaseSecond.resolve();
  await Promise.all([first, second]);

  assert.equal(peak, ORDER_PHOTO_TRANSFORM_CONCURRENCY);
  assert.equal(active, 0);
  assert.deepEqual(getOrderPhotoTransformState(), {
    active: 0,
    queued: 0,
    concurrency: 1,
    queueLimit: 1,
  });
});

test("retire immédiatement de la file une transformation annulée", async () => {
  const firstEntered = deferred<void>();
  const releaseFirst = deferred<void>();
  const controller = new AbortController();
  const first = withOrderPhotoTransformSlot(async () => {
    firstEntered.resolve();
    await releaseFirst.promise;
  });
  await firstEntered.promise;

  const queued = withOrderPhotoTransformSlot(async () => undefined, controller.signal);
  assert.equal(getOrderPhotoTransformState().queued, 1);
  controller.abort();
  await assert.rejects(
    queued,
    (error: unknown) => error instanceof OrderUploadError && error.code === "UPLOAD_ABORTED",
  );
  assert.equal(getOrderPhotoTransformState().queued, 0);

  releaseFirst.resolve();
  await first;
  assert.equal(getOrderPhotoTransformState().active, 0);
});

test("refuse une troisième admission multipart avant toute lecture formData", async () => {
  const firstEntered = deferred<void>();
  const releaseFirst = deferred<void>();
  const secondEntered = deferred<void>();
  const releaseSecond = deferred<void>();
  let firstFormDataCalls = 0;
  let secondFormDataCalls = 0;
  let thirdFormDataCalls = 0;

  const first = withOrderPhotoMultipartAdmission(async () => {
    firstFormDataCalls += 1;
    firstEntered.resolve();
    await releaseFirst.promise;
  });
  await firstEntered.promise;

  const second = withOrderPhotoMultipartAdmission(async () => {
    secondFormDataCalls += 1;
    secondEntered.resolve();
    await releaseSecond.promise;
  });
  assert.deepEqual(getOrderPhotoMultipartAdmissionState(), {
    active: 1,
    queued: 1,
    concurrency: ORDER_PHOTO_MULTIPART_CONCURRENCY,
    queueLimit: ORDER_PHOTO_MULTIPART_QUEUE_LIMIT,
  });

  await assert.rejects(
    withOrderPhotoMultipartAdmission(async () => {
      thirdFormDataCalls += 1;
    }),
    (error: unknown) => error instanceof OrderUploadError
      && error.code === "IMAGE_PROCESSING_BUSY"
      && error.status === 503,
  );
  assert.equal(firstFormDataCalls, 1);
  assert.equal(secondFormDataCalls, 0);
  assert.equal(thirdFormDataCalls, 0);

  releaseFirst.resolve();
  await secondEntered.promise;
  assert.equal(secondFormDataCalls, 1);
  releaseSecond.resolve();
  await Promise.all([first, second]);
  assert.deepEqual(getOrderPhotoMultipartAdmissionState(), {
    active: 0,
    queued: 0,
    concurrency: ORDER_PHOTO_MULTIPART_CONCURRENCY,
    queueLimit: ORDER_PHOTO_MULTIPART_QUEUE_LIMIT,
  });
});

test("retire une admission multipart annulée sans lire son corps", async () => {
  const firstEntered = deferred<void>();
  const releaseFirst = deferred<void>();
  const controller = new AbortController();
  let queuedFormDataCalls = 0;

  const first = withOrderPhotoMultipartAdmission(async () => {
    firstEntered.resolve();
    await releaseFirst.promise;
  });
  await firstEntered.promise;

  const queued = withOrderPhotoMultipartAdmission(async () => {
    queuedFormDataCalls += 1;
  }, controller.signal);
  assert.equal(getOrderPhotoMultipartAdmissionState().queued, 1);
  controller.abort();
  await assert.rejects(
    queued,
    (error: unknown) => error instanceof OrderUploadError && error.code === "UPLOAD_ABORTED",
  );
  assert.equal(queuedFormDataCalls, 0);
  assert.equal(getOrderPhotoMultipartAdmissionState().queued, 0);

  releaseFirst.resolve();
  await first;
  assert.deepEqual(getOrderPhotoMultipartAdmissionState(), {
    active: 0,
    queued: 0,
    concurrency: ORDER_PHOTO_MULTIPART_CONCURRENCY,
    queueLimit: ORDER_PHOTO_MULTIPART_QUEUE_LIMIT,
  });
});

test("expire une admission multipart en attente sans lire son corps", async () => {
  const firstEntered = deferred<void>();
  const releaseFirst = deferred<void>();
  let queuedFormDataCalls = 0;

  const first = withOrderPhotoMultipartAdmission(async () => {
    firstEntered.resolve();
    await releaseFirst.promise;
  });
  await firstEntered.promise;

  const queued = withOrderPhotoMultipartAdmission(async () => {
    queuedFormDataCalls += 1;
  }, undefined, 25);
  assert.equal(getOrderPhotoMultipartAdmissionState().queued, 1);
  await assert.rejects(
    queued,
    (error: unknown) => error instanceof OrderUploadError
      && error.code === "IMAGE_PROCESSING_BUSY"
      && error.status === 503,
  );
  assert.equal(queuedFormDataCalls, 0);
  assert.deepEqual(getOrderPhotoMultipartAdmissionState(), {
    active: 1,
    queued: 0,
    concurrency: ORDER_PHOTO_MULTIPART_CONCURRENCY,
    queueLimit: ORDER_PHOTO_MULTIPART_QUEUE_LIMIT,
  });

  releaseFirst.resolve();
  await first;
  assert.deepEqual(getOrderPhotoMultipartAdmissionState(), {
    active: 0,
    queued: 0,
    concurrency: ORDER_PHOTO_MULTIPART_CONCURRENCY,
    queueLimit: ORDER_PHOTO_MULTIPART_QUEUE_LIMIT,
  });
});

test("contrôle un multipart invalide et libère toujours l’admission", async () => {
  const body = "multipart-invalide";
  const request = new Request("http://127.0.0.1/api/orders/test/photos", {
    method: "POST",
    headers: {
      "content-length": String(Buffer.byteLength(body)),
      "content-type": "multipart/form-data; boundary=phase2-test",
    },
    body,
  });
  assertOrderPhotoMultipartHeaders(request);

  await assert.rejects(
    withOrderPhotoMultipartAdmission(() => readOrderPhotoMultipartFormData(request)),
    (error: unknown) => error instanceof OrderUploadError
      && error.code === "INVALID_MULTIPART"
      && error.status === 400,
  );
  assert.deepEqual(getOrderPhotoMultipartAdmissionState(), {
    active: 0,
    queued: 0,
    concurrency: ORDER_PHOTO_MULTIPART_CONCURRENCY,
    queueLimit: ORDER_PHOTO_MULTIPART_QUEUE_LIMIT,
  });
});

test("accepte une image décodable de 10 Mio et son enveloppe multipart", async () => {
  const jpeg = await raster("jpeg");
  const boundaryPhoto = Buffer.concat([jpeg, Buffer.alloc(orderOffer.maxPhotoBytes - jpeg.length)]);
  const request = await multipartRequest(boundaryPhoto);
  const declaredBytes = Number(request.headers.get("content-length"));
  assert.ok(declaredBytes > orderOffer.maxPhotoBytes);
  assert.ok(declaredBytes <= ORDER_PHOTO_MULTIPART_MAX_BYTES);
  const formData = await readOrderPhotoMultipartFormData(request);
  const file = formData.get("files");
  assert.ok(file instanceof File);
  assert.equal(file.size, 10_485_760);
  const normalized = await normalizeOrderImage({
    buffer: Buffer.from(await file.arrayBuffer()),
    originalFilename: file.name,
    declaredMimeType: file.type,
  });
  assert.equal(normalized.mimeType, "image/webp");
  assert.equal(normalized.width, 24);
});

test("compte les octets réels même si la taille déclarée sous-estime le corps", async () => {
  const request = new Request("http://127.0.0.1/api/orders/test/photos", {
    method: "POST",
    headers: {
      "content-length": "1",
      "content-type": "multipart/form-data; boundary=bounded-test",
    },
    body: new Uint8Array(ORDER_PHOTO_MULTIPART_MAX_BYTES + 1),
  });
  await expectUploadCode(readOrderPhotoMultipartFormData(request), "TRANSPORT_TOO_LARGE");
});

test("refuse une enveloppe excessive et un corps interrompu", async () => {
  const jpeg = await raster("jpeg");
  await expectUploadCode(readOrderPhotoMultipartFormData(await multipartRequest(
    jpeg,
    "x".repeat(ORDER_PHOTO_MULTIPART_OVERHEAD_BYTES + 1),
  )), "MULTIPART_FIELDS_TOO_LARGE");
  const incomplete = await multipartRequest(jpeg);
  incomplete.headers.set("content-length", String(Number(incomplete.headers.get("content-length")) + 1));
  await expectUploadCode(readOrderPhotoMultipartFormData(incomplete), "INCOMPLETE_MULTIPART");
});

test("refuse une taille sous-déclarée et une lecture multipart annulée", async () => {
  const jpeg = await raster("jpeg");
  const understated = await multipartRequest(jpeg);
  understated.headers.set("content-length", "1");
  await expectUploadCode(readOrderPhotoMultipartFormData(understated), "INCOMPLETE_MULTIPART");
  const controller = new AbortController();
  const aborted = new Request(await multipartRequest(jpeg), { signal: controller.signal });
  controller.abort();
  await expectUploadCode(readOrderPhotoMultipartFormData(aborted), "UPLOAD_ABORTED");
});

test("refuse les headers multipart absents, mal formés ou trop volumineux avant admission", () => {
  const requestWith = (headers: HeadersInit) => new Request(
    "http://127.0.0.1/api/orders/test/photos",
    { method: "POST", headers },
  );
  const expectHeaderError = (headers: HeadersInit, code: string, status: number) => {
    assert.throws(
      () => assertOrderPhotoMultipartHeaders(requestWith(headers)),
      (error: unknown) => error instanceof OrderUploadError
        && error.code === code
        && error.status === status,
    );
  };

  expectHeaderError({}, "INVALID_MULTIPART", 400);
  expectHeaderError({ "content-type": "multipart/form-data", "content-length": "16" }, "INVALID_MULTIPART", 400);
  expectHeaderError({ "content-type": `multipart/form-data; boundary=${"a".repeat(71)}`, "content-length": "16" }, "INVALID_MULTIPART", 400);
  expectHeaderError({ "content-type": "multipart/form-data; boundary=phase2-test" }, "CONTENT_LENGTH_REQUIRED", 411);
  expectHeaderError({
    "content-type": "multipart/form-data; boundary=phase2-test",
    "content-length": "16.5",
  }, "INVALID_MULTIPART", 400);
  expectHeaderError({
    "content-type": "multipart/form-data; boundary=phase2-test",
    "content-length": String(ORDER_PHOTO_MULTIPART_MAX_BYTES + 1),
  }, "TRANSPORT_TOO_LARGE", 413);

  assert.doesNotThrow(() => assertOrderPhotoMultipartHeaders(requestWith({
    "content-type": "multipart/form-data; boundary=phase2-test",
    "content-length": String(ORDER_PHOTO_MULTIPART_MAX_BYTES),
  })));
});

test("place ownership et éditabilité avant admission, puis revalide avant écriture", async () => {
  const routeSource = await readFile(path.join(
    process.cwd(),
    "app/api/orders/[orderNumber]/photos/route.ts",
  ), "utf8");
  const serviceSource = await readFile(path.join(process.cwd(), "lib/orders/service.ts"), "utf8");

  const originCheck = routeSource.indexOf("isAllowedOrderMutation(request)");
  const authentication = routeSource.indexOf("orderActorFromHeaders(request.headers)");
  const headerChecks = routeSource.indexOf("assertOrderPhotoMultipartHeaders(request)");
  const rateLimit = routeSource.indexOf("enforceOrderRateLimit(actor.id, \"upload\")");
  const ownershipPreflight = routeSource.indexOf("preflightOrderPhotoUpload(actor, orderNumber)");
  const admission = routeSource.indexOf("withOrderPhotoMultipartAdmission(async () =>");
  const formDataRead = routeSource.indexOf("readOrderPhotoMultipartFormData(request)");
  assert.ok(originCheck >= 0 && originCheck < authentication);
  assert.ok(authentication < headerChecks);
  assert.ok(headerChecks < rateLimit);
  assert.ok(rateLimit < ownershipPreflight);
  assert.ok(ownershipPreflight < admission);
  assert.ok(admission < formDataRead);
  assert.doesNotMatch(routeSource, /request\.formData\s*\(/);

  const preflightStart = serviceSource.indexOf("export async function preflightOrderPhotoUpload");
  const addStart = serviceSource.indexOf("export async function addOrderPhotos");
  const preflightSource = serviceSource.slice(preflightStart, addStart);
  assert.match(preflightSource, /userId: actor\.id/);
  assert.match(preflightSource, /assertOrderEditableForPayment\(transaction, current\)/);
  assert.doesNotMatch(preflightSource, /assertPhotoCapacity|PHOTO_LIMIT_REACHED/);

  const addEnd = serviceSource.indexOf("export async function getOrderPhotoForActor", addStart);
  const addSource = serviceSource.slice(addStart, addEnd);
  const transformStart = addSource.indexOf("processOrderImageBatch(files");
  assert.ok(transformStart >= 0);
  assert.ok(addSource.lastIndexOf("userId: actor.id") > transformStart);
  assert.ok(addSource.lastIndexOf("assertOrderEditableForPayment(transaction, current)") > transformStart);
  const deduplication = addSource.indexOf("const append = planOrderPhotoAppend(");
  const capacityCheck = addSource.indexOf("assertPhotoCapacity(existing.length, append.newPhotos.length)");
  assert.ok(deduplication > transformStart && capacityCheck > deduplication);
  assert.match(addSource, /append\.newPhotos\.length && !assertPhotoCapacity/);
  assert.match(addSource, /position: append\.nextPosition \+ index/);
  assert.match(addSource, /cleanupPersistedOrderImages\(duplicatePhotos,/);
  assert.match(addSource, /cleanupUnattachedOrderImages\(pending,/);
  assert.match(addSource, /retainedStorageKeys: \(storageKeys\) => withOrderPhotoLock\(orderNumber,/);
  assert.match(addSource, /transaction\.asset\.findMany/);
  assert.match(addSource, /storageKey: \{ in: \[\.\.\.storageKeys\] \}/);
  assert.match(routeSource, /entries\.length !== 1/);
});

test("fixe ReadCommitted uniquement pour les opérations photos sous leur verrou partagé", async () => {
  const serviceSource = await readFile(path.join(process.cwd(), "lib/orders/service.ts"), "utf8");
  const sharedStart = serviceSource.indexOf("async function withOrderLock<");
  const photoStart = serviceSource.indexOf("function withOrderPhotoLock<");
  const photoEnd = serviceSource.indexOf("async function nextOrderNumber", photoStart);
  assert.match(serviceSource.slice(sharedStart, photoStart), /options\?: \{ isolationLevel: "ReadCommitted" \}/);
  assert.match(serviceSource.slice(sharedStart, photoStart), /\}, options\)/);
  assert.match(serviceSource.slice(photoStart, photoEnd), /withOrderLock\(`payments:order:\$\{orderNumber\}`, operation, \{ isolationLevel: "ReadCommitted" \}\)/);
  for (const name of ["preflightOrderPhotoUpload", "addOrderPhotos", "deleteOrderPhoto"]) {
    const start = serviceSource.indexOf(`export async function ${name}`);
    const end = serviceSource.indexOf("export async function ", start + 1);
    assert.match(serviceSource.slice(start, end < 0 ? undefined : end), /withOrderPhotoLock\(orderNumber,/);
  }
  for (const name of ["saveDraftOrder", "finalizeOrder"]) {
    const start = serviceSource.indexOf(`export async function ${name}`);
    const end = serviceSource.indexOf("export async function ", start + 1);
    assert.doesNotMatch(serviceSource.slice(start, end < 0 ? undefined : end), /withOrderPhotoLock|isolationLevel/);
  }
});

test("un COMMIT ambigu protège les objets attachés avant tout nettoyage de la tentative", async () => {
  const jpeg = await raster("jpeg");
  const pending = await processOrderImageBatch([
    { buffer: jpeg, originalFilename: "committed.jpg", declaredMimeType: "image/jpeg" },
    { buffer: jpeg, originalFilename: "unattached.jpg", declaredMimeType: "image/jpeg" },
  ], {
    persist: async (_photo, index) => ({ storageKey: `new-attempt/${index}` }),
    cleanup: async () => assert.fail("la préparation ne doit pas échouer"),
  });
  const proof = deferred<ReadonlySet<string>>();
  const cleaned: string[] = [];
  let reads = 0;
  const cleanup = cleanupUnattachedOrderImages(pending, {
    retainedStorageKeys: async (storageKeys) => {
      reads += 1;
      assert.deepEqual(storageKeys, ["new-attempt/0", "new-attempt/1"]);
      return proof.promise;
    },
    cleanup: async ({ storageKey }) => { cleaned.push(storageKey); },
  });
  await Promise.resolve();
  assert.deepEqual(cleaned, []);
  proof.resolve(new Set(["new-attempt/0"]));
  assert.equal((await cleanup).failedObjectCount, 0);
  assert.equal(reads, 1);
  assert.deepEqual(cleaned, ["new-attempt/1"]);
});

test("une DB indisponible préserve tous les objets incertains et l’erreur primaire", async () => {
  const jpeg = await raster("jpeg");
  const pending = await processOrderImageBatch([
    { buffer: jpeg, originalFilename: "private-photo.jpg", declaredMimeType: "image/jpeg" },
  ], {
    persist: async () => ({ storageKey: "new-attempt/private-object" }),
    cleanup: async () => assert.fail("la préparation ne doit pas échouer"),
  });
  const diagnostics: ReturnType<typeof orderPhotoCleanupDiagnostic>[] = [];
  const primary = new Error("lost commit acknowledgement");
  await assert.rejects(async () => {
    try {
      throw primary;
    } catch (error) {
      const result = await cleanupUnattachedOrderImages(pending, {
        retainedStorageKeys: async () => { throw new Error("private database failure"); },
        cleanup: async () => assert.fail("aucun objet incertain ne doit être supprimé"),
        reportCleanupFailure: (diagnostic) => diagnostics.push(diagnostic),
      });
      assert.equal(result.failedObjectCount, 1);
      throw error;
    }
  }, (error: unknown) => error === primary);
  assert.deepEqual(diagnostics, [{
    event: "order.photo.cleanup.failed",
    cleanupOutcome: "failed",
    attemptedObjectCount: 1,
    failedObjectCount: 1,
  }]);
  assert.doesNotMatch(JSON.stringify(diagnostics), /private|database|object|commit acknowledgement/);
  const empty = await cleanupUnattachedOrderImages([], {
    retainedStorageKeys: async () => assert.fail("aucune lecture DB sans objet"),
    cleanup: async () => assert.fail("aucun objet à supprimer"),
  });
  assert.deepEqual(empty, { attemptedObjectCount: 0, failedObjectCount: 0 });
});

test("nettoie les fichiers déjà persistés et remet les compteurs à zéro après échec", async () => {
  const jpeg = await raster("jpeg");
  const cleaned: string[] = [];
  const cleanupDiagnostics: ReturnType<typeof orderPhotoCleanupDiagnostic>[] = [];
  const failure = new Error("simulated persistence failure");

  await assert.rejects(processOrderImageBatch([
    { buffer: jpeg, originalFilename: "first.jpg", declaredMimeType: "image/jpeg" },
    { buffer: jpeg, originalFilename: "second.jpg", declaredMimeType: "image/jpeg" },
    { buffer: jpeg, originalFilename: "third.jpg", declaredMimeType: "image/jpeg" },
  ], {
    persist: async (_normalized, index) => {
      if (index === 2) throw failure;
      return { storageKey: `mock/${index}` };
    },
    cleanup: async ({ storageKey }) => {
      cleaned.push(storageKey);
      throw new Error("simulated cleanup failure");
    },
    reportCleanupFailure: (diagnostic) => cleanupDiagnostics.push(diagnostic),
  }), (error: unknown) => error === failure);

  assert.deepEqual(cleaned.sort(), ["mock/0", "mock/1"]);
  assert.deepEqual(cleanupDiagnostics, [{
    event: "order.photo.cleanup.failed",
    cleanupOutcome: "failed",
    attemptedObjectCount: 2,
    failedObjectCount: 2,
  }]);
  assert.doesNotMatch(JSON.stringify(cleanupDiagnostics), /mock\/|first|second|third/);
  assert.equal(getOrderPhotoTransformState().active, 0);
  assert.equal(getOrderPhotoTransformState().queued, 0);
  assert.deepEqual(getMemoryDiagnosticCounters(), {
    activeUploads: 0,
    activeImageTransforms: 0,
    activeS3Operations: 0,
  });
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
