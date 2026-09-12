import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("V3.2 pointer motion uses one inertial RAF fed by the latest pointer", async () => {
  const motion = await source("components/site-motion.tsx");

  assert.match(motion, /const TILT_SELECTOR = "\[data-motion-tilt\]"/);
  assert.match(motion, /const FINE_POINTER_QUERY = "\(hover: hover\) and \(pointer: fine\)"/);
  assert.match(motion, /const MOTION_PREFERENCE_QUERY = "\(prefers-reduced-motion: no-preference\)"/);
  assert.match(motion, /target\.lastPointerX = event\.clientX/);
  assert.match(motion, /target\.lastPointerY = event\.clientY/);
  assert.match(motion, /currentX \+ \(\(target\.targetX - target\.currentX\) \* MOTION_EASING\)/);
  assert.match(motion, /currentY \+ \(\(target\.targetY - target\.currentY\) \* MOTION_EASING\)/);
  assert.equal(motion.match(/window\.requestAnimationFrame\(/g)?.length, 1);
  assert.doesNotMatch(motion, /setState|useState/);
});

test("V3.2 motion exposes scene and light variables and cleans every listener", async () => {
  const motion = await source("components/site-motion.tsx");

  for (const property of ["--motion-x", "--motion-y", "--motion-light-x", "--motion-light-y"]) {
    assert.match(motion, new RegExp(`setProperty\\("${property}"`));
    assert.match(motion, new RegExp(`removeProperty\\("${property}"`));
  }
  assert.match(motion, /finePointer\.addEventListener\("change", syncMotionMode\)/);
  assert.match(motion, /finePointer\.removeEventListener\("change", syncMotionMode\)/);
  assert.match(motion, /motionPreference\.addEventListener\("change", syncMotionMode\)/);
  assert.match(motion, /motionPreference\.removeEventListener\("change", syncMotionMode\)/);
  assert.match(motion, /removeEventListener\("pointermove", target\.handlePointerMove\)/);
  assert.match(motion, /removeEventListener\("pointerleave", target\.handlePointerLeave\)/);
  assert.match(motion, /removeEventListener\("pointercancel", target\.handlePointerLeave\)/);
  assert.match(motion, /window\.cancelAnimationFrame\(frame\)/);
});

test("route and reveal motion fail closed when reduced motion changes", async () => {
  const motion = await source("components/site-motion.tsx");

  assert.match(motion, /const REDUCED_MOTION_QUERY = "\(prefers-reduced-motion: reduce\)"/);
  assert.match(motion, /main\.classList\.remove\("route-motion-enter"\)/);
  assert.match(motion, /}, 860\);/);
  assert.match(motion, /element\.classList\.remove\("motion-reveal--pending"\)/);
  assert.match(motion, /element\.classList\.add\("is-revealed"\)/);
  assert.ok((motion.match(/reducedMotion\.addEventListener\("change", handleReducedMotionChange\)/g)?.length ?? 0) >= 2);
  assert.ok((motion.match(/reducedMotion\.removeEventListener\("change", handleReducedMotionChange\)/g)?.length ?? 0) >= 2);
});

test("the Jukebox joins the motion scene and owns one replaceable programmatic timer", async () => {
  const jukebox = await source("components/home-jukebox.tsx");

  assert.match(jukebox, /data-motion-scene="jukebox"/);
  assert.match(jukebox, /sizes="\(max-width: 700px\) 86vw, \(max-width: 1000px\) 42vw, \(max-width: 1440px\) 430px, \(max-width: 2200px\) 20vw, 500px"/);
  assert.match(jukebox, /const programmaticTimerRef = useRef<number \| null>\(null\)/);
  assert.match(jukebox, /if \(programmaticTimerRef\.current !== null\) \{[\s\S]*?window\.clearTimeout\(programmaticTimerRef\.current\)/);
  assert.match(jukebox, /const scheduleProgrammaticRelease = useCallback/);
  assert.match(jukebox, /const clearProgrammaticTimer = useCallback/);
  assert.match(jukebox, /clearProgrammaticTimer\(\);[\s\S]*?audio\?\.pause\(\)/);
  assert.equal(jukebox.match(/window\.setTimeout\(/g)?.length, 1);
});
