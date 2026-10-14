import "server-only";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { catalogFfmpegPath } from "@/lib/catalog/ffmpeg";
import { DigitalError, previewWindow } from "./domain";
import { DIGITAL_WORK_LIMITS } from "./work-slots";
const exec = promisify(execFile);
export const DIGITAL_MP3_ENCODER_VERSION = "ffmpeg-libmp3lame-cbr-v1";
export const DIGITAL_MP3_LIMIT_BYTES = 96 * 1024 * 1024;
export function digitalMp3Bitrate(value = process.env.DCN_MP3_BITRATE_KBPS) {
  const bitrate = value === undefined || value === "" ? 320 : Number(value);
  if (![192, 256, 320].includes(bitrate)) throw new DigitalError("INVALID_MP3_BITRATE_CONFIGURATION", 503);
  return bitrate;
}
/** DCN opt-in hardening: no shell, no network protocols, bounded stderr, threads/allocation/time/RSS. */
async function run(args: string[], signal: AbortSignal, timeoutMs: number, parseOnly = false,stats?:{rssPeak:number;samples:number}) {
  if (signal.aborted) throw new DigitalError("LEASE_LOST");
  return new Promise<string>((resolve, reject) => {
    let stderr = "", failure: Error | null = null, sampling = false;
    const child = spawn(catalogFfmpegPath(), ["-nostdin", "-hide_banner", "-max_alloc", "67108864", "-threads", "1", "-filter_threads", "1", "-protocol_whitelist", "file,pipe", ...args], { shell: false, stdio: ["ignore", "ignore", "pipe"], env: { PATH: process.env.PATH, NODE_ENV: process.env.NODE_ENV, AV_LOG_FORCE_NOCOLOR: "1" } });
    const abort = () => { failure = new DigitalError("LEASE_LOST"); child.kill("SIGKILL"); }; signal.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => { failure = new DigitalError("FFMPEG_TIMEOUT"); child.kill("SIGKILL"); }, timeoutMs);
    const monitor = setInterval(() => { if (sampling || !child.pid) return; sampling = true;
      void exec("ps", ["-o", "rss=", "-p", String(child.pid)], { timeout: 1000, maxBuffer: 1024 }).then(r => {
        const rss=Number(r.stdout.trim())*1024;if(stats&&Number.isFinite(rss)&&rss>0){stats.samples++;stats.rssPeak=Math.max(stats.rssPeak,rss);}
        if (rss > DIGITAL_WORK_LIMITS.ffmpegRssBytes || process.memoryUsage().rss > DIGITAL_WORK_LIMITS.nodeRssBytes) { failure = new DigitalError("WORKER_MEMORY_LIMIT"); child.kill("SIGKILL"); }
      }).catch(() => undefined).finally(() => { sampling = false; });
    }, 25);
    child.stderr.on("data", chunk => { if (stderr.length < 65536) stderr += String(chunk).slice(0, 65536 - stderr.length); });
    child.once("error", () => { failure = new DigitalError("FFMPEG_UNAVAILABLE"); });
    child.once("close", code => { clearTimeout(timeout); clearInterval(monitor); signal.removeEventListener("abort", abort);
      if (failure) reject(failure); else if (code !== 0 && !parseOnly) reject(new DigitalError("INVALID_AUDIO")); else resolve(stderr); });
  });
}
function duration(stderr: string) {
  const match = stderr.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (!match || !/Audio:\s/.test(stderr) || /Video:\s/.test(stderr)) throw new DigitalError("INVALID_AUDIO");
  const ms = Math.round((Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])) * 1000);
  if (ms < 1 || ms > DIGITAL_WORK_LIMITS.durationMs) throw new DigitalError("AUDIO_DURATION_LIMIT");
  return ms;
}
export async function validateDigitalAudio(source: string, output: string, offsetMs: number, signal: AbortSignal) {
  const stats={rssPeak:0,samples:0};
  const durationMs = duration(await run(["-i", source], signal, 15000, true,stats));
  await run(["-v", "error", "-i", source, "-map", "0:a:0", "-vn", "-sn", "-dn", "-threads", "1", "-f", "null", "-"], signal, 180000,false,stats);
  const window = previewWindow(durationMs, offsetMs);
  await run(["-loglevel", "error", "-i", source, "-ss", (window.startMs / 1000).toFixed(3), "-t", (window.durationMs / 1000).toFixed(3), "-map", "0:a:0", "-vn", "-sn", "-dn", "-map_metadata", "-1", "-map_chapters", "-1", "-ac", "2", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "192k", "-threads", "1", "-fs", "3145728", "-id3v2_version", "0", "-write_id3v1", "0", "-write_xing", "1", "-y", output], signal, 120000,false,stats);
  const previewDurationMs = duration(await run(["-i", output], signal, 15000, true,stats));
  if (previewDurationMs > 60000) throw new DigitalError("INVALID_PREVIEW_DURATION");
  return { durationMs, previewDurationMs,ffmpegRssPeak:stats.samples?stats.rssPeak:"NOT_MEASURED",ffmpegSamples:stats.samples };
}

/** Full private rendition, streamed from disk; no full-source/full-output Buffer. */
export async function generateDigitalMp3(source: string, output: string, sourceDurationMs: number, signal: AbortSignal) {
  const bitrateKbps = digitalMp3Bitrate(), stats = { rssPeak: 0, samples: 0 };
  const sourceProbe = await run(["-i", source], signal, 15000, true, stats);
  if (!/Audio:\s*pcm_(?:s|u|f)\w*/.test(sourceProbe) || !/Input #0, wav,/.test(sourceProbe)) throw new DigitalError("WAV_SOURCE_REQUIRED");
  await run(["-loglevel", "error", "-i", source, "-map", "0:a:0", "-vn", "-sn", "-dn", "-map_metadata", "-1", "-map_chapters", "-1",
    "-ac", "2", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", `${bitrateKbps}k`, "-threads", "1", "-fs", String(DIGITAL_MP3_LIMIT_BYTES),
    "-id3v2_version", "0", "-write_id3v1", "0", "-write_xing", "1", "-y", output], signal, 180000, false, stats);
  const probe = await run(["-i", output], signal, 15000, true, stats), durationMs = duration(probe);
  const audioBitrate = Number(probe.match(/Audio:\s*mp3[^\n]*,\s*(\d+) kb\/s/)?.[1]);
  if (!/Input #0, mp3,/.test(probe) || !/Audio:\s*mp3/.test(probe) || audioBitrate !== bitrateKbps
    || Math.abs(durationMs - sourceDurationMs) > 100) throw new DigitalError("MP3_RENDITION_INTEGRITY");
  await run(["-v", "error", "-i", output, "-map", "0:a:0", "-vn", "-sn", "-dn", "-f", "null", "-"], signal, 180000, false, stats);
  return { durationMs, bitrateKbps, encoderVersion: DIGITAL_MP3_ENCODER_VERSION, codec: "mp3", probe: "FFMPEG_BOUNDED_DECODE_PROBE", ffmpegRssPeak: stats.samples ? stats.rssPeak : "NOT_MEASURED", ffmpegSamples: stats.samples };
}
