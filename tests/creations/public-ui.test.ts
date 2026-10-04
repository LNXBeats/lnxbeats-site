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
  assert.match(source, /CREATION_MEDIA_NETWORK_RECOVERY_LIMIT/);
  assert.match(source, /refreshedCreationMediaUrl/);
  assert.match(source, /element\.load\(\)/);
  const recoveryBody = source.match(/const recoverExpiredMedia = useCallback\(\(kind:[\s\S]*?\n  \}, \[/)?.[0] ?? "";
  assert.match(recoveryBody, /element\.load\(\)/);
  assert.doesNotMatch(recoveryBody, /\.play\(\)/);
  assert.match(source, /onClick=\{\(\) => void play\("video", selected\)\}/);
  assert.equal(source.match(/\bunoptimized\b/g)?.length, 2, "redirected private R2 artwork must bypass the Next image optimizer");
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
  assert.match(source, /aria-label=\{displayedAudioActive \?/);
  assert.match(source, /role="group" aria-label=\{`Médias de/);
  assert.match(source, /<span className="visually-hidden">Position dans l’audio/);
  assert.match(source, /aria-live="polite"/);
  assert.match(styles, /min-height: 48px/);
});

test("audio strip metadata, pause and seek target the playing creation independently from selection", async () => {
  const source = await read("components/creations/creation-media-stage.tsx");
  assert.match(source, /state\.activeMedia\?\.kind === "audio" && activeCreation\?\.audio \? activeCreation : selected/);
  assert.match(source, /<strong>\{displayedAudio\.title\}<\/strong>/);
  assert.match(source, /onClick=\{\(\) => void play\("audio", displayedAudio\)\}/);
  assert.match(source, /loadedRef\.current\.audio !== displayedAudio\.slug/);
  assert.match(source, /progress\.key === displayedAudioKey/);
  assert.match(source, /displayedAudio\.slug !== selected\.slug \? \(/);
  assert.match(source, /Lire la sélection : \{selected\.title\}/);
});

test("mobile media choices stay complete, tactile and contained without a horizontal carousel", async () => {
  const [source, styles] = await Promise.all([
    read("components/creations/creation-media-stage.tsx"),
    read("app/creations/creations.css"),
  ]);
  const mobile = styles.match(/@media \(max-width: 540px\) \{([\s\S]*?)\n\}/)?.[1] ?? "";

  assert.match(source, /return "Visuel"/);
  assert.match(source, /return "Audio"/);
  assert.match(source, /return "Vidéo"/);
  assert.match(source, /creation\.cover\.id !== creation\.poster\?\.id/);
  assert.match(source, /!presentationMedia\(creation\)\.includes\("cover"\) \? "video" : primary/);
  assert.match(source, /onClick=\{\(\) => selectMedia\(kind, selected\)\}/);
  const selection = source.match(/const selectMedia = useCallback\([\s\S]*?\n  \}, \[/)?.[0] ?? "";
  assert.doesNotMatch(selection, /\bplay\(/);
  assert.match(styles, /\.creation-stage__media-tabs \{[\s\S]*?grid-auto-flow: column;[\s\S]*?overflow: visible;/);
  assert.match(mobile, /\.creation-stage__media-tabs button \{[^}]*width: 100%;[^}]*min-width: 0;[^}]*min-height: 44px;[^}]*white-space: normal;/);
});

test("catalogue cards reflow exceptional labels and titles without truncation", async () => {
  const [source, styles] = await Promise.all([
    read("components/creations/creation-media-stage.tsx"),
    read("app/creations/creations.css"),
  ]);

  assert.match(source, /<small>\{creation\.category \|\| "Création"\}/);
  assert.match(source, /<strong>\{creation\.title\}<\/strong>/);
  assert.doesNotMatch(source, /creation\.title\.(?:slice|substring)\(/);
  for (const selector of ["small", "strong"]) {
    const rule = styles.match(new RegExp(`\\.creation-card__body ${selector} \\{([^}]+)\\}`))?.[1] ?? "";
    assert.match(rule, /overflow-wrap: anywhere/);
    assert.doesNotMatch(rule, /max-height:|line-clamp:|overflow: hidden/);
  }
});

test("public catalogue filters are data-driven, accessible and keep mixed media in both media filters", async () => {
  const [source, styles] = await Promise.all([
    read("components/creations/creation-media-stage.tsx"),
    read("app/creations/creations.css"),
  ]);

  assert.match(source, /label: "Tous"/);
  assert.match(source, /label: "Musique"/);
  assert.match(source, /label: "Vidéos"/);
  assert.match(source, /label: "Collaborations"/);
  assert.match(source, /if \(filter === "music"\) return Boolean\(creation\.audio\)/);
  assert.match(source, /if \(filter === "video"\) return Boolean\(creation\.video\)/);
  assert.match(source, /filterCounts = useMemo/);
  assert.match(source, /role="group" aria-label="Filtrer les créations"/);
  assert.match(source, /aria-pressed=\{creationFilter === filter\.id\}/);
  assert.match(styles, /\.creation-filters button \{[\s\S]*?min-height: 48px;/);
  assert.match(styles, /@media \(max-width: 540px\)[\s\S]*?\.creation-filters \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\); \}/);
});

test("detail pages rely on the stage controls without duplicating catalogue action buttons", async () => {
  const source = await read("components/creations/creation-media-stage.tsx");

  assert.match(source, /\{showGrid \? \(\s*<div className="creation-stage__actions">/);
  assert.match(source, /<Link href=\{`\/creations\/\$\{selected\.slug\}`\}>Découvrir la création/);
  const actions = source.match(/<div className="creation-stage__actions">([\s\S]*?)<\/div>/)?.[1] ?? "";
  assert.doesNotMatch(actions, /<button|\bplay\(/);
  assert.doesNotMatch(source, /▶|Ⅱ|♪|→/);
  assert.match(source, /className="creation-stage__launch"[\s\S]*?<UiIcon name="play" \/>/);
});

test("the stage keeps 16:9, 9:16 and 1:1 media contained at all responsive tiers", async () => {
  const [source, styles] = await Promise.all([
    read("components/creations/creation-media-stage.tsx"),
    read("app/creations/creations.css"),
  ]);

  assert.match(source, /creationVideoOrientation\(selected\.video\)/);
  assert.match(source, /data-video-orientation=\{videoOrientation\}/);
  assert.match(source, /frameAsset\.width \/ frameAsset\.height/);
  assert.match(source, /style=\{\{ aspectRatio: frameRatio/);
  assert.match(source, /asset=\{state\.selectedMedia === "video" \? selected\.poster \?\? selected\.cover : artwork\}/);
  assert.doesNotMatch(styles, /data-video-visible="true"\]\[data-video-orientation/);
  assert.match(styles, /\.creation-stage__launch \{[^}]*width: 52px;[^}]*height: 52px;/s);
  assert.match(styles, /\.creation-stage__video\.is-visible[\s\S]*?object-fit: contain/);
  assert.match(styles, /\.creation-artwork img \{ object-fit: contain; \}/);
  assert.doesNotMatch(styles, /object-fit: cover/);
  assert.doesNotMatch(source, /creation-stage__audio-overlay|creation-stage__ambient/);
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
