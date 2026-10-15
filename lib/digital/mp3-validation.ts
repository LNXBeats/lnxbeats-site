import "server-only";
import { open, stat } from "node:fs/promises";
import { DigitalError } from "./domain";

/** Bounded read window; verify every MPEG Layer III frame without loading the audio file. */
export async function inspectDigitalMp3(source: string, signal: AbortSignal) {
  const metadata = await stat(source);
  if (!metadata.isFile() || metadata.size < 4 || metadata.size >= 96 * 1024 * 1024) throw new DigitalError("INVALID_MP3_STRUCTURE");
  const file = await open(source, "r"), started = Date.now();
  let cache = Buffer.alloc(0), cacheStart = 0;
  const read = async (offset: number, size: number) => {
    if (offset + size > metadata.size) throw new DigitalError("INVALID_MP3_STRUCTURE");
    if (offset < cacheStart || offset + size > cacheStart + cache.length) {
      cacheStart = offset;
      cache = Buffer.alloc(Math.min(65536, metadata.size - offset));
      const result = await file.read(cache, 0, cache.length, offset);
      cache = cache.subarray(0, result.bytesRead);
    }
    if (offset + size > cacheStart + cache.length) throw new DigitalError("INVALID_MP3_STRUCTURE");
    return cache.subarray(offset - cacheStart, offset - cacheStart + size);
  };
  try {
    let offset = 0, frames = 0, xingFrames: number | null = null;
    const bitrates = new Set<number>();
    let profile: { version: number; sampleRate: number; channels: number } | null = null;
    const initial = await read(0, Math.min(10, metadata.size));
    if (initial.toString("ascii", 0, 3) === "ID3") {
      if (initial.length < 10 || ![2, 3, 4].includes(initial[3]!) || initial.subarray(6, 10).some(value => value >= 128)) throw new DigitalError("INVALID_MP3_STRUCTURE");
      const tagSize = initial[6]! * 2097152 + initial[7]! * 16384 + initial[8]! * 128 + initial[9]!;
      offset = 10 + tagSize + (initial[3] === 4 && (initial[5]! & 16) ? 10 : 0);
      if (offset >= metadata.size) throw new DigitalError("INVALID_MP3_STRUCTURE");
    }
    while (offset < metadata.size) {
      if (signal.aborted) throw new DigitalError("LEASE_LOST");
      if (Date.now() - started > 15000 || ++frames > 100000) throw new DigitalError("MP3_INSPECTION_LIMIT");
      if (metadata.size - offset === 128 && (await read(offset, 3)).toString("ascii") === "TAG") { frames--; offset = metadata.size; break; }
      const h = await read(offset, 4), version = (h[1]! >> 3) & 3, layer = (h[1]! >> 1) & 3, index = h[2]! >> 4, rateIndex = (h[2]! >> 2) & 3;
      if (h[0] !== 255 || (h[1]! & 224) !== 224 || version === 1 || layer !== 1 || index < 1 || index > 14 || rateIndex === 3) throw new DigitalError("INVALID_MP3_STRUCTURE");
      const bitrate = (version === 3 ? [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320] : [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160])[index]!;
      bitrates.add(bitrate);
      const sampleRate = [44100, 48000, 32000][rateIndex]! / (version === 3 ? 1 : version === 2 ? 2 : 4), channels = (h[3]! >> 6) === 3 ? 1 : 2;
      const frameSize = Math.floor((version === 3 ? 144000 : 72000) * bitrate / sampleRate) + ((h[2]! >> 1) & 1);
      if (frameSize < 4 || offset + frameSize > metadata.size || (profile && (profile.version !== version || profile.sampleRate !== sampleRate || profile.channels !== channels))) throw new DigitalError("INVALID_MP3_STRUCTURE");
      profile ??= { version, sampleRate, channels };
      if (frames === 1) {
        const sideInfo = version === 3 ? channels === 1 ? 17 : 32 : channels === 1 ? 9 : 17;
        const markerOffset = offset + 4 + ((h[1]! & 1) ? 0 : 2) + sideInfo;
        if (markerOffset + 12 <= offset + frameSize) {
          const marker = await read(markerOffset, 12);
          if (["Xing", "Info"].includes(marker.toString("ascii", 0, 4)) && (marker.readUInt32BE(4) & 1)) xingFrames = marker.readUInt32BE(8);
        }
      }
      offset += frameSize;
    }
    if (!profile || frames < 1 || (xingFrames !== null && (xingFrames < 1 || frames !== xingFrames + 1))) throw new DigitalError("INVALID_MP3_STRUCTURE");
    return { ...profile, frames, xingFrames, bitrates: Array.from(bitrates), sizeBytes: metadata.size, probe: "MPEG_LAYER_III_FRAMES_AND_FFMPEG_STRICT_DECODE" as const };
  } finally { await file.close(); }
}
