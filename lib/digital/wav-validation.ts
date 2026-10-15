import "server-only";
import { open, stat } from "node:fs/promises";
import { DigitalError } from "./domain";
import { DIGITAL_WORK_LIMITS } from "./work-slots";

/** Inspect RIFF chunk headers only. Audio data is decoded separately in a bounded child. */
export async function inspectDigitalWav(source: string) {
  const metadata = await stat(source);
  if (!metadata.isFile() || metadata.size < 44 || metadata.size > DIGITAL_WORK_LIMITS.masterBytes) throw new DigitalError("INVALID_WAV_STRUCTURE");
  const file = await open(source, "r");
  const read = async (offset: number, size: number) => {
    const bytes = Buffer.alloc(size);
    if ((await file.read(bytes, 0, size, offset)).bytesRead !== size) throw new DigitalError("INVALID_WAV_STRUCTURE");
    return bytes;
  };
  try {
    const header = await read(0, 12);
    if (header.toString("ascii", 0, 4) !== "RIFF" || header.toString("ascii", 8, 12) !== "WAVE"
      || header.readUInt32LE(4) + 8 !== metadata.size) throw new DigitalError("INVALID_WAV_STRUCTURE");
    let offset = 12, chunks = 0, format: { channels: number; sampleRate: number; blockAlign: number; bitsPerSample: number; encoding: "PCM" | "FLOAT" } | null = null;
    let dataSize: number | null = null;
    while (offset < metadata.size) {
      if (++chunks > 4096 || offset + 8 > metadata.size) throw new DigitalError("INVALID_WAV_STRUCTURE");
      const chunk = await read(offset, 8), id = chunk.toString("ascii", 0, 4), size = chunk.readUInt32LE(4), start = offset + 8;
      const next = start + size + (size % 2);
      if (next > metadata.size) throw new DigitalError("INVALID_WAV_STRUCTURE");
      if (id === "fmt ") {
        if (format || size < 16 || size > 65536) throw new DigitalError("INVALID_WAV_STRUCTURE");
        const fmt = await read(start, Math.min(size, 40));
        let encoding = fmt.readUInt16LE(0);
        const channels = fmt.readUInt16LE(2), sampleRate = fmt.readUInt32LE(4), byteRate = fmt.readUInt32LE(8), blockAlign = fmt.readUInt16LE(12), bitsPerSample = fmt.readUInt16LE(14);
        if (size !== 16 && (size < 18 || fmt.readUInt16LE(16) > size - 18)) throw new DigitalError("INVALID_WAV_STRUCTURE");
        if (encoding === 0xfffe) {
          if (size < 40 || fmt.readUInt16LE(16) < 22 || fmt.readUInt16LE(18) < 1 || fmt.readUInt16LE(18) > bitsPerSample
            || fmt.subarray(28, 40).toString("hex") !== "00001000800000aa00389b71") throw new DigitalError("INVALID_WAV_STRUCTURE");
          encoding = fmt.readUInt32LE(24);
        }
        if (![1, 3].includes(encoding) || !channels || channels > 64 || !sampleRate || sampleRate > 768000
          || ![8, 16, 24, 32, 64].includes(bitsPerSample) || (encoding === 3 && ![32, 64].includes(bitsPerSample))
          || blockAlign !== channels * bitsPerSample / 8 || byteRate !== sampleRate * blockAlign) throw new DigitalError("INVALID_WAV_STRUCTURE");
        format = { channels, sampleRate, blockAlign, bitsPerSample, encoding: encoding === 1 ? "PCM" : "FLOAT" };
      } else if (id === "data") {
        if (dataSize !== null || size < 1) throw new DigitalError("INVALID_WAV_STRUCTURE");
        dataSize = size;
      }
      offset = next;
    }
    if (!format || dataSize === null || dataSize % format.blockAlign !== 0) throw new DigitalError("INVALID_WAV_STRUCTURE");
    const samples = dataSize / format.blockAlign, durationMs = Math.round(samples * 1000 / format.sampleRate);
    if (durationMs < 1 || durationMs > DIGITAL_WORK_LIMITS.durationMs) throw new DigitalError("AUDIO_DURATION_LIMIT");
    return { ...format, samples, durationMs, sizeBytes: metadata.size, probe: "RIFF_CHUNKS_AND_FFMPEG_STRICT_DECODE" as const };
  } finally { await file.close(); }
}
