export type CreationMediaRole = "COVER" | "VIDEO_POSTER" | "AUDIO" | "VIDEO";

export const CREATION_IMAGE_MAXIMUM_BYTES = 10 * 1024 * 1024;
export const CREATION_AUDIO_MAXIMUM_BYTES = 80 * 1024 * 1024;
export const CREATION_VIDEO_MAXIMUM_BYTES = 500 * 1024 * 1024;

export const CREATION_VIDEO_INPUT_FORMATS = [
  { extension: "mp4", mimeTypes: ["video/mp4"] },
  { extension: "mov", mimeTypes: ["video/quicktime", "video/mp4"] },
  { extension: "m4v", mimeTypes: ["video/x-m4v", "video/mp4"] },
  { extension: "webm", mimeTypes: ["video/webm"] },
] as const;

export type CreationVideoInputMimeType = (typeof CREATION_VIDEO_INPUT_FORMATS)[number]["mimeTypes"][number];

export function creationVideoInputFormat(filename: string, mimeType: string) {
  const extension = filename.trim().toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  return CREATION_VIDEO_INPUT_FORMATS.find((format) => (
    format.extension === extension && (format.mimeTypes as readonly string[]).includes(mimeType.toLowerCase())
  )) ?? null;
}

export function creationVideoMimeForFilename(filename: string, browserMimeType = "") {
  const extension = filename.trim().toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  const format = CREATION_VIDEO_INPUT_FORMATS.find((candidate) => candidate.extension === extension);
  if (!format) return null;
  const supplied = browserMimeType.trim().toLowerCase();
  if (supplied && (format.mimeTypes as readonly string[]).includes(supplied)) return supplied as CreationVideoInputMimeType;
  return format.mimeTypes[0];
}

export const CREATION_MEDIA_DELETION_CONFIRMATION = "CONFIRM_CREATION_MEDIA_DELETION";
