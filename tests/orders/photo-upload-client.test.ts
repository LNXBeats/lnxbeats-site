import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";

import { orderOffer } from "@/data/order-offer";
import { photoSelectionError, uploadOrderPhoto, uploadPhotoQueue, type PhotoUploadState } from "@/lib/orders/photo-upload-client";
import type { SerializedOrder } from "@/lib/orders/types";

function file(name: string, size = 8, type = "image/jpeg") {
  return new File([new Uint8Array(size)], name, { type });
}

function order(photoIds: string[] = []): SerializedOrder {
  return {
    orderNumber: "LNX-QA-LOCAL-PHOTOS",
    status: "DRAFT",
    title: "Fixture locale uniquement",
    recipient: "Destinataire synthétique",
    occasion: "",
    brief: "Un brief synthétique de test assez long pour être valide.",
    musicalDirection: "Je laisse LNX Beats choisir",
    emotion: "",
    importantDetails: "",
    wordsToInclude: "",
    avoid: "",
    pronunciationNotes: "",
    coverIncluded: true,
    illustrationFormat: "CUSTOM",
    illustrationFormatCustom: "Bannière 21:9",
    priorityProcessing: false,
    usage: "PERSONAL",
    customerEmail: "fixture@example.invalid",
    customerName: "Fixture locale",
    basePriceCents: 2_000,
    coverPriceCents: 1_000,
    priorityPriceCents: 0,
    totalCents: 3_000,
    currency: "EUR",
    pricingVersion: "2026-08-v2",
    personalUseTermsVersion: null,
    personalUseTermsHashSha256: null,
    personalUseTermsAcceptedAt: null,
    earlyPerformanceConsentVersion: null,
    earlyPerformanceConsentHashSha256: null,
    earlyPerformanceConsentAcceptedAt: null,
    contractRequired: false,
    revisionAllowance: 1,
    revisionUsed: 0,
    submittedAt: null,
    deliveredAt: null,
    downloadExpiresAt: null,
    createdAt: "2026-10-03T12:00:00.000Z",
    updatedAt: "2026-10-03T12:00:00.000Z",
    events: [],
    photos: photoIds.map((id, position) => ({ id, position, filename: `${id}.webp`, mimeType: "image/webp", sizeBytes: 8, width: 10, height: 10 })),
    deliveries: [],
    delivery: null,
    payments: [],
  };
}

function observer() {
  const orders: SerializedOrder[] = [];
  const states: Array<{ file: File; state: PhotoUploadState }> = [];
  const saved: File[] = [];
  return {
    orders,
    states,
    saved,
    onOrder(value: SerializedOrder) { orders.push(value); },
    onState(value: File, state: PhotoUploadState) { states.push({ file: value, state }); },
    onSaved(value: File) { saved.push(value); },
  };
}

test("selection uses the exact per-file 10 MiB boundary and rejects empty or unsupported files", () => {
  assert.equal(orderOffer.maxPhotoBytes, 10_485_760);
  for (const type of ["image/jpeg", "image/png", "image/webp"]) {
    assert.equal(photoSelectionError({ size: orderOffer.maxPhotoBytes, type }), null);
    assert.equal(photoSelectionError({ size: orderOffer.maxPhotoBytes - 1, type }), null);
    assert.match(photoSelectionError({ size: orderOffer.maxPhotoBytes + 1, type })!, /10 Mio \(10 485 760 octets\)/);
    assert.match(photoSelectionError({ size: 0, type })!, /vide ou illisible/);
  }
  for (const type of ["image/gif", "application/octet-stream", ""]) {
    assert.match(photoSelectionError({ size: 1, type })!, /Format non pris en charge/);
  }
});

test("four photos over 15 MiB total are sent sequentially and are saved only after confirmation", async () => {
  // These are transport-unit fixtures, not image-decoding or real Next-server evidence.
  const files = Array.from({ length: 4 }, (_, index) => file(`photo-${index}.jpg`, 4 * 1024 * 1024));
  assert.ok(files.reduce((total, entry) => total + entry.size, 0) > 15 * 1024 * 1024);
  const observed = observer();
  const calls: string[] = [];
  let active = 0;
  let maximumActive = 0;
  let reconciliations = 0;
  const result = await uploadPhotoQueue(files, {
    ...observed,
    async upload(entry, onStage) {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      calls.push(entry.name);
      onStage("uploading");
      await new Promise<void>((resolve) => setImmediate(resolve));
      onStage("processing");
      assert.equal(observed.saved.includes(entry), false);
      active -= 1;
      return order(calls);
    },
    async reconcile() { reconciliations += 1; return null; },
  });
  assert.deepEqual(result, { failed: [], complete: true });
  assert.equal(maximumActive, 1);
  assert.equal(reconciliations, 0);
  assert.deepEqual(calls, files.map(({ name }) => name));
  assert.deepEqual(observed.saved, files);
  for (const entry of files) {
    assert.deepEqual(observed.states.filter((state) => state.file === entry).map(({ state }) => state.stage), ["uploading", "processing", "saved"]);
  }
  assert.equal(observed.orders.at(-1)?.photos.length, 4);
  assert.equal(observed.orders.at(-1)?.illustrationFormatCustom, "Bannière 21:9");
});

test("a partial failure retains confirmed photos and retry sends only the failed file", async () => {
  const files = [file("first.jpg"), file("retry.jpg"), file("last.jpg")];
  const observed = observer();
  const stored: string[] = [];
  const calls: string[] = [];
  let failedOnce = false;
  let reconciliations = 0;
  const dependencies = {
    ...observed,
    async upload(entry: File, onStage: (stage: "uploading" | "processing") => void) {
      calls.push(entry.name);
      onStage("uploading");
      if (entry === files[1] && !failedOnce) {
        failedOnce = true;
        throw new Error("Interruption réseau synthétique");
      }
      onStage("processing");
      stored.push(entry.name);
      return order(stored);
    },
    async reconcile() { reconciliations += 1; return order(stored); },
  };
  const first = await uploadPhotoQueue(files, dependencies);
  assert.deepEqual(first, { failed: [files[1]], complete: false });
  assert.deepEqual(observed.saved, [files[0], files[2]]);
  assert.equal(reconciliations, 1);
  assert.deepEqual(observed.orders.at(-1)?.photos.map(({ id }) => id), ["first.jpg", "last.jpg"]);
  const second = await uploadPhotoQueue(first.failed, dependencies);
  assert.deepEqual(second, { failed: [], complete: true });
  assert.deepEqual(calls, ["first.jpg", "retry.jpg", "last.jpg", "retry.jpg"]);
  assert.deepEqual(observed.saved, [files[0], files[2], files[1]]);
  assert.equal(observed.orders.at(-1)?.photos.length, 3);
});

test("a lost confirmation reconciles the server inventory but retains the file for an idempotent retry", async () => {
  const selected = file("lost-response.jpg");
  const observed = observer();
  const stored = new Set<string>();
  const sequence: string[] = [];
  let firstAttempt = true;
  const dependencies = {
    ...observed,
    async upload(entry: File) {
      sequence.push("upload");
      stored.add(entry.name); // Synthetic server deduplication; not proof of the real server guard.
      if (firstAttempt) {
        firstAttempt = false;
        throw new Error("Réponse perdue après persistance");
      }
      return order([...stored]);
    },
    async reconcile() { sequence.push("reconcile"); return order([...stored]); },
  };
  const first = await uploadPhotoQueue([selected], dependencies);
  assert.deepEqual(first, { failed: [selected], complete: false });
  assert.deepEqual(sequence, ["upload", "reconcile"]);
  assert.equal(observed.orders.at(-1)?.photos.length, 1);
  assert.equal(observed.saved.length, 0);
  assert.equal(observed.states.at(-1)?.state.stage, "failed");
  const retry = await uploadPhotoQueue(first.failed, dependencies);
  assert.equal(retry.complete, true);
  assert.equal(observed.orders.at(-1)?.photos.length, 1);
  assert.deepEqual(observed.saved, [selected]);
});

test("an unavailable reconciliation does not erase successes or prevent later files from being attempted", async () => {
  const files = [file("missing.jpg"), file("valid.jpg")];
  for (const reconcile of [async () => null, async (): Promise<SerializedOrder | null> => { throw new Error("Offline"); }]) {
    const observed = observer();
    const result = await uploadPhotoQueue(files, {
      ...observed,
      async upload(entry) {
        if (entry === files[0]) throw new Error("Offline");
        return order([entry.name]);
      },
      reconcile,
    });
    assert.deepEqual(result.failed, [files[0]]);
    assert.deepEqual(observed.saved, [files[1]]);
    assert.equal(observed.orders.length, 1);
  }
});

test("invalid selections are not sent and an empty queue performs no requests", async () => {
  const empty = file("empty.jpg", 0);
  const unsupported = file("wrong.gif", 1, "image/gif");
  const oversized = file("large.jpg", orderOffer.maxPhotoBytes + 1);
  const observed = observer();
  const calls: string[] = [];
  const dependencies = {
    ...observed,
    async upload(entry: File) { calls.push(entry.name); return order(); },
    async reconcile() { calls.push("reconcile"); return null; },
  };
  const invalid = [empty, unsupported, oversized];
  assert.deepEqual(await uploadPhotoQueue(invalid, dependencies), { failed: invalid, complete: false });
  assert.deepEqual(await uploadPhotoQueue([], dependencies), { failed: [], complete: true });
  assert.deepEqual(calls, []);
  assert.deepEqual(observed.saved, []);
  assert.equal(observed.states.length, 3);
});

class FakeXMLHttpRequest {
  static instances: FakeXMLHttpRequest[] = [];
  method = "";
  url = "";
  timeout = 0;
  status = 0;
  responseText = "";
  body: FormData | null = null;
  upload: { onload: (() => void) | null; onprogress: ((event: { loaded: number; total: number; lengthComputable: boolean }) => void) | null } = { onload: null, onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  ontimeout: (() => void) | null = null;
  onabort: (() => void) | null = null;
  constructor() { FakeXMLHttpRequest.instances.push(this); }
  open(method: string, url: string) { this.method = method; this.url = url; }
  send(body: FormData) { this.body = body; }
}

function installFakeXHR(context: TestContext) {
  const original = Object.getOwnPropertyDescriptor(globalThis, "XMLHttpRequest");
  FakeXMLHttpRequest.instances = [];
  Object.defineProperty(globalThis, "XMLHttpRequest", { configurable: true, writable: true, value: FakeXMLHttpRequest });
  context.after(() => {
    if (original) Object.defineProperty(globalThis, "XMLHttpRequest", original);
    else Reflect.deleteProperty(globalThis, "XMLHttpRequest");
  });
}

test("XHR sends exactly one multipart photo with rights confirmation and waits for server persistence", async (context) => {
  installFakeXHR(context);
  const selected = file("photo.jpg");
  const stages: string[] = [];
  let settled = false;
  const promise = uploadOrderPhoto("LNX / QA", selected, (stage) => stages.push(stage)).then((value) => { settled = true; return value; });
  const request = FakeXMLHttpRequest.instances[0];
  assert.equal(request.method, "POST");
  assert.equal(request.url, "/api/orders/LNX%20%2F%20QA/photos");
  assert.equal(request.timeout, 120_000);
  assert.deepEqual(request.body?.getAll("files"), [selected]);
  assert.deepEqual(request.body?.getAll("rightsConfirmed"), ["true"]);
  assert.deepEqual([...request.body!.keys()], ["files", "rightsConfirmed"]);
  assert.deepEqual(stages, ["uploading"]);
  request.upload.onload?.();
  await Promise.resolve();
  assert.deepEqual(stages, ["uploading", "processing"]);
  assert.equal(settled, false);
  request.status = 201;
  request.responseText = JSON.stringify({ order: order(["saved"]) });
  request.onload?.();
  assert.deepEqual(await promise, order(["saved"]));
});

test("XHR reports server validation, malformed replies and missing confirmation as failures", async (context) => {
  installFakeXHR(context);
  for (const response of [
    { status: 413, text: JSON.stringify({ error: "Chaque photo doit peser au maximum 10 Mio." }), expected: /10 Mio/ },
    { status: 201, text: "not JSON", expected: /n’a pas pu être enregistrée/ },
    { status: 201, text: "{}", expected: /n’a pas pu être enregistrée/ },
  ]) {
    const promise = uploadOrderPhoto("LNX-QA", file("invalid.jpg"), () => {});
    const request = FakeXMLHttpRequest.instances.at(-1)!;
    request.status = response.status;
    request.responseText = response.text;
    request.onload?.();
    await assert.rejects(promise, response.expected);
  }
});

test("XHR byte progress comes only from computable upload events and never means persistence", async (context) => {
  installFakeXHR(context);
  const states: PhotoUploadState[] = [];
  const promise = uploadOrderPhoto("LNX-QA", file("progress.jpg"), (stage, progress) => states.push({ stage, ...(progress ? { progress } : {}) }));
  const request = FakeXMLHttpRequest.instances[0];
  request.upload.onprogress?.({ loaded: 7, total: 0, lengthComputable: false });
  assert.deepEqual(states, [{ stage: "uploading" }]);
  request.upload.onprogress?.({ loaded: 450, total: 1000, lengthComputable: true });
  assert.deepEqual(states.at(-1), { stage: "uploading", progress: { sent: 450, total: 1000 } });
  request.upload.onprogress?.({ loaded: 1000, total: 1000, lengthComputable: true });
  request.upload.onload?.();
  assert.deepEqual(states.at(-1), { stage: "processing" });
  assert.equal(states.some(({ stage }) => stage === "saved"), false);
  request.onerror?.();
  await assert.rejects(promise, /Envoi ou confirmation interrompu/);
});

test("XHR error, timeout and abort all remain retryable failures", async (context) => {
  installFakeXHR(context);
  for (const event of ["onerror", "ontimeout", "onabort"] as const) {
    const promise = uploadOrderPhoto("LNX-QA", file("offline.jpg"), () => {});
    FakeXMLHttpRequest.instances.at(-1)![event]?.();
    await assert.rejects(promise, /Envoi ou confirmation interrompu/);
  }
});

test("a JSON null response rejects cleanly instead of throwing from onload and hanging the queue", async (context) => {
  installFakeXHR(context);
  const promise = uploadOrderPhoto("LNX-QA", file("null-response.jpg"), () => {});
  const request = FakeXMLHttpRequest.instances.at(-1)!;
  request.status = 201;
  request.responseText = "null";
  let uncaught: unknown;
  try { request.onload?.(); } catch (error) { uncaught = error; }
  // Keep this regression test bounded even against the broken implementation.
  if (uncaught) request.onerror?.();
  await assert.rejects(promise);
  assert.equal(uncaught, undefined, "The XHR event handler must reject the promise rather than throw outside it");
});
