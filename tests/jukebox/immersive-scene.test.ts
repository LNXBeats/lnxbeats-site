import assert from "node:assert/strict";
import test from "node:test";
import { createStudioScene, studioCoverSource } from "../../lib/visual/studio-scene.js";

// Deterministic scheduler/resource tests. These mocks do not claim authentic
// browser rendering, GPU timing, Safari support, or Production availability.
function harness() {
  let nextFrame = 0;
  let clock = 1000;
  let width = 700;
  let contextReleases = 0;
  let liveTextures = 0;
  let maximumTextures = 0;
  let scaledImages = 0;
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
      if (key === "getUniformLocation") return () => ({});
      if (key === "getExtension") return () => ({ loseContext() { contextReleases++; } });
      if (key === "createTexture") return () => { liveTextures++; maximumTextures = Math.max(maximumTextures, liveTextures); return {}; };
      if (key === "deleteTexture") return () => { liveTextures--; };
      if (String(key).startsWith("create")) return () => ({});
      if (String(key).toUpperCase() === key) return 1;
      return () => {};
    },
  });
  const canvas = {
    dataset: {} as Record<string, string>, width: 1, height: 1,
    getContext() { return gl; }, getBoundingClientRect() { return { width, height: 650 }; },
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
    offscreen() { intersections[0]?.([{ isIntersecting: false }]); },
    resources() { return { liveTextures, maximumTextures, contextReleases, scaledImages, queuedFrames: frames.size }; },
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
