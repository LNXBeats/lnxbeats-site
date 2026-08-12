export type CatalogAudioByteRange = { start: number; end: number };

export class CatalogAudioRangeError extends Error {
  constructor() {
    super("INVALID_RANGE");
    this.name = "CatalogAudioRangeError";
  }
}

export function parseCatalogAudioRange(value: string | null, size: number): CatalogAudioByteRange | null {
  if (!value) return null;
  if (!Number.isSafeInteger(size) || size <= 0) throw new CatalogAudioRangeError();
  const match = value.match(/^bytes=(\d*)-(\d*)$/i);
  if (!match || (!match[1] && !match[2])) throw new CatalogAudioRangeError();

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) throw new CatalogAudioRangeError();
    return { start: Math.max(size - suffixLength, 0), end: size - 1 };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : size - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || requestedEnd < start || start >= size) {
    throw new CatalogAudioRangeError();
  }
  return { start, end: Math.min(requestedEnd, size - 1) };
}
