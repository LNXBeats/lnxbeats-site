import "server-only";

import { createWriteStream } from "node:fs";
import { open, rm } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import Busboy from "busboy";

import { cleanupExpiredAudioSources, createAudioSourceTempPath } from "@/lib/catalog/audio-temp";

export const CATALOG_AUDIO_SOURCE_MAXIMUM_BYTES = 80 * 1024 * 1024;
export const CATALOG_AUDIO_TRANSPORT_MAXIMUM_BYTES = CATALOG_AUDIO_SOURCE_MAXIMUM_BYTES + 1024 * 1024;

export class CatalogAudioRequestError extends Error {
  constructor(readonly code: "INVALID_MULTIPART" | "TRANSPORT_TOO_LARGE" | "FILE_TOO_LARGE" | "UNSUPPORTED_FORMAT" | "EMPTY_FILE") {
    super(code);
    this.name = "CatalogAudioRequestError";
  }
}

export type CatalogAudioUpload = {
  projectId: string;
  slug: string;
  expectedAudioAssetId: string | null;
  rightsConfirmed: string;
  offsetMs: string;
  requestedDurationMs: string;
  source: {
    path: string;
    originalFilename: string;
    mimeType: string;
    sizeBytes: number;
    extension: ".mp3" | ".wav";
  };
};

const acceptedMimeTypes = {
  ".mp3": new Set(["", "audio/mpeg", "audio/mp3", "audio/x-mpeg", "application/octet-stream"]),
  ".wav": new Set(["", "audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave", "application/octet-stream"]),
} as const;

function sourceExtension(filename: string, mimeType: string) {
  const extension = path.extname(filename).toLowerCase();
  if (extension !== ".mp3" && extension !== ".wav") throw new CatalogAudioRequestError("UNSUPPORTED_FORMAT");
  if (!acceptedMimeTypes[extension].has(mimeType.toLowerCase())) throw new CatalogAudioRequestError("UNSUPPORTED_FORMAT");
  return extension;
}

async function validSourceSignature(target: string, extension: ".mp3" | ".wav") {
  const handle = await open(target, "r");
  try {
    const signature = Buffer.alloc(12);
    const { bytesRead } = await handle.read(signature, 0, signature.length, 0);
    if (bytesRead < 4) return false;
    if (extension === ".mp3") {
      return signature.subarray(0, 3).toString("ascii") === "ID3"
        || (signature[0] === 0xff && (signature[1]! & 0xe0) === 0xe0);
    }
    return bytesRead >= 12
      && signature.subarray(0, 4).toString("ascii") === "RIFF"
      && signature.subarray(8, 12).toString("ascii") === "WAVE";
  } finally {
    await handle.close();
  }
}

export async function readCatalogAudioUpload(request: Request): Promise<CatalogAudioUpload> {
  await cleanupExpiredAudioSources().catch(() => undefined);
  const contentType = request.headers.get("content-type") ?? "";
  if (!/^multipart\/form-data\s*;/i.test(contentType) || !/boundary\s*=/i.test(contentType)) {
    throw new CatalogAudioRequestError("INVALID_MULTIPART");
  }
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null) {
    const parsed = Number(declaredLength);
    if (!Number.isSafeInteger(parsed) || parsed < 0) throw new CatalogAudioRequestError("INVALID_MULTIPART");
    if (parsed > CATALOG_AUDIO_TRANSPORT_MAXIMUM_BYTES) throw new CatalogAudioRequestError("TRANSPORT_TOO_LARGE");
  }
  if (!request.body) throw new CatalogAudioRequestError("INVALID_MULTIPART");

  const fields = new Map<string, string>();
  let source: CatalogAudioUpload["source"] | null = null;
  let sourcePath: string | null = null;
  let filePromise: Promise<void> | null = null;
  let parserError: CatalogAudioRequestError | null = null;
  const parser = Busboy({
    headers: { "content-type": contentType },
    limits: { files: 1, fields: 8, parts: 9, fieldSize: 1_024, fileSize: CATALOG_AUDIO_SOURCE_MAXIMUM_BYTES },
  });

  parser.on("field", (name, value, info) => {
    if (info.valueTruncated || fields.has(name)) parserError = new CatalogAudioRequestError("INVALID_MULTIPART");
    else fields.set(name, value);
  });
  parser.on("file", (name, file, info) => {
    if (name !== "audio" || source || filePromise) {
      parserError = new CatalogAudioRequestError("INVALID_MULTIPART");
      file.resume();
      return;
    }
    let extension: ".mp3" | ".wav";
    try { extension = sourceExtension(info.filename, info.mimeType); }
    catch (error) {
      parserError = error instanceof CatalogAudioRequestError ? error : new CatalogAudioRequestError("UNSUPPORTED_FORMAT");
      file.resume();
      return;
    }
    filePromise = (async () => {
      sourcePath = await createAudioSourceTempPath(extension);
      let sizeBytes = 0;
      file.on("data", (chunk: Buffer) => { sizeBytes += chunk.length; });
      file.once("limit", () => { parserError = new CatalogAudioRequestError("FILE_TOO_LARGE"); });
      await pipeline(file, createWriteStream(sourcePath, { flags: "wx", mode: 0o600 }));
      if (sizeBytes <= 0) throw new CatalogAudioRequestError("EMPTY_FILE");
      if (sizeBytes > CATALOG_AUDIO_SOURCE_MAXIMUM_BYTES) throw new CatalogAudioRequestError("FILE_TOO_LARGE");
      source = { path: sourcePath, originalFilename: path.basename(info.filename), mimeType: info.mimeType, sizeBytes, extension };
    })();
  });
  parser.once("filesLimit", () => { parserError = new CatalogAudioRequestError("INVALID_MULTIPART"); });
  parser.once("fieldsLimit", () => { parserError = new CatalogAudioRequestError("INVALID_MULTIPART"); });
  parser.once("partsLimit", () => { parserError = new CatalogAudioRequestError("INVALID_MULTIPART"); });

  let received = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      received += chunk.length;
      if (received > CATALOG_AUDIO_TRANSPORT_MAXIMUM_BYTES) callback(new CatalogAudioRequestError("TRANSPORT_TOO_LARGE"));
      else callback(null, chunk);
    },
  });

  try {
    await pipeline(Readable.fromWeb(request.body as never), counter, parser);
    if (filePromise) await filePromise;
    if (parserError) throw parserError;
    if (!source) throw new CatalogAudioRequestError("EMPTY_FILE");
    const completedSource = source as CatalogAudioUpload["source"];
    if (!(await validSourceSignature(completedSource.path, completedSource.extension))) throw new CatalogAudioRequestError("UNSUPPORTED_FORMAT");
    return {
      projectId: fields.get("projectId") ?? "",
      slug: fields.get("slug") ?? "",
      expectedAudioAssetId: fields.get("expectedAudioAssetId") || null,
      rightsConfirmed: fields.get("rightsConfirmed") ?? "",
      offsetMs: fields.get("offsetMs") ?? "",
      requestedDurationMs: fields.get("requestedDurationMs") ?? "",
      source: completedSource,
    };
  } catch (error) {
    if (sourcePath) await rm(sourcePath, { force: true }).catch(() => undefined);
    if (error instanceof CatalogAudioRequestError) throw error;
    throw new CatalogAudioRequestError("INVALID_MULTIPART");
  }
}
