/** Presentation only: never grants ownership, payment or access rights. */
export const DIGITAL_LIBRARY_PAGE_SIZE = 20;
export function parseDigitalLibraryPage(value: string | string[] | undefined) {
  if (typeof value !== "string" || !/^[1-9]\d{0,5}$/.test(value)) return 1;
  return Number(value);
}
export function digitalLibraryPagination(requestedPage: number, total: number) {
  const totalPages = Math.max(1, Math.ceil(total / DIGITAL_LIBRARY_PAGE_SIZE));
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, totalPages) : 1;
  return { page, pageSize: DIGITAL_LIBRARY_PAGE_SIZE, total, totalPages, hasNext: page < totalPages, hasPrevious: page > 1 };
}
export function digitalTimeLabel(milliseconds: number | null | undefined) {
  if (milliseconds == null || !Number.isFinite(milliseconds) || milliseconds < 0) return null;
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
export function digitalFileFormat(mimeType: string | null | undefined) {
  if (["audio/wav", "audio/x-wav", "audio/wave"].includes(mimeType ?? "")) return "WAV";
  if (mimeType === "audio/mpeg") return "MP3";
  if (["audio/flac", "audio/x-flac"].includes(mimeType ?? "")) return "FLAC";
  return null;
}
export function digitalSizeLabel(bytes: number | null | undefined) {
  if (bytes == null || !Number.isSafeInteger(bytes) || bytes <= 0) return null;
  return bytes >= 1024 * 1024
    ? `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(bytes / 1024 / 1024)} Mio`
    : `${new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 }).format(bytes / 1024)} Kio`;
}
export function digitalArchiveLabel(status: string | null | undefined) {
  if (status === "READY") return "Album ZIP prêt";
  if (["PENDING", "PROCESSING"].includes(status ?? "")) return "Album ZIP en préparation";
  if (status === "REQUIRES_REVIEW") return "Album ZIP indisponible — préparation à vérifier";
  return "Préparer l’album ZIP";
}
