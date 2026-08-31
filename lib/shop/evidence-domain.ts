import { createHash } from "node:crypto";
import path from "node:path";

export const SHOP_SAV_MAX_EVIDENCE_FILES = 5;
export const SHOP_SAV_MAX_EVIDENCE_BYTES = 5 * 1024 * 1024;

const definitions = {
  "image/jpeg": { extensions: new Set([".jpg", ".jpeg"]), magic: (bytes: Uint8Array) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff },
  "image/png": { extensions: new Set([".png"]), magic: (bytes: Uint8Array) => bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((value, index) => bytes[index] === value) },
  "image/webp": { extensions: new Set([".webp"]), magic: (bytes: Uint8Array) => bytes.length >= 12 && Buffer.from(bytes.subarray(0, 4)).toString("ascii") === "RIFF" && Buffer.from(bytes.subarray(8, 12)).toString("ascii") === "WEBP" },
} as const;

export type ShopSavEvidenceMime = keyof typeof definitions;

export class ShopEvidenceError extends Error {
  constructor(readonly code: "INVALID_FILE" | "FILE_TOO_LARGE" | "TOO_MANY_FILES" | "ACCESS_DENIED" | "STORAGE_DISABLED") {
    super(code);
    this.name = "ShopEvidenceError";
  }
}

export function validateShopEvidenceUpload(input: Readonly<{ name: string; type: string; bytes: Uint8Array }>) {
  if (
    !input.name
    || input.name.length > 240
    || input.name !== path.basename(input.name)
    || /[\\/\u0000-\u001f\u007f]/.test(input.name)
    || input.bytes.length < 12
  ) throw new ShopEvidenceError("INVALID_FILE");
  if (input.bytes.length > SHOP_SAV_MAX_EVIDENCE_BYTES) throw new ShopEvidenceError("FILE_TOO_LARGE");
  const definition = definitions[input.type as ShopSavEvidenceMime];
  const extension = path.extname(input.name).toLowerCase();
  if (!definition || !definition.extensions.has(extension as never) || !definition.magic(input.bytes)) {
    throw new ShopEvidenceError("INVALID_FILE");
  }
  return Object.freeze({
    originalName: input.name,
    mimeType: input.type as ShopSavEvidenceMime,
    extension: input.type === "image/jpeg" ? ".jpg" : extension,
    byteSize: input.bytes.length,
    sha256: createHash("sha256").update(input.bytes).digest("hex"),
  });
}

export function assertShopEvidenceCount(existing: number, added: number) {
  if (!Number.isSafeInteger(existing) || !Number.isSafeInteger(added) || added < 1 || existing < 0 || existing + added > SHOP_SAV_MAX_EVIDENCE_FILES) {
    throw new ShopEvidenceError("TOO_MANY_FILES");
  }
}
