"use client";

import {
  CREATION_DIRECT_UPLOAD_CONCURRENCY,
  CREATION_DIRECT_UPLOAD_POLL_SECONDS,
} from "@/lib/creations/direct-upload-contract";
import type { CreationVideoInputMimeType } from "@/lib/creations/media-contract";

export const CREATION_VIDEO_UPLOAD_MAX_ATTEMPTS = 3;
const ROOT = "/api/admin/creations/media/multipart";
const STORAGE_PREFIX = "lnx:creation-video-upload:v1";

export type MultipartStatus = "UPLOADING" | "QUARANTINE" | "ANALYZING" | "TRANSCODING" | "VALIDATING" | "READY" | "REJECTED" | "ABORTED" | "EXPIRED";
export type MultipartPart = { partNumber: number; etag: string; sizeBytes: number };
export type MultipartSession = {
  sessionToken: string;
  expiresAt: string;
  partSizeBytes: number;
  partCount: number;
  completedParts: MultipartPart[];
};
export type MultipartStatusResponse = MultipartSession & {
  ok: true;
  status: MultipartStatus;
  state: string;
  errorCode?: string | null;
  currentAssetId?: string | null;
  currentLockVersion?: number | null;
  location?: string | null;
  retryAfterMs?: number;
};
export type UploadPhase = "initializing" | "uploading" | "retrying" | "paused" | "finalizing" | "analyzing" | "transcoding" | "validating" | "ready" | "cancelled" | "error";
export type MultipartProgress = {
  phase: UploadPhase;
  uploadedBytes: number;
  confirmedBytes: number;
  inFlightBytes: number;
  totalBytes: number;
  completedParts: number;
  partCount: number;
  percent: number;
  retryCount: number;
};
export type MultipartInit = {
  creationId: string;
  slug: string;
  expectedLockVersion: number;
  expectedAssetId: string;
  rightsConfirmed: true;
  alt: string;
  role: "VIDEO";
  filename: string;
  mimeType: CreationVideoInputMimeType;
  sizeBytes: number;
};
export type StoredMultipartSession = {
  sessionToken: string;
  expiresAt: string;
  creationId: string;
  role: "VIDEO";
  fileSignature: string;
  filename: string;
  mimeType: CreationVideoInputMimeType;
  sizeBytes: number;
  lastModified: number;
};

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type Dependencies = {
  init(input: MultipartInit, signal: AbortSignal): Promise<MultipartSession>;
  partUrl(token: string, partNumber: number, signal: AbortSignal): Promise<{ url: string }>;
  status(token: string, signal: AbortSignal): Promise<MultipartStatusResponse>;
  complete(token: string, parts: Array<Pick<MultipartPart, "partNumber" | "etag">>, signal: AbortSignal): Promise<MultipartStatusResponse>;
  uploadPart(input: { url: string; body: Blob; signal: AbortSignal; onProgress(bytes: number): void }): Promise<{ etag: string }>;
  wait(ms: number, signal: AbortSignal): Promise<void>;
  waitUntilVisible(signal: AbortSignal): Promise<void>;
};

export class DirectMultipartUploadError extends Error {
  constructor(readonly state: string, readonly recoverable = false) {
    super(state);
    this.name = "DirectMultipartUploadError";
  }
}

function abortError() { return new DOMException("Upload interrupted", "AbortError"); }
export function isUploadAbort(error: unknown) { return error instanceof DOMException && error.name === "AbortError"; }
function assertActive(signal: AbortSignal) { if (signal.aborted) throw abortError(); }
function positive(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new DirectMultipartUploadError("media-session");
  return Number(value);
}
function token(value: unknown) {
  if (typeof value !== "string" || value.length < 16 || value.length > 8_192 || /[\r\n]/.test(value)) throw new DirectMultipartUploadError("media-session");
  return value;
}
function etag(value: unknown) {
  if (typeof value !== "string" || !value || value.length > 256 || /[\r\n]/.test(value)) throw new DirectMultipartUploadError("media-stockage", true);
  return value;
}

function normalizeSession(value: MultipartSession): MultipartSession {
  const partCount = positive(value.partCount);
  const partSizeBytes = positive(value.partSizeBytes);
  const expiresAt = typeof value.expiresAt === "string" && Number.isFinite(Date.parse(value.expiresAt)) ? value.expiresAt : null;
  if (!expiresAt) throw new DirectMultipartUploadError("media-session");
  const seen = new Set<number>();
  const completedParts = (Array.isArray(value.completedParts) ? value.completedParts : []).map((part) => {
    const partNumber = positive(part.partNumber);
    if (partNumber > partCount || seen.has(partNumber)) throw new DirectMultipartUploadError("media-session");
    seen.add(partNumber);
    return { partNumber, sizeBytes: positive(part.sizeBytes), etag: etag(part.etag) };
  }).sort((a, b) => a.partNumber - b.partNumber);
  return { sessionToken: token(value.sessionToken), expiresAt, partSizeBytes, partCount, completedParts };
}

export function multipartPartPlan(total: number, size: number, count: number) {
  positive(total); positive(size); positive(count);
  if (Math.ceil(total / size) !== count) throw new DirectMultipartUploadError("media-session");
  return Array.from({ length: count }, (_, index) => {
    const start = index * size;
    const end = Math.min(total, start + size);
    return { partNumber: index + 1, start, end, sizeBytes: end - start };
  });
}

export function multipartFileSignature(file: Pick<File, "name" | "size" | "type" | "lastModified">) {
  return [file.name, file.size, file.type, file.lastModified].join("\u001f");
}
export function multipartStorageKey(creationId: string) { return `${STORAGE_PREFIX}:${creationId}:VIDEO`; }
export function readStoredMultipartSession(storage: StorageLike, creationId: string, file?: Pick<File, "name" | "size" | "type" | "lastModified">) {
  try {
    const raw = storage.getItem(multipartStorageKey(creationId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<StoredMultipartSession>;
    if (
      parsed.creationId !== creationId || parsed.role !== "VIDEO" || typeof parsed.mimeType !== "string"
      || typeof parsed.sessionToken !== "string" || typeof parsed.expiresAt !== "string"
      || typeof parsed.fileSignature !== "string" || typeof parsed.filename !== "string"
      || !Number.isSafeInteger(parsed.sizeBytes) || Number(parsed.sizeBytes) <= 0
      || !Number.isSafeInteger(parsed.lastModified) || Date.parse(parsed.expiresAt) <= Date.now()
      || (file && parsed.fileSignature !== multipartFileSignature(file))
    ) return null;
    token(parsed.sessionToken);
    return parsed as StoredMultipartSession;
  } catch { return null; }
}
export function writeStoredMultipartSession(storage: StorageLike, value: StoredMultipartSession) {
  storage.setItem(multipartStorageKey(value.creationId), JSON.stringify(value));
}
export function clearStoredMultipartSession(storage: StorageLike, creationId: string) {
  try { storage.removeItem(multipartStorageKey(creationId)); } catch { /* optional browser aid */ }
}

async function requestJson<T extends { ok?: boolean; state?: string }>(path: string, body: unknown, signal: AbortSignal) {
  let response: Response;
  try {
    response = await fetch(`${ROOT}/${path}`, {
      method: "POST", credentials: "same-origin",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(body), signal,
    });
  } catch (error) {
    if (signal.aborted || isUploadAbort(error)) throw abortError();
    throw new DirectMultipartUploadError("media-reseau", true);
  }
  const data = response.headers.get("content-type")?.includes("application/json")
    ? await response.json().catch(() => null) as T | null : null;
  if (!response.ok || !data?.ok) {
    const state = data?.state && /^media-[a-z-]+$/.test(data.state) ? data.state : "media-erreur";
    throw new DirectMultipartUploadError(state, response.status >= 500 || response.status === 408 || response.status === 429);
  }
  const retry = Number(response.headers.get("retry-after"));
  return { data, retryAfterMs: Number.isFinite(retry) && retry > 0 ? Math.min(30_000, retry * 1_000) : CREATION_DIRECT_UPLOAD_POLL_SECONDS * 1_000 };
}

export async function uploadPartWithProgress(input: { url: string; body: Blob; signal: AbortSignal; onProgress(bytes: number): void }) {
  assertActive(input.signal);
  return new Promise<{ etag: string }>((resolve, reject) => {
    const request = new XMLHttpRequest();
    const abort = () => request.abort();
    const cleanup = () => input.signal.removeEventListener("abort", abort);
    request.open("PUT", input.url, true);
    request.upload.onprogress = (event) => { if (event.lengthComputable) input.onProgress(Math.min(input.body.size, event.loaded)); };
    request.onerror = () => { cleanup(); reject(new DirectMultipartUploadError("media-reseau", true)); };
    request.onabort = () => { cleanup(); reject(abortError()); };
    request.onload = () => {
      cleanup();
      if (request.status < 200 || request.status >= 300) {
        reject(new DirectMultipartUploadError("media-reseau", request.status === 403 || request.status === 408 || request.status === 429 || request.status >= 500));
        return;
      }
      try { input.onProgress(input.body.size); resolve({ etag: etag(request.getResponseHeader("ETag")) }); }
      catch (error) { reject(error); }
    };
    input.signal.addEventListener("abort", abort, { once: true });
    request.send(input.body);
  });
}

async function wait(ms: number, signal: AbortSignal) {
  assertActive(signal);
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, ms);
    signal.addEventListener("abort", () => { window.clearTimeout(timer); reject(abortError()); }, { once: true });
  });
}
async function waitUntilVisible(signal: AbortSignal) {
  assertActive(signal);
  if (typeof document === "undefined" || !document.hidden) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => { document.removeEventListener("visibilitychange", visible); signal.removeEventListener("abort", abort); };
    const visible = () => { if (!document.hidden) { cleanup(); resolve(); } };
    const abort = () => { cleanup(); reject(abortError()); };
    document.addEventListener("visibilitychange", visible);
    signal.addEventListener("abort", abort, { once: true });
  });
}

const browser: Dependencies = {
  async init(input, signal) { return normalizeSession((await requestJson<MultipartSession & { ok: true }>("init", input, signal)).data); },
  async partUrl(sessionToken, partNumber, signal) {
    const data = (await requestJson<{ ok: true; url: string }>("part-url", { sessionToken, partNumber }, signal)).data;
    if (typeof data.url !== "string" || !data.url.startsWith("https://")) throw new DirectMultipartUploadError("media-session");
    return { url: data.url };
  },
  async status(sessionToken, signal) {
    const result = await requestJson<MultipartStatusResponse>("status", { sessionToken }, signal);
    return { ...result.data, ...normalizeSession(result.data), retryAfterMs: result.retryAfterMs };
  },
  async complete(sessionToken, parts, signal) {
    const result = await requestJson<MultipartStatusResponse>("complete", { sessionToken, parts }, signal);
    return { ...result.data, ...normalizeSession(result.data), retryAfterMs: result.retryAfterMs };
  },
  uploadPart: uploadPartWithProgress,
  wait,
  waitUntilVisible,
};

function terminal(status: MultipartStatusResponse) {
  if (status.status === "ABORTED") return "media-annule";
  if (status.status === "EXPIRED") return "media-expire";
  if (status.status === "REJECTED") {
    if (status.errorCode?.startsWith("MEDIA_CONFLICT")) return "media-conflit";
    if (status.errorCode?.startsWith("STORAGE_INTEGRITY")) return "media-stockage";
    return "media-illisible";
  }
  return null;
}

export async function runDirectMultipartVideoUpload(input: {
  file?: File;
  init: MultipartInit;
  resumeSessionToken?: string;
  signal: AbortSignal;
  onSession?(session: MultipartSession): void;
  onProgress?(progress: MultipartProgress): void;
  dependencies?: Partial<Dependencies>;
}) {
  const dependencies = { ...browser, ...input.dependencies };
  let retries = 0;
  const emit = (
    phase: UploadPhase,
    confirmedBytes: number,
    inFlightBytes: number,
    completedParts: number,
    partCount: number,
  ) => {
    const uploadedBytes = Math.min(input.init.sizeBytes, confirmedBytes + inFlightBytes);
    input.onProgress?.({
      phase, uploadedBytes, confirmedBytes, inFlightBytes, totalBytes: input.init.sizeBytes, completedParts, partCount,
      percent: Math.round((uploadedBytes / input.init.sizeBytes) * 1_000) / 10, retryCount: retries,
    });
  };
  assertActive(input.signal);
  emit("initializing", 0, 0, 0, 0);
  let status: MultipartStatusResponse;
  if (input.resumeSessionToken) status = await dependencies.status(token(input.resumeSessionToken), input.signal);
  else {
    const session = normalizeSession(await dependencies.init(input.init, input.signal));
    status = { ok: true, status: "UPLOADING", state: "media-upload", ...session };
  }
  input.onSession?.(status);
  if (status.status === "READY") {
    emit("ready", input.init.sizeBytes, 0, status.partCount, status.partCount);
    return { state: "media-enregistre" as const, location: status.location ?? null };
  }
  const terminalState = terminal(status);
  if (terminalState) throw new DirectMultipartUploadError(terminalState);

  if (status.status === "UPLOADING") {
    if (!input.file) throw new DirectMultipartUploadError("media-reselection", true);
    if (input.file.size !== input.init.sizeBytes) throw new DirectMultipartUploadError("media-session");
    const plan = multipartPartPlan(input.file.size, status.partSizeBytes, status.partCount);
    const completed = new Map(status.completedParts.map((part) => [part.partNumber, part]));
    const progress = new Map(plan.map((part) => [part.partNumber, completed.has(part.partNumber) ? part.sizeBytes : 0]));
    const pending = plan.filter((part) => !completed.has(part.partNumber));
    let cursor = 0;
    const confirmedBytes = () => [...completed.values()].reduce((sum, part) => sum + part.sizeBytes, 0);
    const inFlightBytes = () => plan.reduce(
      (sum, part) => sum + (completed.has(part.partNumber) ? 0 : progress.get(part.partNumber) ?? 0),
      0,
    );
    emit("uploading", confirmedBytes(), inFlightBytes(), completed.size, plan.length);
    const worker = async () => {
      while (cursor < pending.length) {
        const part = pending[cursor++]!;
        let lastError: unknown;
        for (let attempt = 1; attempt <= CREATION_VIDEO_UPLOAD_MAX_ATTEMPTS; attempt += 1) {
          assertActive(input.signal);
          try {
            const signed = await dependencies.partUrl(status.sessionToken, part.partNumber, input.signal);
            const result = await dependencies.uploadPart({
              url: signed.url, body: input.file!.slice(part.start, part.end), signal: input.signal,
              onProgress(bytes) {
                progress.set(part.partNumber, Math.max(progress.get(part.partNumber) ?? 0, bytes));
                emit(attempt > 1 ? "retrying" : "uploading", confirmedBytes(), inFlightBytes(), completed.size, plan.length);
              },
            });
            completed.set(part.partNumber, { partNumber: part.partNumber, etag: etag(result.etag), sizeBytes: part.sizeBytes });
            progress.set(part.partNumber, part.sizeBytes);
            emit("uploading", confirmedBytes(), inFlightBytes(), completed.size, plan.length);
            lastError = undefined;
            break;
          } catch (error) {
            if (isUploadAbort(error) || input.signal.aborted) throw abortError();
            lastError = error;
            const recoverable = error instanceof DirectMultipartUploadError ? error.recoverable : true;
            if (!recoverable || attempt === CREATION_VIDEO_UPLOAD_MAX_ATTEMPTS) break;
            retries += 1;
            progress.set(part.partNumber, 0);
            emit("retrying", confirmedBytes(), inFlightBytes(), completed.size, plan.length);
            await dependencies.wait(Math.min(2_000, 250 * 2 ** (attempt - 1)), input.signal);
          }
        }
        if (lastError) throw lastError;
      }
    };
    await Promise.all(Array.from({ length: Math.min(CREATION_DIRECT_UPLOAD_CONCURRENCY, Math.max(1, pending.length)) }, worker));
    emit("finalizing", input.file.size, 0, completed.size, plan.length);
    const canonical = await dependencies.status(status.sessionToken, input.signal);
    if (canonical.completedParts.length !== canonical.partCount) throw new DirectMultipartUploadError("media-stockage", true);
    status = await dependencies.complete(
      status.sessionToken,
      canonical.completedParts.map(({ partNumber, etag: partEtag }) => ({ partNumber, etag: partEtag })),
      input.signal,
    );
  }

  while (["QUARANTINE", "ANALYZING", "TRANSCODING", "VALIDATING"].includes(status.status)) {
    const phase: UploadPhase = status.status === "ANALYZING" ? "analyzing"
      : status.status === "TRANSCODING" ? "transcoding"
        : "validating";
    emit(phase, input.init.sizeBytes, 0, status.partCount, status.partCount);
    await dependencies.waitUntilVisible(input.signal);
    await dependencies.wait(status.retryAfterMs ?? CREATION_DIRECT_UPLOAD_POLL_SECONDS * 1_000, input.signal);
    status = await dependencies.status(status.sessionToken, input.signal);
  }
  if (status.status !== "READY") throw new DirectMultipartUploadError(terminal(status) ?? "media-erreur");
  emit("ready", input.init.sizeBytes, 0, status.partCount, status.partCount);
  return { state: "media-enregistre" as const, location: status.location ?? null };
}

export async function abortDirectMultipartVideoUpload(sessionToken: string, signal: AbortSignal) {
  const result = await requestJson<{ ok: true; state: string }>("abort", { sessionToken: token(sessionToken) }, signal);
  if (result.data.state !== "media-annule") throw new DirectMultipartUploadError("media-erreur");
}
