import { DigitalError } from "./domain";
import { safeContentDisposition } from "@/lib/media/storage/policy";
export const DIGITAL_DOWNLOAD_TTL_MS = 30 * 60000;
export function digitalByteRange(raw: string | null, size: number) {
  if (!raw) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(raw);
  if (!m || !m[1] && !m[2]) throw new DigitalError("RANGE_NOT_SATISFIABLE", 416);
  const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
  const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start || start >= size || !m[1] && Number(m[2]) === 0) throw new DigitalError("RANGE_NOT_SATISFIABLE", 416);
  return { start, end };
}
export function digitalAttachment(filename: string) {
  const safe = filename.normalize("NFC").replace(/[\r\n\x00-\x1f\\/]/g, "-").slice(0, 180);
  return `${safeContentDisposition("attachment", safe)}; filename*=UTF-8''${encodeURIComponent(safe).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`;
}
