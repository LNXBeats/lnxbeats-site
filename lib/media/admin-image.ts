import "server-only";

import path from "node:path";
import sharp from "sharp";

export const ADMIN_IMAGE_MAXIMUM_BYTES = 10 * 1024 * 1024;
export const ADMIN_IMAGE_MAXIMUM_PIXELS = 40_000_000;

const acceptedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);

export type AdminImageErrorCode =
  | "EMPTY_FILE"
  | "FILE_TOO_LARGE"
  | "UNSUPPORTED_FORMAT"
  | "MIME_MISMATCH"
  | "UNREADABLE_IMAGE"
  | "TOO_MANY_PIXELS";

export class AdminImageError extends Error {
  constructor(readonly code: AdminImageErrorCode) {
    super(code);
    this.name = "AdminImageError";
  }
}

function detectedMimeType(source: Buffer) {
  if (source.length >= 3 && source[0] === 0xff && source[1] === 0xd8 && source[2] === 0xff) return "image/jpeg";
  if (source.length >= 8 && source.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (source.length >= 12 && source.toString("ascii", 0, 4) === "RIFF" && source.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}

function hasMatchingExtension(filename: string, mimeType: string) {
  const extension = path.extname(filename).toLowerCase();
  if (!extension) return true;
  if (mimeType === "image/jpeg") return extension === ".jpg" || extension === ".jpeg";
  if (mimeType === "image/png") return extension === ".png";
  return mimeType === "image/webp" && extension === ".webp";
}

export async function normalizeAdminImage(
  file: File,
  profile: "square-cover" | "contained-product",
) {
  if (file.size <= 0) throw new AdminImageError("EMPTY_FILE");
  if (file.size > ADMIN_IMAGE_MAXIMUM_BYTES) throw new AdminImageError("FILE_TOO_LARGE");
  if (!acceptedTypes.has(file.type)) throw new AdminImageError("UNSUPPORTED_FORMAT");

  const source = Buffer.from(await file.arrayBuffer());
  if (source.byteLength !== file.size) throw new AdminImageError("UNREADABLE_IMAGE");
  const realMimeType = detectedMimeType(source);
  if (!realMimeType) throw new AdminImageError("UNSUPPORTED_FORMAT");
  if (file.type !== realMimeType || !hasMatchingExtension(file.name, realMimeType)) {
    throw new AdminImageError("MIME_MISMATCH");
  }

  try {
    const metadata = await sharp(source, { animated: false, limitInputPixels: false, failOn: "warning" }).metadata();
    if (!metadata.width || !metadata.height || metadata.pages && metadata.pages > 1) {
      throw new AdminImageError("UNREADABLE_IMAGE");
    }
    if (metadata.width * metadata.height > ADMIN_IMAGE_MAXIMUM_PIXELS) {
      throw new AdminImageError("TOO_MANY_PIXELS");
    }
    if (`image/${metadata.format}` !== realMimeType) throw new AdminImageError("MIME_MISMATCH");

    const image = sharp(source, {
      animated: false,
      limitInputPixels: ADMIN_IMAGE_MAXIMUM_PIXELS,
      failOn: "warning",
    }).rotate();
    const resized = profile === "square-cover"
      ? image.resize(1_600, 1_600, { fit: "cover", position: "centre", withoutEnlargement: false })
      : image.resize(1_600, 1_600, { fit: "inside", withoutEnlargement: true });
    const output = await resized.webp({ quality: 88, effort: 5 }).toBuffer({ resolveWithObject: true });
    return { bytes: output.data, width: output.info.width, height: output.info.height };
  } catch (error) {
    if (error instanceof AdminImageError) throw error;
    throw new AdminImageError("UNREADABLE_IMAGE");
  }
}
