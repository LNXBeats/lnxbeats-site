import "server-only";

import { spawn } from "node:child_process";

import ffmpegStatic from "ffmpeg-static";

const MAXIMUM_DIAGNOSTIC_BYTES = 64 * 1024;

export class CatalogFfmpegError extends Error {
  constructor(readonly code: "FFMPEG_UNAVAILABLE" | "ANALYSIS_FAILED" | "GENERATION_FAILED" | "TIMEOUT") {
    super(code);
    this.name = "CatalogFfmpegError";
  }
}

export function catalogFfmpegPath() {
  const configured = process.env.FFMPEG_PATH?.trim();
  if (configured) return configured;
  if (ffmpegStatic) return ffmpegStatic;
  throw new CatalogFfmpegError("FFMPEG_UNAVAILABLE");
}

function runFfmpeg(args: string[], timeoutMs: number, acceptNonZero = false) {
  return new Promise<{ stderr: string; elapsedMs: number }>((resolve, reject) => {
    const startedAt = performance.now();
    let stderr = "";
    let settled = false;
    const child = spawn(catalogFfmpegPath(), ["-nostdin", "-hide_banner", ...args], {
      shell: false,
      stdio: ["ignore", "ignore", "pipe"],
      env: { ...process.env, AV_LOG_FORCE_NOCOLOR: "1" },
    });
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      if (!settled) {
        settled = true;
        reject(new CatalogFfmpegError("TIMEOUT"));
      }
    }, timeoutMs);
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < MAXIMUM_DIAGNOSTIC_BYTES) stderr += chunk.slice(0, MAXIMUM_DIAGNOSTIC_BYTES - stderr.length);
    });
    child.once("error", () => {
      clearTimeout(timeout);
      if (!settled) {
        settled = true;
        reject(new CatalogFfmpegError("FFMPEG_UNAVAILABLE"));
      }
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (settled) return;
      settled = true;
      if (code !== 0 && !acceptNonZero) reject(new CatalogFfmpegError("GENERATION_FAILED"));
      else resolve({ stderr, elapsedMs: Math.round(performance.now() - startedAt) });
    });
  });
}

function durationFromFfmpeg(stderr: string) {
  const match = stderr.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (!match || !/Audio:\s/.test(stderr)) throw new CatalogFfmpegError("ANALYSIS_FAILED");
  const durationMs = Math.round((Number(match[1]) * 3_600 + Number(match[2]) * 60 + Number(match[3])) * 1_000);
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0) throw new CatalogFfmpegError("ANALYSIS_FAILED");
  return durationMs;
}

export async function analyzeAudioSource(sourcePath: string) {
  // With no output target FFmpeg parses the container and reports duration,
  // codecs and streams without decoding the complete source.
  const result = await runFfmpeg(["-i", sourcePath], 15_000, true);
  return { durationMs: durationFromFfmpeg(result.stderr), elapsedMs: result.elapsedMs };
}

export async function generateCatalogMp3Preview({
  sourcePath,
  outputPath,
  offsetMs,
  durationMs,
}: {
  sourcePath: string;
  outputPath: string;
  offsetMs: number;
  durationMs: number;
}) {
  const result = await runFfmpeg([
    "-loglevel", "error",
    "-i", sourcePath,
    "-ss", (offsetMs / 1_000).toFixed(3),
    "-t", (durationMs / 1_000).toFixed(3),
    "-map", "0:a:0",
    "-vn",
    "-sn",
    "-dn",
    "-map_metadata", "-1",
    "-map_chapters", "-1",
    "-ac", "2",
    "-ar", "44100",
    "-c:a", "libmp3lame",
    "-b:a", "192k",
    "-id3v2_version", "0",
    "-write_id3v1", "0",
    "-write_xing", "1",
    "-y",
    outputPath,
  ], 120_000);
  return { elapsedMs: result.elapsedMs };
}
