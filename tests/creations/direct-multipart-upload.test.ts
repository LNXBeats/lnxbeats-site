import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DirectMultipartUploadError,
  multipartPartPlan,
  readStoredMultipartSession,
  runDirectMultipartVideoUpload,
  writeStoredMultipartSession,
  type MultipartProgress,
  type MultipartStatusResponse,
} from "@/lib/creations/direct-multipart-upload";

const sessionToken = "10000000-0000-4000-8000-000000000001.abcdefghijklmnopqrstuvwxyzABCDEFGH123456789";
const expiresAt = new Date(Date.now() + 60_000).toISOString();
const init = {
  creationId: "10000000-0000-4000-8000-000000000001", slug: "video-test", expectedLockVersion: 1,
  expectedAssetId: "", rightsConfirmed: true as const, alt: "", role: "VIDEO" as const,
  filename: "test.mp4", mimeType: "video/mp4" as const, sizeBytes: 25,
};

function response(status: MultipartStatusResponse["status"], parts: MultipartStatusResponse["completedParts"]): MultipartStatusResponse {
  return { ok: true, status, state: "media-upload", sessionToken, expiresAt, partSizeBytes: 10, partCount: 3, completedParts: parts };
}

test("client multipart plan has exact non-overlapping slices", () => {
  assert.deepEqual(multipartPartPlan(25, 10, 3), [
    { partNumber: 1, start: 0, end: 10, sizeBytes: 10 },
    { partNumber: 2, start: 10, end: 20, sizeBytes: 10 },
    { partNumber: 3, start: 20, end: 25, sizeBytes: 5 },
  ]);
  assert.throws(() => multipartPartPlan(25, 10, 2), DirectMultipartUploadError);
});

test("client bounds concurrency, retries only a failed part and reports monotone real progress", async () => {
  const file = new File([Buffer.alloc(25)], "test.mp4", { type: "video/mp4", lastModified: 1 });
  const attempts = new Map<number, number>();
  let active = 0;
  let maximumActive = 0;
  let statusCalls = 0;
  const observed: MultipartProgress[] = [];
  await runDirectMultipartVideoUpload({
    file, init, signal: new AbortController().signal, onProgress: (value) => observed.push(value),
    dependencies: {
      init: async () => ({ sessionToken, expiresAt, partSizeBytes: 10, partCount: 3, completedParts: [] }),
      partUrl: async (_token, partNumber) => ({ url: `https://example.test/${partNumber}` }),
      uploadPart: async ({ url, body, onProgress }) => {
        const part = Number(url.split("/").pop());
        attempts.set(part, (attempts.get(part) ?? 0) + 1);
        active += 1; maximumActive = Math.max(maximumActive, active);
        onProgress(Math.ceil(body.size / 2));
        await new Promise((resolve) => setTimeout(resolve, 5));
        active -= 1;
        if (part === 2 && attempts.get(part) === 1) throw new DirectMultipartUploadError("media-reseau", true);
        onProgress(body.size);
        return { etag: `etag-${part}` };
      },
      wait: async () => undefined,
      waitUntilVisible: async () => undefined,
      status: async () => {
        statusCalls += 1;
        return response("UPLOADING", [1, 2, 3].map((partNumber) => ({ partNumber, etag: `etag-${partNumber}`, sizeBytes: partNumber === 3 ? 5 : 10 })));
      },
      complete: async () => response("READY", []),
    },
  });
  assert.equal(maximumActive, 2);
  assert.deepEqual(Object.fromEntries(attempts), { 1: 1, 2: 2, 3: 1 });
  assert.equal(statusCalls, 1);
  assert.ok(observed.some((item) => item.phase === "retrying"));
  for (let index = 1; index < observed.length; index += 1) assert.ok(observed[index]!.uploadedBytes >= observed[index - 1]!.uploadedBytes);
});

test("resume trusts the provider part list and does not resend completed parts", async () => {
  const file = new File([Buffer.alloc(25)], "test.mp4", { type: "video/mp4", lastModified: 1 });
  const uploaded: number[] = [];
  let statusCalls = 0;
  await runDirectMultipartVideoUpload({
    file, init, resumeSessionToken: sessionToken, signal: new AbortController().signal,
    dependencies: {
      status: async () => {
        statusCalls += 1;
        return response("UPLOADING", statusCalls === 1
          ? [{ partNumber: 1, etag: "etag-1", sizeBytes: 10 }]
          : [1, 2, 3].map((partNumber) => ({ partNumber, etag: `etag-${partNumber}`, sizeBytes: partNumber === 3 ? 5 : 10 })));
      },
      partUrl: async (_token, partNumber) => ({ url: `https://example.test/${partNumber}` }),
      uploadPart: async ({ url, body, onProgress }) => { const part = Number(url.split("/").pop()); uploaded.push(part); onProgress(body.size); return { etag: `etag-${part}` }; },
      complete: async () => response("READY", []), wait: async () => undefined, waitUntilVisible: async () => undefined,
    },
  });
  assert.deepEqual(uploaded.sort(), [2, 3]);
});

test("stored resume state contains only an opaque token and requires the exact same file", () => {
  const entries = new Map<string, string>();
  const storage = { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); }, removeItem: (key: string) => { entries.delete(key); } };
  const value = { sessionToken, expiresAt, creationId: init.creationId, role: "VIDEO" as const, fileSignature: "test.mp4\u001f25\u001fvideo/mp4\u001f1", filename: "test.mp4", mimeType: "video/mp4" as const, sizeBytes: 25, lastModified: 1 };
  writeStoredMultipartSession(storage, value);
  const same = new File([Buffer.alloc(25)], "test.mp4", { type: "video/mp4", lastModified: 1 });
  const other = new File([Buffer.alloc(24)], "test.mp4", { type: "video/mp4", lastModified: 1 });
  assert.equal(readStoredMultipartSession(storage, init.creationId, same)?.sessionToken, sessionToken);
  assert.equal(readStoredMultipartSession(storage, init.creationId, other), null);
  assert.doesNotMatch(JSON.stringify(value), /access.?key|secret/i);
});

test("Admin exposes real upload phases, cancellation, resume and 48px mobile controls", async () => {
  const [component, css] = await Promise.all([
    readFile(new URL("../../components/admin-creation-media-manager.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../app/admin/admin.css", import.meta.url), "utf8"),
  ]);
  for (const label of ["Envoi direct vers le stockage", "Finalisation", "Validation intégrale", "Annuler l’envoi", "Reprendre la session"]) {
    assert.match(component, new RegExp(label));
  }
  assert.match(component, /<progress max=\{100\} value=\{directProgress\.percent\}/);
  assert.match(css, /\.admin-creation-upload button \{ min-height: 48px/);
  assert.match(css, /@media \(max-width: 480px\)[\s\S]*\.admin-creation-upload button \{ width: 100%/);
});
