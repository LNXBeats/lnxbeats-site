import "server-only";

import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import Busboy from "busboy";

import { validateCompleteAudioSource } from "@/lib/catalog/ffmpeg";
import { optionalText } from "@/lib/catalog/validation";
import { normalizeAdminImage } from "@/lib/media/admin-image";
import { sanitizeOriginalFilename } from "@/lib/orders/domain";
import { validateCreationVideo } from "@/lib/creations/video";
import {
  CREATION_AUDIO_MAXIMUM_BYTES,
  CREATION_IMAGE_MAXIMUM_BYTES,
  CREATION_VIDEO_MAXIMUM_BYTES,
  type CreationMediaRole,
} from "@/lib/creations/media-contract";

export {
  CREATION_AUDIO_MAXIMUM_BYTES,
  CREATION_IMAGE_MAXIMUM_BYTES,
  CREATION_VIDEO_MAXIMUM_BYTES,
};
export type { CreationMediaRole };

const maximumByRole: Record<CreationMediaRole, number> = {
  COVER: CREATION_IMAGE_MAXIMUM_BYTES,
  VIDEO_POSTER: CREATION_IMAGE_MAXIMUM_BYTES,
  AUDIO: CREATION_AUDIO_MAXIMUM_BYTES,
  VIDEO: CREATION_VIDEO_MAXIMUM_BYTES,
};

export type CreationMediaUpload = {
  creationId: string;
  slug: string;
  expectedLockVersion: string;
  role: CreationMediaRole;
  expectedAssetId: string | null;
  rightsConfirmed: boolean;
  alt: string | null;
  path: string;
  originalFilename: string;
  mimeType: "image/webp" | "audio/mpeg" | "video/mp4";
  extension: "webp" | "mp3" | "mp4";
  sizeBytes: number;
  width: number | null;
  height: number | null;
  durationMs: number | null;
  checksumSha256: string;
  cleanup(): Promise<void>;
};

export type CreationMediaRequestErrorCode =
  | "INVALID_MULTIPART"
  | "LENGTH_REQUIRED"
  | "FILE_TOO_LARGE"
  | "EMPTY_FILE"
  | "UNSUPPORTED_FORMAT"
  | "DECODE_FAILED"
  | "INVALID_FIELDS";

export class CreationMediaRequestError extends Error {
  constructor(readonly code: CreationMediaRequestErrorCode) {
    super(code);
    this.name = "CreationMediaRequestError";
  }
}

function requestedRole(request: Request): CreationMediaRole {
  const role = request.headers.get("x-lnx-creation-media-role")?.toUpperCase();
  if (role === "COVER" || role === "VIDEO_POSTER" || role === "AUDIO" || role === "VIDEO") return role;
  throw new CreationMediaRequestError("INVALID_FIELDS");
}

async function signature(target: string) {
  const handle = await open(target, "r");
  try {
    const bytes = Buffer.alloc(16);
    const result = await handle.read(bytes, 0, bytes.length, 0);
    return bytes.subarray(0, result.bytesRead);
  } finally {
    await handle.close();
  }
}

function isMp3(bytes: Buffer) {
  return bytes.subarray(0, 3).toString("ascii") === "ID3"
    || (bytes.length >= 2 && bytes[0] === 0xff && (bytes[1]! & 0xe0) === 0xe0);
}

function isMp4(bytes: Buffer) {
  return bytes.length >= 12 && bytes.subarray(4, 8).toString("ascii") === "ftyp";
}

function extension(filename: string) {
  return path.extname(filename).toLowerCase();
}

async function normalizeAndInspect(
  role: CreationMediaRole,
  target: string,
  file: { filename: string; mimeType: string; sizeBytes: number; checksumSha256: string },
) {
  const originalFilename = sanitizeOriginalFilename(file.filename);
  const bytes = await signature(target);
  if (role === "COVER" || role === "VIDEO_POSTER") {
    if (!new Set(["image/jpeg", "image/png", "image/webp"]).has(file.mimeType.toLowerCase())) {
      throw new CreationMediaRequestError("UNSUPPORTED_FORMAT");
    }
    const source = await readFile(target);
    try {
      const normalized = await normalizeAdminImage(
        new File([source], originalFilename, { type: file.mimeType.toLowerCase() }),
        "contained-product",
      );
      await writeFile(target, normalized.bytes, { mode: 0o600 });
      return {
        originalFilename: `${path.basename(originalFilename, extension(originalFilename)) || "visuel"}.webp`,
        mimeType: "image/webp" as const,
        extension: "webp" as const,
        sizeBytes: normalized.bytes.length,
        width: normalized.width,
        height: normalized.height,
        durationMs: null,
        checksumSha256: createHash("sha256").update(normalized.bytes).digest("hex"),
      };
    } catch {
      throw new CreationMediaRequestError("DECODE_FAILED");
    }
  }
  if (role === "AUDIO") {
    if (file.mimeType.toLowerCase() !== "audio/mpeg" || extension(originalFilename) !== ".mp3" || !isMp3(bytes)) {
      throw new CreationMediaRequestError("UNSUPPORTED_FORMAT");
    }
    try {
      const audio = await validateCompleteAudioSource(target);
      return {
        originalFilename,
        mimeType: "audio/mpeg" as const,
        extension: "mp3" as const,
        sizeBytes: file.sizeBytes,
        width: null,
        height: null,
        durationMs: audio.durationMs,
        checksumSha256: file.checksumSha256,
      };
    } catch {
      throw new CreationMediaRequestError("DECODE_FAILED");
    }
  }
  if (file.mimeType.toLowerCase() !== "video/mp4" || extension(originalFilename) !== ".mp4" || !isMp4(bytes)) {
    throw new CreationMediaRequestError("UNSUPPORTED_FORMAT");
  }
  try {
    const video = await validateCreationVideo(target);
    return {
      originalFilename,
      mimeType: "video/mp4" as const,
      extension: "mp4" as const,
      sizeBytes: file.sizeBytes,
      width: video.width,
      height: video.height,
      durationMs: video.durationMs,
      checksumSha256: file.checksumSha256,
    };
  } catch {
    throw new CreationMediaRequestError("DECODE_FAILED");
  }
}

export async function readCreationMediaUpload(request: Request): Promise<CreationMediaUpload> {
  const role = requestedRole(request);
  const maximumBytes = maximumByRole[role];
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType) || !/boundary\s*=/i.test(contentType)) {
    throw new CreationMediaRequestError("INVALID_MULTIPART");
  }
  const declaredLength = request.headers.get("content-length");
  if (!declaredLength) throw new CreationMediaRequestError("LENGTH_REQUIRED");
  const parsedLength = Number(declaredLength);
  if (!Number.isSafeInteger(parsedLength) || parsedLength <= 0) throw new CreationMediaRequestError("INVALID_MULTIPART");
  if (parsedLength > maximumBytes + 256 * 1024) throw new CreationMediaRequestError("FILE_TOO_LARGE");
  if (!request.body) throw new CreationMediaRequestError("INVALID_MULTIPART");

  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), "lnx-creation-media-"));
  const target = path.join(temporaryDirectory, "source");
  const fields = new Map<string, string>();
  type PendingFile = { filename: string; mimeType: string; sizeBytes: number; checksumSha256: string };
  let filePromise: Promise<PendingFile> | null = null;
  let filePipelineError: unknown = null;
  let parserError: CreationMediaRequestError | null = null;
  const acceptedFields = new Set([
    "creationId",
    "slug",
    "expectedLockVersion",
    "expectedAssetId",
    "role",
    "rightsConfirmed",
    "alt",
  ]);
  const parser = Busboy({
    headers: { "content-type": contentType },
    // One item of headroom lets Busboy emit an unexpected field/part so the
    // closed payload check can reject it deterministically. Valid payloads do
    // not sit exactly on a limit event boundary.
    limits: { files: 1, fields: acceptedFields.size + 1, parts: acceptedFields.size + 3, fieldSize: 2_000, fileSize: maximumBytes },
  });

  parser.on("field", (name, value, info) => {
    if (!acceptedFields.has(name) || info.valueTruncated || fields.has(name)) {
      parserError = new CreationMediaRequestError("INVALID_FIELDS");
    }
    else fields.set(name, value);
  });
  parser.on("file", (name, file, info) => {
    if (name !== "media" || filePromise) {
      parserError = new CreationMediaRequestError("INVALID_MULTIPART");
      file.resume();
      return;
    }
    filePromise = (async () => {
      const hash = createHash("sha256");
      let sizeBytes = 0;
      file.on("data", (chunk: Buffer) => { sizeBytes += chunk.length; hash.update(chunk); });
      file.once("limit", () => { parserError = new CreationMediaRequestError("FILE_TOO_LARGE"); });
      await pipeline(file, createWriteStream(target, { flags: "wx", mode: 0o600 }));
      return { filename: info.filename, mimeType: info.mimeType, sizeBytes, checksumSha256: hash.digest("hex") };
    })().catch((error: unknown) => {
      filePipelineError = error;
      throw error;
    });
  });
  const invalidate = () => { parserError = new CreationMediaRequestError("INVALID_MULTIPART"); };
  parser.once("filesLimit", invalidate);
  parser.once("fieldsLimit", invalidate);
  parser.once("partsLimit", invalidate);
  let receivedBytes = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      receivedBytes += chunk.length;
      if (receivedBytes > maximumBytes + 256 * 1024) callback(new CreationMediaRequestError("FILE_TOO_LARGE"));
      else callback(null, chunk);
    },
  });

  try {
    await pipeline(Readable.fromWeb(request.body as never), counter, parser);
    if (receivedBytes !== parsedLength) throw new CreationMediaRequestError("INVALID_MULTIPART");
    const completedFile = filePromise ? await (filePromise as Promise<PendingFile>) : null;
    if (filePipelineError) throw filePipelineError;
    if (parserError) throw parserError;
    if (!completedFile || completedFile.sizeBytes <= 0) throw new CreationMediaRequestError("EMPTY_FILE");
    if (
      fields.size !== acceptedFields.size
      || [...acceptedFields].some((field) => !fields.has(field))
      || fields.get("role") !== role
      || fields.get("rightsConfirmed") !== "on"
    ) throw new CreationMediaRequestError("INVALID_FIELDS");
    const inspected = await normalizeAndInspect(role, target, completedFile);
    return {
      creationId: fields.get("creationId") ?? "",
      slug: fields.get("slug") ?? "",
      expectedLockVersion: fields.get("expectedLockVersion") ?? "",
      role,
      expectedAssetId: fields.get("expectedAssetId") || null,
      rightsConfirmed: fields.get("rightsConfirmed") === "on",
      alt: optionalText(fields.get("alt"), "Le texte alternatif", 500),
      path: target,
      ...inspected,
      cleanup: () => rm(temporaryDirectory, { recursive: true, force: true }),
    };
  } catch (error) {
    await (filePromise as Promise<void> | null)?.catch(() => undefined);
    await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
    if (error instanceof CreationMediaRequestError) throw error;
    throw new CreationMediaRequestError("INVALID_MULTIPART");
  }
}

export async function readCreationMediaJson(request: Request) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json" || !request.body) {
    throw new CreationMediaRequestError("INVALID_FIELDS");
  }
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0 || length > 4_096) {
      throw new CreationMediaRequestError("INVALID_FIELDS");
    }
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > 4_096) {
      await reader.cancel();
      throw new CreationMediaRequestError("INVALID_FIELDS");
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks, received).toString("utf8")) as unknown;
  } catch {
    throw new CreationMediaRequestError("INVALID_FIELDS");
  }
}
