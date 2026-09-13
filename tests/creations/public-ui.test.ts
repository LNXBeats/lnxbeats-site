import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("the public stage performs no eager or automatic media playback", async () => {
  const source = await read("components/creations/creation-media-stage.tsx");
  const videoOpeningTag = source.match(/<video([\s\S]*?)>/)?.[1] ?? "";
  const audioOpeningTag = source.match(/<audio([\s\S]*?)>/)?.[1] ?? "";

  assert.doesNotMatch(source, /\bautoPlay\b/i);
  assert.doesNotMatch(videoOpeningTag, /\bsrc\s*=/);
  assert.doesNotMatch(audioOpeningTag, /\bsrc\s*=/);
  assert.match(videoOpeningTag, /controls/);
  assert.match(videoOpeningTag, /playsInline/);
  assert.match(videoOpeningTag, /preload="none"/);
  assert.match(audioOpeningTag, /preload="none"/);
  assert.match(source, /loading=\{priority \? "eager" : "lazy"\}/);
  assert.match(source, /\{videoMounted \? \(/);
  assert.match(source, /flushSync\(\(\) => setVideoMounted\(true\)\)/);
  assert.match(source, /element\.src = source/);
  assert.match(source, /onClick=\{\(\) => void play\("video", selected\)\}/);
});

test("selection, active media, saved positions and the global playback claim remain separate", async () => {
  const source = await read("components/creations/creation-media-stage.tsx");

  assert.match(source, /selectedCreationSlug/);
  assert.match(source, /state\.activeMedia/);
  assert.match(source, /positionsRef = useRef\(new Map<string, number>\(\)\)/);
  assert.match(source, /rememberPosition/);
  assert.match(source, /restoreRememberedPosition/);
  assert.match(source, /previouslyLoadedSlug/);
  assert.match(source, /transition\(\{ type: "pause", slug: previouslyLoadedSlug, kind \}\)/);
  assert.match(source, /listenForOtherMediaPlayback/);
  assert.match(source, /announceMediaPlayback/);
  assert.match(source, /reste en lecture/);
});

test("centering the selected rail item never scrolls the page vertically", async () => {
  const source = await read("components/creations/creation-media-stage.tsx");

  assert.match(source, /rail\.scrollTo\(\{/);
  assert.match(source, /left: Math\.max\(0, left\)/);
  assert.doesNotMatch(source, /scrollIntoView/);
  assert.doesNotMatch(source, /rail\.scrollTo\(\{[^}]*\btop:/s);
});

test("hidden native video controls are not keyboard traps and public controls are labelled", async () => {
  const [source, styles] = await Promise.all([
    read("components/creations/creation-media-stage.tsx"),
    read("app/creations/creations.css"),
  ]);

  assert.match(source, /tabIndex=\{videoVisible \? 0 : -1\}/);
  assert.match(source, /aria-hidden=\{!videoVisible\}/);
  assert.match(source, /aria-label=\{`Vidéo de/);
  assert.match(source, /aria-label=\{selectedAudioActive \?/);
  assert.match(source, /role="group" aria-label=\{`Médias de/);
  assert.match(source, /<span className="visually-hidden">Position dans l’audio/);
  assert.match(source, /aria-live="polite"/);
  assert.match(styles, /min-height: 48px/);
});

test("the stage keeps 16:9, 9:16 and 1:1 media contained at all responsive tiers", async () => {
  const [source, styles] = await Promise.all([
    read("components/creations/creation-media-stage.tsx"),
    read("app/creations/creations.css"),
  ]);

  assert.match(source, /creationVideoOrientation\(selected\.video\)/);
  assert.match(source, /data-video-orientation=\{videoOrientation\}/);
  assert.match(styles, /data-video-orientation="landscape"[^}]*\{[^}]*aspect-ratio: 16 \/ 9/s);
  assert.match(styles, /data-video-orientation="portrait"[^}]*\{[^}]*aspect-ratio: 9 \/ 16/s);
  assert.match(styles, /data-video-orientation="square"[^}]*\{[^}]*aspect-ratio: 1;/s);
  assert.match(styles, /\.creation-stage__video\.is-visible[\s\S]*?object-fit: contain/);
  assert.match(styles, /\.creation-artwork img \{ object-fit: contain; \}/);
  assert.doesNotMatch(styles, /aspect-ratio:\s*min\(/);
  assert.match(styles, /@media \(max-width: 1120px\)/);
  assert.match(styles, /@media \(max-width: 820px\)/);
  assert.match(styles, /@media \(max-width: 540px\)/);
  assert.match(styles, /@media \(max-height: 760px\) and \(min-width: 821px\)/);
  assert.match(styles, /@media \(min-width: 1900px\)/);
});

test("reduced motion removes transforms, snapping and transitions", async () => {
  const styles = await read("app/creations/creations.css");
  const reducedMotion = styles.match(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*)\}\s*$/)?.[1] ?? "";

  assert.match(reducedMotion, /scroll-behavior: auto/);
  assert.match(reducedMotion, /scroll-snap-type: none/);
  assert.match(reducedMotion, /transition: none/);
  assert.match(reducedMotion, /transform: none/);
});
