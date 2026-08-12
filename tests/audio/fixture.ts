import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import ffmpegStatic from "ffmpeg-static";

const execFileAsync = promisify(execFile);

export async function createAudioFixture({
  seconds,
  format,
  outputPath,
}: {
  seconds: number;
  format: "mp3" | "wav";
  outputPath?: string;
}) {
  if (!ffmpegStatic) throw new Error("FFmpeg fixture generator is unavailable.");
  const temporaryDirectory = outputPath ? null : await mkdtemp(path.join(os.tmpdir(), "lnx-audio-fixture-"));
  const target = outputPath ?? path.join(temporaryDirectory!, `source.${format}`);
  const codecArgs = format === "mp3"
    ? ["-c:a", "libmp3lame", "-b:a", "256k", "-metadata", "title=QA PRIVATE SOURCE"]
    : ["-c:a", "pcm_s24le"];
  await execFileAsync(ffmpegStatic, [
    "-nostdin", "-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
    "-t", String(seconds), ...codecArgs, "-y", target,
  ], { timeout: 120_000, maxBuffer: 64 * 1024 });
  if (outputPath) return { path: target, cleanup: async () => undefined };
  return {
    path: target,
    bytes: await readFile(target),
    cleanup: () => rm(temporaryDirectory!, { recursive: true, force: true }),
  };
}
