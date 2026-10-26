import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const component = () => readFile(new URL("../../components/home-jukebox.tsx", import.meta.url), "utf8");
const styles = () => readFile(new URL("../../app/immersive-public.css", import.meta.url), "utf8");

test("the selector has a rack, physical transfer, platter and tonearm without a gallery WebGL loop", async () => {
  const source = await component();
  for (const part of ["rack-base", "carrier", "claw", "record", "platter", "tonearm"]) assert.ok(source.includes(`mechanical-jukebox__${part}`));
  assert.doesNotMatch(source, /ImmersiveScene|createStudioScene|requestAnimationFrame\(render/);
  assert.match(source, /if \(Math\.abs\(distance\) > 1\) return null/);
  assert.match(source, /ProjectArtwork project=\{active\}/);
  assert.match(source, /sizes="\(max-width: 600px\) 58vw, \(max-width: 1200px\) 24vw, \(max-width: 1799px\) 420px, 512px"/);
});

test("ultrawide hardware stays physically bounded, with controls beside the console", async () => {
  const css = await styles();
  assert.match(css, /--discography-card-width: clamp\(370px,15\.2vw,512px\)/);
  assert.match(css, /--machine-control-offset: clamp\(420px,18vw,560px\)/);
  assert.match(css, /\.mechanical-jukebox__deck \{[^}]*width: min\(1300px,88%\)/);
  assert.match(css, /\.mechanical-jukebox__tonearm \{[^}]*left: calc\(50% - 120px\); width: clamp\(346px,11vw,430px\)/);
  assert.match(css, /\.mechanical-jukebox__carrier \{ width: 72px; height: 250px/);
  assert.match(css, /\.home-jukebox__arrow--previous \{ left: calc\(50% - var\(--machine-control-offset\)\)/);
});

test("the wood plinth and chrome arm keep a fixed pivot and connected diamond on the groove plane", async () => {
  const source = await component(), css = await styles();
  assert.match(css, /\.mechanical-jukebox__deck \{[^}]*border-bottom: 16px solid #67452b/);
  assert.match(css, /linear-gradient\(110deg,#a7784e,#cfaa79/);
  assert.match(source, /viewBox="0 0 400 400"/);
  assert.match(source, /cx="470" cy="105"/);
  assert.match(source, /cx="335" cy="290" r="2"[^>]*data-tonearm-stylus/);
  assert.match(css, /transform-origin: 117\.5% 26\.25%/);
  assert.match(css, /\.mechanical-jukebox__tonearm \{[^}]*left: 44%; top: 67%; width: 28%[^}]*rotateX\(53deg\)/);
  assert.match(css, /\.mechanical-jukebox__tonearm \{ left: 42%; top: 67%; width: 43%/);
  // The diamond is in the playable annulus, not the label or beyond the rim.
  const radius = Math.hypot(335 - 200, 290 - 200) / 200;
  assert.ok(radius > .34 && radius < .94);
  const angle = -38 * Math.PI / 180;
  const parkedX = 470 + (335 - 470) * Math.cos(angle) - (290 - 20 - 105) * Math.sin(angle);
  const parkedY = 105 + (335 - 470) * Math.sin(angle) + (290 - 20 - 105) * Math.cos(angle);
  assert.ok(Math.hypot(parkedX - 200, parkedY - 200) / 200 > 1);
  assert.doesNotMatch(css, /\[data-playing="true"\] \.mechanical-jukebox__tonearm \{/);
});

test("the stylus waits for the actual record transfer and only lowers during current real playback", async () => {
  const source = await component(), css = await styles();
  assert.match(source, /data-tonearm-engaged=\{playingSlug === active\.slug && \(seatedRecordSlug === active\.slug \|\| motionSuppressed\)\}/);
  assert.match(source, /setSeatedRecordSlug\(motionSuppressed \? nextProject\.slug : null\);\s+setMachineEngaged\(true\)/);
  assert.match(source, /event\.target !== event\.currentTarget \|\| !event\.animationName\.startsWith\("studio-record-transfer"\)/);
  assert.match(source, /slug === playerStateRef\.current\.selectedSlug\) setSeatedRecordSlug\(slug\)/);
  assert.match(source, /preference\.addEventListener\("change", syncPreference\)/);
  assert.match(source, /preference\.removeEventListener\("change", syncPreference\)/);
  assert.match(source, /preference\.matches \|\| document\.documentElement\.dataset\.visualMotion === "paused"/);
  assert.match(source, /attributeFilter: \["data-visual-motion"\]/);
  assert.match(source, /if \(suppressed\) setSeatedRecordSlug\(playerStateRef\.current\.selectedSlug\)/);
  assert.match(css, /tonearm-lift \{ transform: translateY\(-20px\); transition: transform \.22s ease/);
  assert.match(css, /\[data-tonearm-engaged="true"\] \.mechanical-jukebox__tonearm-lift \{ transform: translateY\(0\); transition: transform \.3s \.7s ease/);
  assert.doesNotMatch(source, /setTimeout\([^;]*setSeatedRecordSlug/);
});

test("mechanical card positioning outranks the legacy mobile active-card selector", async () => {
  const css = await styles();
  // The v130 mobile rule includes .discography-jukebox, .home-jukebox__item
  // and .is-active. The mechanical base needs three classes plus the same ID
  // so its later rule really wins position/left/width, not only transform.
  const rule = css.match(/body main#contenu \.mechanical-jukebox\.discography-jukebox \.home-jukebox__item \{([^}]+)\}/)?.[1] ?? "";
  assert.match(rule, /position: absolute/);
  assert.match(rule, /left: 50%/);
  assert.match(rule, /top: calc\(49% - var\(--discography-card-width\)\)/);
  assert.match(rule, /width: var\(--discography-card-width\)/);
  assert.match(css, /\.mechanical-jukebox\.discography-jukebox \.home-jukebox__item\.is-active \{ transform: translateX\(-50%\) scale\(\.9\) !important/);
});

test("record rotation follows real audio playback, not the decorative transfer", async () => {
  const source = await component(), css = await styles();
  assert.equal((source.match(/<audio\b/g) ?? []).length, 1);
  assert.match(source, /await audio\.play\(\);/);
  assert.match(source, /if \(requestId !== playRequestRef\.current \|\| loadedSlugRef\.current !== target\.slug\) return false/);
  assert.match(source, /if \(audio\.paused\)/);
  assert.match(source, /data-playing=\{playing\}/);
  assert.match(source, /const \[machineEngaged, setMachineEngaged\] = useState\(false\)/);
  assert.match(css, /\[data-machine-engaged="true"\]\[data-record-seated="false"\] \.mechanical-jukebox__record \{ animation:/);
  assert.match(css, /\.mechanical-jukebox\[data-playing="true"\] \.mechanical-jukebox__record-spin \{ animation-play-state: running/);
  assert.match(css, /\.mechanical-jukebox__record-spin \{[^}]+animation-play-state: paused/);
  assert.match(source, /playbackFailure === "blocked"/);
});

test("the finite mechanism freezes offscreen and follows reduced-motion and the global pause", async () => {
  const source = await component(), css = await styles();
  assert.match(source, /setMachineVisible\(intersects && !document\.hidden\)/);
  assert.match(source, /observer\?\.disconnect\(\)/);
  assert.match(source, /document\.removeEventListener\("visibilitychange", syncVisibility\)/);
  assert.match(css, /animation: studio-record-transfer 1\.75s [^;]+ both/);
  assert.match(css, /\.mechanical-jukebox__carrier \{[^}]+transform: translate\(-50%,-135%\)/);
  assert.match(css, /100% \{ transform: translate\(-50%,-135%\); \} \}/);
  assert.match(css, /\[data-machine-visible="false"\][^}]+animation-play-state: paused !important/);
  assert.match(css, /html\[data-visual-motion="paused"\] \.mechanical-jukebox/);
  const reduced = css.slice(css.lastIndexOf("@media (prefers-reduced-motion: reduce)"));
  assert.match(reduced, /mechanical-jukebox__record-spin[^}]+animation: none !important/);
});

test("the real project link, labelled controls, keyboard and swipe stay available", async () => {
  const source = await component();
  assert.match(source, /href=\{`\/album\/\$\{playerProject\.slug\}`\}/);
  assert.match(source, /aria-label=\{t\("Projet précédent"\)\}/);
  assert.match(source, /aria-label=\{t\("Projet suivant"\)\}/);
  assert.match(source, /event\.key === "ArrowLeft"/);
  assert.match(source, /event\.key === "ArrowRight"/);
  assert.match(source, /Math\.abs\(dx\) >= 48/);
  assert.match(source, /if \(continueListening && nextProject\.audioPreview\) void attemptPlayback\(next\)/);
  assert.match(source, /continuousListeningRef\.current = false/);
});
