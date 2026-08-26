import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("mobile carousel centering scrolls only its horizontal rail", () => {
  const source = readFileSync("components/home-jukebox.tsx", "utf8");

  assert.match(source, /function centerRailItem\(rail: HTMLElement, item: HTMLElement, behavior: ScrollBehavior\)/);
  assert.match(source, /rail\.scrollTo\(\{ left: Math\.min\(maxLeft, Math\.max\(0, targetLeft\)\), behavior \}\)/);
  assert.doesNotMatch(source, /scrollIntoView/);
  assert.doesNotMatch(source, /rail\.scrollTo\(\{[^}]*\btop:/);
});
