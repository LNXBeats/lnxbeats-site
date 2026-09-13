import assert from "node:assert/strict";
import test from "node:test";

import { CreationVideoError, parseCreationVideoInspection } from "../../lib/creations/video";

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

test("the 20-minute limit is inclusive and longer media is refused", () => {
  assert.equal(parseCreationVideoInspection(inspection({ duration: "00:20:00.000" })).durationMs, 1_200_000);
  assert.throws(
    () => parseCreationVideoInspection(inspection({ duration: "00:20:00.001" })),
    (error: unknown) => error instanceof CreationVideoError && error.code === "VIDEO_TOO_LONG",
  );
});
