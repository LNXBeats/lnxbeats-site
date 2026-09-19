import "server-only";

import { spawn } from "node:child_process";

import { catalogFfmpegPath } from "@/lib/catalog/ffmpeg";

export const CREATION_VIDEO_MAXIMUM_DURATION_MS = 20 * 60 * 1_000;
export const CREATION_VIDEO_MAXIMUM_DIMENSION = 4_096;
export const CREATION_VIDEO_MAXIMUM_PIXELS = 4_096 * 4_096;
const CREATION_VIDEO_MINIMUM_VALIDATION_TIMEOUT_MS = 5 * 60 * 1_000;
const CREATION_VIDEO_MAXIMUM_VALIDATION_TIMEOUT_MS = 60 * 60 * 1_000;

export class CreationVideoError extends Error {
  constructor(readonly code: "UNREADABLE_VIDEO" | "UNSUPPORTED_CODEC" | "VIDEO_TOO_LONG" | "TIMEOUT" | "ABORTED") {
    super(code);
    this.name = "CreationVideoError";
  }
}

function runFfmpeg(args: string[], timeoutMs: number, acceptNonZero = false, signal?: AbortSignal) {
  return new Promise<string>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new CreationVideoError("ABORTED"));
      return;
    }
    let stderr = "";
    let settled = false;
    let terminationError: CreationVideoError | null = null;
    let forcedKill: NodeJS.Timeout | null = null;
    const child = spawn(catalogFfmpegPath(), ["-nostdin", "-hide_banner", ...args], {
      shell: false,
      stdio: ["ignore", "ignore", "pipe"],
      env: { ...process.env, AV_LOG_FORCE_NOCOLOR: "1" },
    });
    const stop = (error: CreationVideoError, graceful: boolean) => {
      if (settled || terminationError) return;
      terminationError = error;
      child.kill(graceful ? "SIGTERM" : "SIGKILL");
      if (graceful) {
        forcedKill = setTimeout(() => child.kill("SIGKILL"), 2_000);
        forcedKill.unref();
      }
    };
    const abort = () => stop(new CreationVideoError("ABORTED"), true);
    signal?.addEventListener("abort", abort, { once: true });
    const timeout = setTimeout(() => stop(new CreationVideoError("TIMEOUT"), false), timeoutMs);
    timeout.unref();
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < 128 * 1024) stderr += chunk.slice(0, 128 * 1024 - stderr.length);
    });
    child.once("error", () => {
      clearTimeout(timeout);
      if (forcedKill) clearTimeout(forcedKill);
      signal?.removeEventListener("abort", abort);
      if (!settled) {
        settled = true;
        reject(terminationError ?? new CreationVideoError("UNREADABLE_VIDEO"));
      }
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      if (forcedKill) clearTimeout(forcedKill);
      signal?.removeEventListener("abort", abort);
      if (settled) return;
      settled = true;
      if (terminationError) reject(terminationError);
      else if (code !== 0 && !acceptNonZero) reject(new CreationVideoError("UNREADABLE_VIDEO"));
      else resolve(stderr);
    });
  });
}

function parsedDuration(stderr: string) {
  const match = stderr.match(/Duration:\s*(\d{2}):(\d{2}):(\d{2}(?:\.\d+)?)/);
  if (!match) throw new CreationVideoError("UNREADABLE_VIDEO");
  const durationMs = Math.round((Number(match[1]) * 3_600 + Number(match[2]) * 60 + Number(match[3])) * 1_000);
  if (!Number.isSafeInteger(durationMs) || durationMs <= 0) throw new CreationVideoError("UNREADABLE_VIDEO");
  if (durationMs > CREATION_VIDEO_MAXIMUM_DURATION_MS) throw new CreationVideoError("VIDEO_TOO_LONG");
  return durationMs;
}

export function parseCreationVideoInspection(stderr: string) {
  const videoLines = stderr.split("\n").filter((line) => /Video:\s/.test(line));
  if (videoLines.length !== 1 || !/Video:\s*h264\b/i.test(videoLines[0]!)) throw new CreationVideoError("UNSUPPORTED_CODEC");
  const videoLine = videoLines[0]!;
  const dimensions = videoLine.match(/\b(\d{2,5})x(\d{2,5})(?:\s|,|\[)/);
  if (!dimensions) throw new CreationVideoError("UNREADABLE_VIDEO");
  let width = Number(dimensions[1]);
  let height = Number(dimensions[2]);
  if (
    !Number.isSafeInteger(width)
    || !Number.isSafeInteger(height)
    || width < 16
    || height < 16
    || width > CREATION_VIDEO_MAXIMUM_DIMENSION
    || height > CREATION_VIDEO_MAXIMUM_DIMENSION
    || width * height > CREATION_VIDEO_MAXIMUM_PIXELS
  ) {
    throw new CreationVideoError("UNREADABLE_VIDEO");
  }
  const audioCodecs = [...stderr.matchAll(/Audio:\s*([a-zA-Z0-9_]+)/g)].map((match) => match[1]?.toLowerCase());
  if (audioCodecs.some((codec) => codec !== "aac")) throw new CreationVideoError("UNSUPPORTED_CODEC");
  const rotation = stderr.match(/rotation of\s+(-?\d+(?:\.\d+)?)\s+degrees/i);
  if (rotation && Math.abs(Number(rotation[1])) % 180 === 90) [width, height] = [height, width];
  return { width, height, durationMs: parsedDuration(stderr), hasAudio: audioCodecs.length > 0 };
}

function assertMp4Container(stderr: string) {
  if (!/Input #0,\s*mov,mp4(?:,|\s)/i.test(stderr)) {
    throw new CreationVideoError("UNSUPPORTED_CODEC");
  }
}

export async function validateCreationVideo(sourcePath: string, options: { signal?: AbortSignal } = {}) {
  const inspection = await runFfmpeg(["-i", sourcePath], 30_000, true, options.signal);
  assertMp4Container(inspection);
  const metadata = parseCreationVideoInspection(inspection);
  const validationTimeoutMs = Math.min(
    CREATION_VIDEO_MAXIMUM_VALIDATION_TIMEOUT_MS,
    Math.max(CREATION_VIDEO_MINIMUM_VALIDATION_TIMEOUT_MS, metadata.durationMs * 3),
  );
  await runFfmpeg([
    "-v", "error",
    "-xerror",
    "-threads", "2",
    "-i", sourcePath,
    "-map", "0:v:0",
    "-map", "0:a?",
    "-sn",
    "-dn",
    "-f", "null",
    "-",
  ], validationTimeoutMs, false, options.signal);
  return metadata;
}
