import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { StudioVinylControl, type StudioVinylControlState } from "../../components/studio-vinyl-control";

const source = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("public audio controls share an accessible currentColor studio-vinyl SVG", async () => {
  const [control, standalone, jukebox] = await Promise.all([
    source("components/studio-vinyl-control.tsx"),
    source("components/audio-preview-player.tsx"),
    source("components/home-jukebox.tsx"),
  ]);

  assert.match(control, /export type StudioVinylControlState = "play" \| "pause" \| "replay" \| "loading"/);
  assert.match(control, /<svg[\s\S]*?viewBox="0 0 48 48"[\s\S]*?aria-hidden="true"[\s\S]*?focusable="false"/);
  assert.match(control, /currentColor/);
  assert.match(control, /studio-vinyl-control__disc/);
  assert.match(control, /studio-vinyl-control__state/);
  assert.match(standalone, /<StudioVinylControl state=/);
  assert.match(jukebox, /<StudioVinylControl state=\{playbackState\}/);
  assert.doesNotMatch(standalone, /▶|▸|Ⅱ/);
  assert.doesNotMatch(jukebox, /▶|▸|Ⅱ/);
});

test("ended playback changes only the public control presentation to replay", async () => {
  const [standalone, jukebox] = await Promise.all([
    source("components/audio-preview-player.tsx"),
    source("components/home-jukebox.tsx"),
  ]);

  for (const component of [standalone, jukebox]) {
    assert.match(component, /const \[ended, setEnded\] = useState\(false\);/);
    assert.match(component, /ended \? "replay" : "play"/);
    assert.match(component, /Relire l’extrait de/);
  }

  assert.match(standalone, /onEnded=\{\(event\) => \{[\s\S]*?setEnded\(true\);/);
  assert.match(standalone, /onPlay=\{\(\) => \{[\s\S]*?setEnded\(false\);/);
  assert.match(jukebox, /onEnded=\{\(\) => \{ setPlaying\(false\); setProgress\(0\); setEnded\(true\); \}\}/);
  assert.match(jukebox, /onPlay=\{\(\) => \{ setPlaying\(true\); setEnded\(false\); \}\}/);
  assert.equal((jukebox.match(/<audio\b/g)?.length ?? 0), 1);
  assert.doesNotMatch(jukebox, /\bautoPlay\b/);
});

test("studio-vinyl renders distinct accessible SVG states", () => {
  const states: StudioVinylControlState[] = ["play", "pause", "replay", "loading"];
  const rendered = states.map((state) => {
    const element = StudioVinylControl({ state });
    const stateGraphic = element.props.children[1];

    assert.equal(element.type, "svg");
    assert.equal(element.props["aria-hidden"], "true");
    assert.equal(element.props.focusable, "false");
    assert.equal(element.props["data-studio-vinyl-state"], state);
    assert.match(element.props.className, new RegExp(`studio-vinyl-control--${state}`));
    return JSON.stringify(stateGraphic.props.children);
  });

  assert.equal(new Set(rendered).size, states.length);
});

test("studio-vinyl CSS remains compact, responsive and motion-safe", async () => {
  const css = await source("app/v0854-audio-payment.css");

  assert.match(css, /\.audio-preview-player__toggle \{[\s\S]*?width: 60px;[\s\S]*?height: 60px;/);
  assert.match(css, /@media \(max-width: 600px\) \{[\s\S]*?\.audio-preview-player__toggle \{ width: 46px; height: 46px; \}/);
  assert.match(css, /@media \(max-width: 340px\) \{[\s\S]*?\.audio-preview-player__toggle \{ width: 44px; height: 44px; \}/);
  assert.match(css, /\.home-jukebox__play \.studio-vinyl-control \{[\s\S]*?width: 40px;[\s\S]*?height: 40px;/);
  assert.match(css, /@media \(max-width: 700px\) \{[\s\S]*?\.home-jukebox__play \.studio-vinyl-control \{ width: 46px; height: 46px; \}/);
  assert.match(css, /\.studio-vinyl-control--pause \.studio-vinyl-control__disc \{[\s\S]*?animation: studio-vinyl-spin 9s linear infinite;/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{[\s\S]*?animation: none !important;/);
  assert.match(css, /input\[type="range"\][\s\S]*?::-webkit-slider-runnable-track/);
});
