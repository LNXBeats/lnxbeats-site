import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { createStudioScene, studioCoverSource } from "../../lib/visual/studio-scene.js";

// Deterministic scheduler/resource tests. These mocks do not claim authentic
// browser rendering, GPU timing, Safari support, or Production availability.
function harness() {
  let nextFrame = 0;
  let clock = 1000;
  let width = 700;
  let height = 650;
  let contextReleases = 0;
  let liveTextures = 0;
  let maximumTextures = 0;
  let scaledImages = 0;
  let liveBuffers = 0;
  let maximumBuffers = 0;
  let models: number[][] = [];
  const uniforms = new Map<string, number>();
  const frames = new Map<number, FrameRequestCallback>();
  const intersections: Array<(entries: Array<{ isIntersecting: boolean }>) => void> = [];
  const sources: string[] = [];
  const original = new Map<string, PropertyDescriptor | undefined>();
  const replacements: Record<string, unknown> = {
    requestAnimationFrame: (callback: FrameRequestCallback) => { const id = ++nextFrame; frames.set(id, callback); return id; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    window: { devicePixelRatio: 2, addEventListener() {}, removeEventListener() {} },
    document: {
      hidden: false, addEventListener() {}, removeEventListener() {},
      createElement() { return { width: 0, height: 0, getContext: () => ({ drawImage() { scaledImages++; } }) }; },
    },
    Image: class {
      naturalWidth = 2048;
      naturalHeight = 2048;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(value: string) { sources.push(value); if (value.includes("missing")) this.onerror?.(); else this.onload?.(); }
    },
    IntersectionObserver: class {
      constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) { intersections.push(callback); }
      observe() { intersections.at(-1)?.([{ isIntersecting: true }]); }
      disconnect() {}
    },
  };
  for (const [key, value] of Object.entries(replacements)) {
    original.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
  }
  const gl = new Proxy({}, {
    get(_object, key) {
      if (key === "getShaderParameter" || key === "getProgramParameter") return () => true;
      if (key === "getAttribLocation") return () => 0;
      if (key === "getUniformLocation") return (_program: unknown, name: string) => name;
      if (key === "uniformMatrix4fv") return (name: string, _transpose: boolean, matrix: Float32Array) => { if (name === "uModel") models.push([...matrix]); };
      if (key === "uniform1f") return (name: string, value: number) => uniforms.set(name, value);
      if (key === "clear") return () => { models = []; };
      if (key === "getExtension") return () => ({ loseContext() { contextReleases++; } });
      if (key === "createTexture") return () => { liveTextures++; maximumTextures = Math.max(maximumTextures, liveTextures); return {}; };
      if (key === "deleteTexture") return () => { liveTextures--; };
      if (key === "createBuffer") return () => { liveBuffers++; maximumBuffers = Math.max(maximumBuffers, liveBuffers); return {}; };
      if (key === "deleteBuffer") return () => { liveBuffers--; };
      if (String(key).startsWith("create")) return () => ({});
      if (String(key).toUpperCase() === key) return 1;
      return () => {};
    },
  });
  const canvas = {
    dataset: {} as Record<string, string>, width: 1, height: 1,
    getContext() { return gl; }, getBoundingClientRect() { return { width, height }; },
    addEventListener() {}, removeEventListener() {},
  } as unknown as HTMLCanvasElement;
  return {
    canvas, sources,
    tick(count: number) {
      for (let i = 0; i < count; i++) {
        clock += 1000 / 120;
        const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach(callback => callback(clock));
      }
    },
    mobile() { width = 390; },
    desktop() { width = 1000; },
    viewport(nextWidth: number, nextHeight: number) { width = nextWidth; height = nextHeight; },
    modelHash() { return createHash("sha256").update(JSON.stringify(models)).digest("hex"); },
    uniform(name: string) { return uniforms.get(name); },
    offscreen() { intersections[0]?.([{ isIntersecting: false }]); },
    resources() { return { liveTextures, maximumTextures, liveBuffers, maximumBuffers, contextReleases, scaledImages, queuedFrames: frames.size }; },
    restore() {
      for (const [key, descriptor] of original) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

test("immersive textures accept only existing public-cover paths, never private or external URLs", () => {
  for (const value of ["https://example.com/a.jpg", "//example.com/a.jpg", "/api/admin/cover/1", "/media/digital/master/1", "/assets/../../api/private", "/assets/%2e%2e%2fapi/private", "/assets/a.jpg?token=secret", "/assets/a b.jpg", "/assets/a\\b.jpg", "javascript:alert(1)", null]) {
    assert.equal(studioCoverSource(value), "", String(value));
  }
  assert.equal(studioCoverSource("/media/catalog/a902-abc"), "/media/catalog/a902-abc");
  assert.equal(studioCoverSource("/assets/v3/pochette.webp"), "/assets/v3/pochette.webp");
});

test("the real scheduler caps drawing, pauses completely, and renders one explicit selection while paused", () => {
  const runtime = harness();
  const scene = createStudioScene(runtime.canvas, { covers: ["/media/catalog/cover-0", "/media/catalog/cover-1", "/media/catalog/cover-2"] });
  try {
    runtime.tick(240);
    assert.equal(scene.getStats().estimatedFps, 60);
    assert.equal(scene.getStats().fpsLimit, 60);
    assert.equal(scene.getStats().drawCalls, 22);
    assert.equal(scene.getStats().triangles, 5318);
    scene.setMotion(false);
    const stopped = scene.getStats().frames;
    runtime.tick(120); scene.setPointer(.5, .2); runtime.tick(10);
    assert.equal(scene.getStats().frames, stopped);
    scene.setIndex(1); runtime.tick(1);
    assert.equal(scene.getStats().frames, Number(stopped) + 1);
    runtime.mobile(); scene.setMotion(true); runtime.tick(360);
    assert.equal(scene.getStats().estimatedFps, 30);
    assert.equal(scene.getStats().fpsLimit, 30);
    assert.equal(scene.getStats().dpr, 1.25);
    runtime.offscreen(); const offscreen = scene.getStats().frames; runtime.tick(120);
    assert.equal(scene.getStats().frames, offscreen);
    assert.equal(JSON.parse(runtime.canvas.dataset.sceneStats ?? "{}").running, false);
  } finally { scene.dispose(); runtime.restore(); }
  assert.equal(runtime.resources().contextReleases, 1);
  assert.equal(runtime.resources().queuedFrames, 0);
});

test("26 catalogue indexes remain exact, missing covers are not substituted, and textures stay bounded", () => {
  const runtime = harness();
  const covers = Array.from({ length: 26 }, (_, index) => index === 7 ? "" : `/media/catalog/cover-${index}`);
  const scene = createStudioScene(runtime.canvas, { covers });
  try {
    runtime.tick(2); scene.setMotion(false);
    assert.equal(runtime.sources.length, 3, "only the active cover and its two neighbours load initially");
    for (let index = 0; index < covers.length; index++) {
      scene.setIndex(index); runtime.tick(1);
      assert.equal(scene.getStats().index, index);
      assert.ok(Number(scene.getStats().textureCache) <= 6);
    }
    scene.setIndex(7); runtime.tick(1);
    assert.equal(scene.getStats().textureStates?.[7], "empty");
    assert.equal(scene.getStats().index, 7);
    assert.equal(runtime.canvas.dataset.sceneReady, "false", "the real DOM fallback remains available for an absent cover");
    assert.ok(runtime.resources().maximumTextures <= 7, "six artwork textures plus one neutral texture");
    assert.ok(runtime.resources().scaledImages > 0, "oversized public images are scaled before GPU upload");
    assert.equal(scene.getStats().maxTextureEdge, 1024);
  } finally { scene.dispose(); runtime.restore(); }
  assert.equal(runtime.resources().liveTextures, 0);
});

test("a failed central public cover preserves DOM fallback rather than displaying another album", () => {
  const runtime = harness();
  const scene = createStudioScene(runtime.canvas, { covers: ["/media/catalog/missing", "/media/catalog/cover-1"], reducedMotion: true });
  try {
    runtime.tick(2);
    assert.equal(scene.getStats().textureStates?.[0], "error");
    assert.equal(scene.getStats().index, 0);
    assert.equal(runtime.canvas.dataset.sceneReady, "false");
    assert.equal(scene.getStats().running, false);
  } finally { scene.dispose(); runtime.restore(); }
});

test("unavailable WebGL keeps the DOM fallback without starting a loop or loading textures", () => {
  const runtime = harness();
  Object.defineProperty(runtime.canvas, "getContext", { value: () => null });
  let errors = 0;
  const scene = createStudioScene(runtime.canvas, { covers: ["/media/catalog/cover-0"], onError() { errors++; } });
  try {
    runtime.tick(120);
    assert.equal(scene.getStats().available, false);
    assert.equal(runtime.canvas.dataset.sceneReady, "false");
    assert.equal(runtime.resources().queuedFrames, 0);
    assert.equal(runtime.resources().liveTextures, 0);
    assert.equal(runtime.sources.length, 0);
    assert.equal(errors, 1);
  } finally { scene.dispose(); runtime.restore(); }
});

test("desktop gallery atmosphere enriches the existing scene while reducing draws and retaining GPU resource limits", () => {
  const runtime = harness();
  runtime.desktop();
  const scene = createStudioScene(runtime.canvas, { covers: ["/media/catalog/cover-0", "/media/catalog/cover-1", "/media/catalog/cover-2"], mode: "gallery" });
  try {
    runtime.tick(120);
    assert.equal(scene.getStats().desktopAtmosphere, true);
    assert.equal(scene.getStats().facets, 7);
    assert.equal(runtime.uniform("uDesktopAtmosphere"), 1);
    assert.ok(Number(runtime.uniform("uTime")) > 0);
    assert.equal(scene.getStats().drawCalls, 20);
    assert.equal(scene.getStats().triangles, 3014);
    assert.equal(runtime.resources().maximumBuffers, 9);
    assert.ok(runtime.resources().maximumTextures <= 7);
    const firstModelHash = runtime.modelHash();
    runtime.tick(120);
    assert.notEqual(runtime.modelHash(), firstModelHash, "the gallery cover transforms are genuinely animated");
    scene.setMotion(false);
    const stoppedFrames = scene.getStats().frames;
    const stoppedTime = runtime.uniform("uTime");
    const stoppedModels = runtime.modelHash();
    runtime.tick(120); scene.setPointer(.8, .5); runtime.tick(120);
    assert.equal(scene.getStats().frames, stoppedFrames);
    assert.equal(runtime.uniform("uTime"), stoppedTime);
    assert.equal(runtime.modelHash(), stoppedModels);
  } finally { scene.dispose(); runtime.restore(); }
  assert.equal(runtime.resources().liveBuffers, 0);
  assert.equal(runtime.resources().liveTextures, 0);
  assert.equal(runtime.resources().queuedFrames, 0);
});

test("hero rendering preserves the published compact transform fingerprint and never enables gallery lighting", () => {
  const runtime = harness();
  runtime.mobile();
  const scene = createStudioScene(runtime.canvas, { covers: ["/media/catalog/cover-0", "/media/catalog/cover-1", "/media/catalog/cover-2"] });
  try {
    runtime.tick(240);
    assert.equal(scene.getStats().desktopAtmosphere, false);
    assert.equal(runtime.uniform("uDesktopAtmosphere"), 0);
    assert.equal(scene.getStats().drawCalls, 22);
    assert.equal(scene.getStats().triangles, 5318);
    assert.equal(scene.getStats().fpsLimit, 30);
    assert.equal(scene.getStats().dpr, 1.25);
    // Captured from published 938c627's actual renderer with this deterministic
    // harness (390px, 240 RAF ticks), not from the new desktop implementation.
    assert.equal(runtime.modelHash(), "edfdec84224bfa7074b6856c07b952b6773220f0e56b8ec34e39d7c7a7b4d7bf");
    runtime.desktop(); runtime.tick(120);
    assert.equal(scene.getStats().desktopAtmosphere, false);
    assert.equal(runtime.uniform("uDesktopAtmosphere"), 0);
    runtime.mobile(); runtime.tick(120);
    assert.equal(scene.getStats().desktopAtmosphere, false);
    assert.equal(runtime.uniform("uDesktopAtmosphere"), 0);
  } finally { scene.dispose(); runtime.restore(); }
});

test("reduced motion never starts the richer gallery animation loop", () => {
  const runtime = harness();
  runtime.desktop();
  const scene = createStudioScene(runtime.canvas, { covers: ["/media/catalog/cover-0"], mode: "gallery", reducedMotion: true });
  try {
    runtime.tick(120);
    const frames = scene.getStats().frames;
    const models = runtime.modelHash();
    scene.setMotion(true); scene.setPointer(1, 1); runtime.tick(120);
    assert.equal(scene.getStats().running, false);
    assert.equal(scene.getStats().frames, frames);
    assert.equal(runtime.modelHash(), models);
    assert.equal(runtime.uniform("uTime"), 0);
    assert.equal(runtime.resources().queuedFrames, 0);
  } finally { scene.dispose(); runtime.restore(); }
});

test("gallery removes both orbital halos while retaining the plateau and its floor border", () => {
  const runtime = harness();
  runtime.viewport(1600,640);
  const scene = createStudioScene(runtime.canvas, { covers: ["/media/catalog/cover-0", "/media/catalog/cover-1", "/media/catalog/cover-2"], mode: "gallery" });
  try {
    runtime.tick(120);
    assert.equal(scene.getStats().framing?.orbitalHalos, 0);
    assert.equal(scene.getStats().drawCalls, 20);
    assert.equal(scene.getStats().triangles, 3014);
    assert.equal(runtime.resources().maximumBuffers, 9);
    scene.setMode("hero"); runtime.tick(2);
    assert.equal(scene.getStats().framing?.orbitalHalos, 0);
    assert.equal(scene.getStats().desktopAtmosphere, false);
    assert.equal(runtime.uniform("uDesktopAtmosphere"), 0);
    assert.equal(scene.getStats().drawCalls, 22);
    scene.setMode("gallery"); runtime.tick(2);
    assert.equal(scene.getStats().framing?.orbitalHalos, 0);
    assert.equal(scene.getStats().drawCalls, 20);
  } finally { scene.dispose(); runtime.restore(); }
});

test("wide gallery expands the real plateau to at least 85% and keeps complete covers inside the camera", () => {
  const runtime = harness();
  const scene = createStudioScene(runtime.canvas, { covers: ["/media/catalog/cover-0", "/media/catalog/cover-1", "/media/catalog/cover-2"], mode: "gallery" });
  try {
    let previousSpread = 0;
    let previousPlateauScale = 0;
    for (const [width,height] of [[1000,588],[1600,640],[1920,730],[2560,940],[3440,940],[5120,940]]) {
      runtime.viewport(width,height);
      for (const [x,y] of [[0,0],[-1,-1],[1,1],[-1,1],[1,-1]]) {
        scene.setPointer(x,y); runtime.tick(120);
        const framing = scene.getStats().framing;
        assert.ok(framing?.plateau);
        assert.ok(framing.coverGroup);
        assert.ok(framing.plateau.width >= .85, `${width}px plateau width ${framing.plateau.width}`);
        assert.ok(framing.plateau.width <= .95, `${width}px plateau fits within its horizontal margin`);
        assert.ok(framing.plateau.left >= 0 && framing.plateau.right <= 1, "the floor is not horizontally cropped");
        assert.ok(framing.plateau.top >= 0 && framing.plateau.bottom <= 1, `${width}px complete floor: ${JSON.stringify(framing.plateau)}`);
        assert.ok(framing.coverGroup.width >= .65 && framing.coverGroup.width <= .9, "three covers genuinely occupy the stage");
        assert.ok(framing.covers.every(bounds => bounds && bounds.left > 0 && bounds.right < 1 && bounds.top > 0 && bounds.bottom < 1), "every complete artwork stays inside the frustum, including pointer extremes");
        assert.equal(framing.orbitalHalos, 0);
        assert.equal(scene.getStats().drawCalls, 20);
      }
      assert.ok(Number(scene.getStats().framing?.sideX) > previousSpread);
      assert.ok(Number(scene.getStats().framing?.plateauWidthScale) > previousPlateauScale);
      previousSpread = Number(scene.getStats().framing?.sideX);
      previousPlateauScale = Number(scene.getStats().framing?.plateauWidthScale);
    }
    runtime.mobile(); runtime.tick(120);
    assert.equal(scene.getStats().framing?.plateauWidthScale, 1);
    assert.equal(scene.getStats().framing?.sideX, 2.45);
    assert.equal(scene.getStats().framing?.fovDegrees, 42);
    assert.equal(scene.getStats().fpsLimit, 30);
  } finally { scene.dispose(); runtime.restore(); }
});

test("published hero transforms stay unchanged at desktop widths and pointer extremes", () => {
  // Fingerprints obtained from published 938c627 with this deterministic harness,
  // not from the gallery release. These are transform checks, not GPU proof.
  const cases = [
    { pointer: [0, 0], hash: "27983fb4b20cf7515644827c1bc949fea7e717bb5f7540d968dad49e3cf639de" },
    { pointer: [-1, 1], hash: "33a3643a6c30d51cc2bac5a224789b7d3b6059bca37c687a49a54f37c764fec8" },
    { pointer: [1, -1], hash: "479334383c1b56ff605fe74ba599983406940f78d0e148ec9c585845c0352660" },
  ];
  for (const [width, height] of [[1000, 650], [1920, 730]]) {
    for (const { pointer, hash } of cases) {
      const runtime = harness();
      runtime.viewport(width, height);
      const scene = createStudioScene(runtime.canvas, { covers: ["/media/catalog/cover-0", "/media/catalog/cover-1", "/media/catalog/cover-2"], mode: "hero" });
      try {
        scene.setPointer(pointer[0], pointer[1]); runtime.tick(240);
        assert.equal(runtime.modelHash(), hash, "published hero transforms at " + width + "px and pointer " + pointer);
        assert.equal(runtime.uniform("uDesktopAtmosphere"), 0);
        assert.equal(scene.getStats().drawCalls, 22);
        assert.equal(scene.getStats().triangles, 5318);
      } finally { scene.dispose(); runtime.restore(); }
    }
  }
});
