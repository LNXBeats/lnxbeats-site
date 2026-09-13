import assert from "node:assert/strict";
import test from "node:test";

import {
  MEDIA_PLAYBACK_CLAIM_EVENT,
  announceMediaPlayback,
  listenForOtherMediaPlayback,
  type MediaPlaybackClaim,
} from "@/lib/media/playback-coordinator";

test("audio and video playback claims synchronously pause only other owners", () => {
  const target = new EventTarget();
  const audioClaims: MediaPlaybackClaim[] = [];
  const videoClaims: MediaPlaybackClaim[] = [];
  const stopAudio = listenForOtherMediaPlayback("audio-a", (claim) => audioClaims.push(claim), target);
  const stopVideo = listenForOtherMediaPlayback("video-b", (claim) => videoClaims.push(claim), target);

  assert.equal(announceMediaPlayback({ ownerId: "audio-a", kind: "audio" }, target), true);
  assert.deepEqual(audioClaims, []);
  assert.deepEqual(videoClaims, [{ ownerId: "audio-a", kind: "audio" }]);

  assert.equal(announceMediaPlayback({ ownerId: "video-b", kind: "video" }, target), true);
  assert.deepEqual(audioClaims, [{ ownerId: "video-b", kind: "video" }]);
  assert.equal(videoClaims.length, 1);

  stopAudio();
  stopVideo();
});

test("coordinated pause preserves media position and never resumes another owner", () => {
  const target = new EventTarget();
  const media = {
    paused: false,
    currentTime: 37.25,
    pauseCalls: 0,
    pause() {
      this.paused = true;
      this.pauseCalls += 1;
    },
  };
  const stop = listenForOtherMediaPlayback("discography-audio", () => media.pause(), target);

  announceMediaPlayback({ ownerId: "creation-video", kind: "video" }, target);

  assert.equal(media.paused, true);
  assert.equal(media.pauseCalls, 1);
  assert.equal(media.currentTime, 37.25);

  stop();
  announceMediaPlayback({ ownerId: "creation-audio", kind: "audio" }, target);
  assert.equal(media.pauseCalls, 1, "unsubscribe must not leave a playback listener behind");
});

test("malformed, empty and server-side claims fail closed", () => {
  const target = new EventTarget();
  let pauses = 0;
  const stop = listenForOtherMediaPlayback("known-player", () => { pauses += 1; }, target);

  target.dispatchEvent(new CustomEvent(MEDIA_PLAYBACK_CLAIM_EVENT, { detail: { ownerId: "", kind: "audio" } }));
  target.dispatchEvent(new CustomEvent(MEDIA_PLAYBACK_CLAIM_EVENT, { detail: { ownerId: "other", kind: "stream" } }));
  target.dispatchEvent(new Event(MEDIA_PLAYBACK_CLAIM_EVENT));
  assert.equal(pauses, 0);

  assert.equal(announceMediaPlayback({ ownerId: "other", kind: "audio" }, null), false);
  assert.doesNotThrow(listenForOtherMediaPlayback("known-player", () => undefined, null));
  stop();
});
