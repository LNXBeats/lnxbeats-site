import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdtemp, readFile, rename, rm, stat, truncate } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { catalogFfmpegPath } from "../../lib/catalog/ffmpeg";
import {
  CREATION_VIDEO_MAXIMUM_DIMENSION,
  CreationVideoError,
  inspectCreationVideoSource,
  normalizeCreationVideo,
  parseCreationVideoInspection,
  parseCreationVideoSourceInspection,
  validateCreationVideo,
} from "../../lib/creations/video";

const execFileAsync = promisify(execFile);

function inspection({
  duration = "00:02:03.456",
  video = "h264 (High)",
  dimensions = "1920x1080",
  audio = "aac (LC)",
  rotation = "",
} = {}) {
  return [
    `  Duration: ${duration}, start: 0.000000, bitrate: 3128 kb/s`,
    `  Stream #0:0: Video: ${video}, yuv420p, ${dimensions} [SAR 1:1 DAR 16:9], 25 fps`,
    ...(audio ? [`  Stream #0:1: Audio: ${audio}, 48000 Hz, stereo, fltp`] : []),
    ...(rotation ? [`      displaymatrix: rotation of ${rotation} degrees`] : []),
  ].join("\n");
}

test("video inspection accepts MP4 delivery codecs and exact dimensions/duration", () => {
  assert.deepEqual(parseCreationVideoInspection(inspection()), {
    width: 1920,
    height: 1080,
    durationMs: 123_456,
    hasAudio: true,
  });
  assert.deepEqual(parseCreationVideoInspection(inspection({ audio: "", dimensions: "1080x1920" })), {
    width: 1080,
    height: 1920,
    durationMs: 123_456,
    hasAudio: false,
  });
});

test("rotation metadata swaps the display dimensions", () => {
  assert.deepEqual(parseCreationVideoInspection(inspection({ dimensions: "1920x1080", rotation: "-90" })), {
    width: 1080,
    height: 1920,
    durationMs: 123_456,
    hasAudio: true,
  });
});

test("non-H.264 video and non-AAC audio fail closed", () => {
  for (const source of [
    inspection({ video: "hevc (Main)" }),
    inspection({ audio: "mp3" }),
  ]) {
    assert.throws(
      () => parseCreationVideoInspection(source),
      (error: unknown) => error instanceof CreationVideoError && error.code === "UNSUPPORTED_CODEC",
    );
  }
});

test("additional video tracks are rejected while every AAC audio track remains in scope", () => {
  assert.throws(
    () => parseCreationVideoInspection(`${inspection()}\n  Stream #0:2: Video: h264 (High), yuv420p, 640x360 [SAR 1:1 DAR 16:9], 25 fps`),
    (error: unknown) => error instanceof CreationVideoError && error.code === "UNSUPPORTED_CODEC",
  );
  assert.equal(
    parseCreationVideoInspection(`${inspection()}\n  Stream #0:2: Audio: aac (LC), 48000 Hz, stereo, fltp`).hasAudio,
    true,
  );
});

test("the 20-minute limit is inclusive and longer media is refused", () => {
  assert.equal(parseCreationVideoInspection(inspection({ duration: "00:20:00.000" })).durationMs, 1_200_000);
  assert.throws(
    () => parseCreationVideoInspection(inspection({ duration: "00:20:00.001" })),
    (error: unknown) => error instanceof CreationVideoError && error.code === "VIDEO_TOO_LONG",
  );
});

test("dimensions are bounded for a predictable decode memory envelope", () => {
  assert.equal(parseCreationVideoInspection(inspection({ dimensions: "4096x2160" })).width, 4096);
  for (const dimensions of [`${CREATION_VIDEO_MAXIMUM_DIMENSION + 1}x1080`, "10000x1000"]) {
    assert.throws(
      () => parseCreationVideoInspection(inspection({ dimensions })),
      (error: unknown) => error instanceof CreationVideoError && error.code === "UNREADABLE_VIDEO",
    );
  }
});

test("complete validation rejects corruption after the former 30-second window", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lnx-creation-video-late-corruption-"));
  const validPath = path.join(root, "valid-42-seconds.mp4");
  const corruptPath = path.join(root, "corrupt-after-30-seconds.mp4");
  const ffmpeg = catalogFfmpegPath();
  try {
    await execFileAsync(ffmpeg, [
      "-nostdin", "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=10:duration=42",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=42",
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "34", "-pix_fmt", "yuv420p", "-g", "20",
      "-c:a", "aac", "-b:a", "32k", "-movflags", "+faststart", "-shortest", "-y", validPath,
    ]);
    const metadata = await validateCreationVideo(validPath);
    assert.equal(metadata.hasAudio, true);
    assert.ok(metadata.durationMs >= 41_900 && metadata.durationMs <= 42_100);

    const controller = new AbortController();
    const interrupted = validateCreationVideo(validPath, { signal: controller.signal });
    controller.abort();
    await assert.rejects(
      interrupted,
      (error: unknown) => error instanceof CreationVideoError && error.code === "ABORTED",
    );

    await copyFile(validPath, corruptPath);
    await truncate(corruptPath, Math.floor((await stat(corruptPath)).size * 0.9));
    await assert.doesNotReject(execFileAsync(ffmpeg, [
      "-nostdin", "-hide_banner", "-v", "error", "-xerror", "-i", corruptPath,
      "-map", "0:v:0", "-map", "0:a?", "-t", "30", "-sn", "-dn", "-f", "null", "-",
    ]));
    await assert.rejects(
      validateCreationVideo(corruptPath),
      (error: unknown) => error instanceof CreationVideoError && error.code === "UNREADABLE_VIDEO",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a Matroska file renamed to mp4 is rejected despite H.264 codec", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lnx-creation-video-container-"));
  const mkv = path.join(root, "source.mkv");
  const disguised = path.join(root, "source.mp4");
  try {
    await execFileAsync(catalogFfmpegPath(), [
      "-nostdin", "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "color=size=160x90:rate=10:duration=1",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-y", mkv,
    ]);
    await rename(mkv, disguised);
    await assert.rejects(
      validateCreationVideo(disguised),
      (error: unknown) => error instanceof CreationVideoError && error.code === "UNSUPPORTED_CODEC",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("full decoder accepts H.264 MP4 landscape, portrait and square without an audio track", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lnx-creation-video-aspects-"));
  try {
    for (const [name, dimensions] of [["landscape", "160x90"], ["portrait", "90x160"], ["square", "128x128"]] as const) {
      const target = path.join(root, `${name}.mp4`);
      await execFileAsync(catalogFfmpegPath(), [
        "-nostdin", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", `color=size=${dimensions}:rate=10:duration=1`,
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", "-y", target,
      ]);
      const metadata = await validateCreationVideo(target);
      assert.equal(metadata.hasAudio, false);
      assert.equal(`${metadata.width}x${metadata.height}`, dimensions);
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("full decoder rejects a real MP4 carrying a non-H.264 video codec", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lnx-creation-video-codec-"));
  const target = path.join(root, "mpeg4.mp4");
  try {
    await execFileAsync(catalogFfmpegPath(), [
      "-nostdin", "-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "color=size=160x90:rate=10:duration=1",
      "-c:v", "mpeg4", "-an", "-y", target,
    ]);
    await assert.rejects(validateCreationVideo(target), (error: unknown) => error instanceof CreationVideoError && error.code === "UNSUPPORTED_CODEC");
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("source inspection accepts the bounded V3.4 codec matrix and rejects extra tracks", () => {
  const base = `Input #0, mov,mp4,m4a,3gp,3g2,mj2, from 'source.mov':\n${inspection({ video: "hevc (Main)", audio: "mp3" })}`;
  assert.deepEqual(parseCreationVideoSourceInspection(base), {
    container: "MOV_MP4",
    videoCodec: "hevc",
    audioCodec: "mp3",
    width: 1920,
    height: 1080,
    durationMs: 123_456,
    framerate: 25,
    hasAudio: true,
    requiresTranscode: true,
  });
  const webm = `Input #0, matroska,webm, from 'source.webm':\n${inspection({ video: "vp9 (Profile 0)", audio: "opus" })}`;
  assert.equal(parseCreationVideoSourceInspection(webm).container, "WEBM");
  assert.throws(
    () => parseCreationVideoSourceInspection(`${base}\n  Stream #0:2: Audio: aac (LC), 48000 Hz, stereo, fltp`),
    (error: unknown) => error instanceof CreationVideoError && error.code === "TOO_MANY_STREAMS",
  );
});

test("MOV HEVC and WebM VP9 inputs normalize to fully validated H.264/AAC MP4", { timeout: 60_000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lnx-v34-normalization-"));
  const ffmpeg = catalogFfmpegPath();
  try {
    const fixtures = [
      { name: "source.mov", video: ["-c:v", "libx265", "-tag:v", "hvc1"], audio: ["-c:a", "mp3", "-b:a", "64k"] },
      { name: "source.webm", video: ["-c:v", "libvpx-vp9", "-deadline", "realtime"], audio: ["-c:a", "libopus", "-b:a", "64k"] },
    ] as const;
    for (const fixture of fixtures) {
      const source = path.join(root, fixture.name);
      const target = path.join(root, `${fixture.name}.normalized.mp4`);
      await execFileAsync(ffmpeg, [
        "-nostdin", "-hide_banner", "-loglevel", "error",
        "-f", "lavfi", "-i", "testsrc2=size=320x180:rate=12:duration=2",
        "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=2",
        ...fixture.video, "-pix_fmt", "yuv420p", ...fixture.audio, "-shortest", "-y", source,
      ]);
      const sourceMetadata = await inspectCreationVideoSource(source);
      assert.equal(sourceMetadata.requiresTranscode, true);
      const normalized = await normalizeCreationVideo(source, target, sourceMetadata);
      assert.equal(normalized.transcoded, true);
      const finalMetadata = await validateCreationVideo(target);
      assert.equal(finalMetadata.hasAudio, true);
      assert.equal(`${finalMetadata.width}x${finalMetadata.height}`, "320x180");
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("compatible H.264/AAC MP4 is remuxed with faststart without video re-encoding", { timeout: 30_000 }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "lnx-v34-remux-"));
  const source = path.join(root, "source.mp4");
  const target = path.join(root, "normalized.mp4");
  try {
    await execFileAsync(catalogFfmpegPath(), [
      "-nostdin", "-hide_banner", "-loglevel", "error",
      "-f", "lavfi", "-i", "color=size=160x90:rate=10:duration=1",
      "-f", "lavfi", "-i", "sine=frequency=440:duration=1",
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", "-y", source,
    ]);
    const sourceMetadata = await inspectCreationVideoSource(source);
    assert.equal(sourceMetadata.requiresTranscode, false);
    assert.deepEqual(await normalizeCreationVideo(source, target, sourceMetadata), { transcoded: false });
    await assert.doesNotReject(validateCreationVideo(target));
    const bytes = await readFile(target);
    assert.ok(bytes.indexOf(Buffer.from("moov")) < bytes.indexOf(Buffer.from("mdat")));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("transcoding stays bounded to two encoder threads for the Preview worker envelope", async () => {
  const source = await readFile(new URL("../../lib/creations/video.ts", import.meta.url), "utf8");
  assert.match(source, /"-c:v", "libx264", "-threads:v", "2"/);
});
