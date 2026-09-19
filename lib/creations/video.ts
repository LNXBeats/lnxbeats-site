import "server-only";

import { spawn } from "node:child_process";
import { chmod } from "node:fs/promises";
import path from "node:path";

import { catalogFfmpegPath } from "@/lib/catalog/ffmpeg";

export const CREATION_VIDEO_MAXIMUM_DURATION_MS = 20 * 60 * 1_000;
export const CREATION_VIDEO_MAXIMUM_DIMENSION = 4_096;
export const CREATION_VIDEO_MAXIMUM_PIXELS = 4_096 * 4_096;
export const CREATION_VIDEO_OUTPUT_MAXIMUM_AXIS = 1_920;
export const CREATION_VIDEO_MAXIMUM_FRAMERATE = 120;
export const CREATION_VIDEO_MAXIMUM_AUDIO_TRACKS = 1;
const CREATION_VIDEO_MINIMUM_VALIDATION_TIMEOUT_MS = 5 * 60 * 1_000;
const CREATION_VIDEO_MAXIMUM_VALIDATION_TIMEOUT_MS = 60 * 60 * 1_000;

export class CreationVideoError extends Error {
  constructor(readonly code: "UNREADABLE_VIDEO" | "UNSUPPORTED_CODEC" | "UNSUPPORTED_CONTAINER" | "TOO_MANY_STREAMS" | "VIDEO_TOO_LONG" | "TIMEOUT" | "ABORTED") {
    super(code);
    this.name = "CreationVideoError";
  }
}

export type CreationVideoSourceInspection = Readonly<{
  container: "MOV_MP4" | "WEBM";
  videoCodec: "h264" | "hevc" | "vp8" | "vp9";
  audioCodec: "aac" | "mp3" | "opus" | "vorbis" | null;
  width: number;
  height: number;
  durationMs: number;
  framerate: number;
  hasAudio: boolean;
  requiresTranscode: boolean;
}>;

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

function parseDimensions(line: string) {
  const dimensions = line.match(/\b(\d{2,5})x(\d{2,5})(?:\s|,|\[)/);
  if (!dimensions) throw new CreationVideoError("UNREADABLE_VIDEO");
  let width = Number(dimensions[1]);
  let height = Number(dimensions[2]);
  const rotation = line.match(/rotation of\s+(-?\d+(?:\.\d+)?)\s+degrees/i);
  if (rotation && Math.abs(Number(rotation[1])) % 180 === 90) [width, height] = [height, width];
  if (
    !Number.isSafeInteger(width) || !Number.isSafeInteger(height)
    || width < 16 || height < 16
    || width > CREATION_VIDEO_MAXIMUM_DIMENSION || height > CREATION_VIDEO_MAXIMUM_DIMENSION
    || width * height > CREATION_VIDEO_MAXIMUM_PIXELS
  ) throw new CreationVideoError("UNREADABLE_VIDEO");
  return { width, height };
}

function sourceContainer(stderr: string) {
  if (/Input #0,\s*mov,mp4(?:,|\s)/i.test(stderr)) return "MOV_MP4" as const;
  if (/Input #0,\s*(?:matroska,webm|webm)(?:,|\s)/i.test(stderr)) return "WEBM" as const;
  throw new CreationVideoError("UNSUPPORTED_CONTAINER");
}

export function parseCreationVideoSourceInspection(stderr: string): CreationVideoSourceInspection {
  const container = sourceContainer(stderr);
  const streamLines = stderr.split("\n").filter((line) => /Stream #\d+:\d+/.test(line));
  if (streamLines.some((line) => /Subtitle:|Data:|Attachment:/i.test(line))) throw new CreationVideoError("TOO_MANY_STREAMS");
  const videoLines = streamLines.filter((line) => /Video:\s/i.test(line));
  const audioLines = streamLines.filter((line) => /Audio:\s/i.test(line));
  if (videoLines.length !== 1 || audioLines.length > CREATION_VIDEO_MAXIMUM_AUDIO_TRACKS) {
    throw new CreationVideoError("TOO_MANY_STREAMS");
  }
  const videoCodec = videoLines[0]!.match(/Video:\s*([a-zA-Z0-9_]+)/i)?.[1]?.toLowerCase();
  if (!videoCodec || !["h264", "hevc", "vp8", "vp9"].includes(videoCodec)) throw new CreationVideoError("UNSUPPORTED_CODEC");
  const audioCodec = audioLines[0]?.match(/Audio:\s*([a-zA-Z0-9_]+)/i)?.[1]?.toLowerCase() ?? null;
  if (audioCodec && !["aac", "mp3", "opus", "vorbis"].includes(audioCodec)) throw new CreationVideoError("UNSUPPORTED_CODEC");
  const { width, height } = parseDimensions(`${videoLines[0]!}\n${stderr}`);
  const framerateMatch = videoLines[0]!.match(/(?:,|\s)(\d+(?:\.\d+)?)\s*fps(?:,|\s|$)/i);
  const framerate = Number(framerateMatch?.[1]);
  if (!Number.isFinite(framerate) || framerate <= 0 || framerate > CREATION_VIDEO_MAXIMUM_FRAMERATE) {
    throw new CreationVideoError("UNREADABLE_VIDEO");
  }
  const durationMs = parsedDuration(stderr);
  return {
    container,
    videoCodec: videoCodec as CreationVideoSourceInspection["videoCodec"],
    audioCodec: audioCodec as CreationVideoSourceInspection["audioCodec"],
    width,
    height,
    durationMs,
    framerate,
    hasAudio: audioLines.length === 1,
    requiresTranscode: videoCodec !== "h264" || (audioCodec !== null && audioCodec !== "aac"),
  };
}

export async function inspectCreationVideoSource(sourcePath: string, options: { signal?: AbortSignal } = {}) {
  const inspection = await runFfmpeg(["-i", sourcePath], 60_000, true, options.signal);
  const metadata = parseCreationVideoSourceInspection(inspection);
  const extension = path.extname(sourcePath).toLowerCase();
  if ((extension === ".webm") !== (metadata.container === "WEBM")) {
    throw new CreationVideoError("UNSUPPORTED_CONTAINER");
  }
  return metadata;
}

export async function normalizeCreationVideo(
  sourcePath: string,
  targetPath: string,
  inspection: CreationVideoSourceInspection,
  options: { signal?: AbortSignal } = {},
) {
  const timeoutMs = Math.min(2 * 60 * 60 * 1_000, Math.max(10 * 60 * 1_000, inspection.durationMs * 8));
  const common = ["-v", "error", "-xerror", "-threads", "2", "-i", sourcePath, "-map", "0:v:0", "-map", "0:a:0?", "-sn", "-dn"];
  const encoding = inspection.requiresTranscode
    ? [
        "-vf", `scale=w='min(${CREATION_VIDEO_OUTPUT_MAXIMUM_AXIS},iw)':h='min(${CREATION_VIDEO_OUTPUT_MAXIMUM_AXIS},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,setsar=1`,
        "-c:v", "libx264", "-threads:v", "2", "-preset", "fast", "-crf", "22", "-profile:v", "high", "-pix_fmt", "yuv420p",
        ...(inspection.hasAudio ? ["-c:a", "aac", "-b:a", "192k"] : ["-an"]),
      ]
    : ["-c:v", "copy", ...(inspection.hasAudio ? ["-c:a", "copy"] : ["-an"])];
  await runFfmpeg([...common, ...encoding, "-movflags", "+faststart", "-f", "mp4", "-y", targetPath], timeoutMs, false, options.signal);
  await chmod(targetPath, 0o600);
  return { transcoded: inspection.requiresTranscode };
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
