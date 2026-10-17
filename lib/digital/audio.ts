import "server-only";
import { catalogFfmpegPath } from "@/lib/catalog/ffmpeg";
import { DigitalError, previewWindow } from "./domain";
import { DIGITAL_WORK_LIMITS } from "./work-slots";
import { inspectDigitalWav } from "./wav-validation";
import { inspectDigitalMp3 } from "./mp3-validation";
import { DIGITAL_MP3_ENCODER_VERSION } from "./formats";
import { runMonitoredFfmpeg } from "./ffmpeg-monitor";
export { DIGITAL_MP3_ENCODER_VERSION } from "./formats";
export const DIGITAL_MP3_LIMIT_BYTES = 96 * 1024 * 1024;
export function digitalMp3Bitrate(value = process.env.DCN_MP3_BITRATE_KBPS) {
  const bitrate = value === undefined || value === "" ? 320 : Number(value);
  if (![192, 256, 320].includes(bitrate)) throw new DigitalError("INVALID_MP3_BITRATE_CONFIGURATION", 503);
  return bitrate;
}
/** DCN opt-in hardening: no shell, no network protocols, bounded stderr, threads/allocation/time/RSS. */
async function run(args: string[], signal: AbortSignal, timeoutMs: number, parseOnly = false,stats?:{rssPeak:number;samples:number}) {
  return runMonitoredFfmpeg(catalogFfmpegPath(), args, signal, timeoutMs, DIGITAL_WORK_LIMITS, parseOnly, stats);
}
function duration(stderr: string) {
  const match = stderr.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (!match || !/Audio:\s/.test(stderr) || /Video:\s/.test(stderr)) throw new DigitalError("INVALID_AUDIO");
  const ms = Math.round((Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])) * 1000);
  if (ms < 1 || ms > DIGITAL_WORK_LIMITS.durationMs) throw new DigitalError("AUDIO_DURATION_LIMIT");
  return ms;
}
/** Fail on decoder errors even when FFmpeg would otherwise recover and exit zero. */
async function strictDecode(source: string, signal: AbortSignal, stats: { rssPeak: number; samples: number }) {
  const result = await run(["-v", "error", "-xerror", "-err_detect", "explode", "-i", source, "-map", "0:a:0", "-vn", "-sn", "-dn", "-threads", "1", "-progress", "pipe:2", "-nostats", "-f", "null", "-"], signal, 180000, false, stats);
  const times = Array.from(result.matchAll(/^out_time_us=(\d+)$/gm), match => Number(match[1]));
  const durationMs = Math.round((times.at(-1) ?? 0) / 1000);
  if (!Number.isSafeInteger(durationMs) || durationMs < 1 || !/^progress=end$/m.test(result)
    || result.split(/\r?\n/).some(line => line.trim() && !/^[a-zA-Z0-9_]+=/.test(line))) throw new DigitalError("INVALID_AUDIO");
  return durationMs;
}
function assertDecodedDuration(decodedMs: number, declaredMs: number, toleranceMs = 100) {
  if (Math.abs(decodedMs - declaredMs) > toleranceMs) throw new DigitalError("AUDIO_DURATION_MISMATCH");
}
/** Public previews and private MP3 renditions both require a genuine MPEG audio stream. */
export async function validateDigitalMp3(source: string, signal: AbortSignal, expected?: { durationMs: number; bitrateKbps?: number }, stats = { rssPeak: 0, samples: 0 }) {
  const structure = await inspectDigitalMp3(source, signal);
  if (expected && structure.xingFrames === null) throw new DigitalError("MP3_RENDITION_INTEGRITY");
  const probe = await run(["-i", source], signal, 15000, true, stats), durationMs = duration(probe);
  const streams = Array.from(probe.matchAll(/Stream #\d+:\d+(?:\[[^\]]+\])?[^\n]*: (Audio|Video|Subtitle|Data):/g));
  const bitrateKbps = Number(probe.match(/Audio:\s*mp3[^\n]*,\s*(\d+) kb\/s/)?.[1]);
  if (!/Input #0, mp3,/.test(probe) || !/Audio:\s*mp3/.test(probe) || streams.length !== 1 || streams[0]?.[1] !== "Audio"
    || !Number.isFinite(bitrateKbps) || (expected?.bitrateKbps !== undefined && (bitrateKbps !== expected.bitrateKbps
      || structure.bitrates.some(bitrate => bitrate !== expected.bitrateKbps)))) throw new DigitalError("MP3_RENDITION_INTEGRITY");
  const decodedDurationMs = await strictDecode(source, signal, stats);
  assertDecodedDuration(decodedDurationMs, durationMs);
  if (expected) assertDecodedDuration(decodedDurationMs, expected.durationMs);
  return { durationMs, decodedDurationMs, bitrateKbps, codec: "mp3" as const, probe: "FFMPEG_STRICT_COMPLETE_DECODE" as const };
}
export async function validateDigitalAudio(source: string, output: string, offsetMs: number, signal: AbortSignal) {
  const stats={rssPeak:0,samples:0};
  if (signal.aborted) throw new DigitalError("LEASE_LOST");
  const wav = await inspectDigitalWav(source), sourceProbe = await run(["-i", source], signal, 15000, true,stats);
  if (!/Input #0, wav,/.test(sourceProbe) || !/Audio:\s*pcm_(?:s|u|f)\w*/.test(sourceProbe)) throw new DigitalError("WAV_SOURCE_REQUIRED");
  const durationMs = wav.durationMs;
  assertDecodedDuration(duration(sourceProbe), durationMs);
  assertDecodedDuration(await strictDecode(source, signal, stats), durationMs);
  const window = previewWindow(durationMs, offsetMs);
  await run(["-loglevel", "error", "-i", source, "-ss", (window.startMs / 1000).toFixed(3), "-t", (window.durationMs / 1000).toFixed(3), "-map", "0:a:0", "-vn", "-sn", "-dn", "-map_metadata", "-1", "-map_chapters", "-1", "-ac", "2", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "192k", "-threads", "1", "-fs", "3145728", "-id3v2_version", "0", "-write_id3v1", "0", "-write_xing", "1", "-y", output], signal, 120000,false,stats);
  const previewDurationMs = (await validateDigitalMp3(output, signal, { durationMs: window.durationMs, bitrateKbps: 192 }, stats)).durationMs;
  if (previewDurationMs > 60000) throw new DigitalError("INVALID_PREVIEW_DURATION");
  return { durationMs, previewDurationMs,ffmpegRssPeak:stats.samples?stats.rssPeak:"NOT_MEASURED",ffmpegSamples:stats.samples };
}

/** Full private rendition, streamed from disk; no full-source/full-output Buffer. */
export async function generateDigitalMp3(source: string, output: string, sourceDurationMs: number, signal: AbortSignal) {
  const bitrateKbps = digitalMp3Bitrate(), stats = { rssPeak: 0, samples: 0 };
  const sourceProbe = await run(["-i", source], signal, 15000, true, stats);
  if (!/Audio:\s*pcm_(?:s|u|f)\w*/.test(sourceProbe) || !/Input #0, wav,/.test(sourceProbe)) throw new DigitalError("WAV_SOURCE_REQUIRED");
  const wav = await inspectDigitalWav(source);
  assertDecodedDuration(wav.durationMs, sourceDurationMs, 1);
  assertDecodedDuration(await strictDecode(source, signal, stats), wav.durationMs);
  await run(["-loglevel", "error", "-i", source, "-map", "0:a:0", "-vn", "-sn", "-dn", "-map_metadata", "-1", "-map_chapters", "-1",
    "-ac", "2", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", `${bitrateKbps}k`, "-threads", "1", "-fs", String(DIGITAL_MP3_LIMIT_BYTES),
    "-id3v2_version", "0", "-write_id3v1", "0", "-write_xing", "1", "-y", output], signal, 180000, false, stats);
  const validated = await validateDigitalMp3(output, signal, { durationMs: sourceDurationMs, bitrateKbps }, stats);
  return { ...validated, bitrateKbps, encoderVersion: DIGITAL_MP3_ENCODER_VERSION, ffmpegRssPeak: stats.samples ? stats.rssPeak : "NOT_MEASURED", ffmpegSamples: stats.samples };
}
