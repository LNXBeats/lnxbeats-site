import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { observePremiereClock, premiereCountdownParts, premiereCountdownTarget, PREMIERE_TIME_ZONE } from "@/lib/members/premiere-countdown";
import { premiereMessages } from "@/lib/i18n/messages-premieres";
import { navigation } from "@/data/site";
import ts from "typescript";
import { messages } from "@/lib/i18n/messages";

test("premiere countdown: date-only targets use Paris midnight, including winter and summer", () => {
  assert.equal(PREMIERE_TIME_ZONE, "Europe/Paris");
  assert.equal(premiereCountdownTarget("2026-12-01"), Date.parse("2026-11-30T23:00:00Z"));
  assert.equal(premiereCountdownTarget("2026-07-01"), Date.parse("2026-06-30T22:00:00Z"));
  assert.equal(premiereCountdownTarget("2027-01-01"), Date.parse("2026-12-31T23:00:00Z"));
});

test("premiere countdown: both daylight-saving boundaries retain the exact local date", () => {
  assert.equal(premiereCountdownTarget("2026-03-29"), Date.parse("2026-03-28T23:00:00Z"));
  assert.equal(premiereCountdownTarget("2026-03-30"), Date.parse("2026-03-29T22:00:00Z"));
  assert.equal(premiereCountdownTarget("2026-03-30")! - premiereCountdownTarget("2026-03-29")!, 23 * 3_600_000);
  assert.equal(premiereCountdownTarget("2026-10-25"), Date.parse("2026-10-24T22:00:00Z"));
  assert.equal(premiereCountdownTarget("2026-10-26"), Date.parse("2026-10-25T23:00:00Z"));
  assert.equal(premiereCountdownTarget("2026-10-26")! - premiereCountdownTarget("2026-10-25")!, 25 * 3_600_000);
});

test("premiere countdown: invalid dates are never silently normalized, leap days remain valid", () => {
  for (const input of ["", "2026-2-01", "2026-02-29", "2026-04-31", "2026-13-01", "2026-00-01", "2026-01-00", "2026-01-32", "2026-01-01T00:00:00Z", " 2026-01-01", "invalid"])
    assert.equal(premiereCountdownTarget(input), null, input);
  assert.equal(premiereCountdownTarget("2028-02-29"), Date.parse("2028-02-28T23:00:00Z"));
});

test("premiere countdown: exact units, sub-second boundaries and expiry use wall time without negatives", () => {
  const now = Date.parse("2026-10-29T21:00:00Z");
  assert.deepEqual(premiereCountdownParts(now + 90_061_000, now), { reached: false, days: 1, hours: 1, minutes: 1, seconds: 1 });
  assert.deepEqual(premiereCountdownParts(now + 1, now), { reached: false, days: 0, hours: 0, minutes: 0, seconds: 1 });
  for (const target of [now, now - 1, now - 1_000_000]) assert.deepEqual(premiereCountdownParts(target, now), { reached: true, days: 0, hours: 0, minutes: 0, seconds: 0 });
  for (const target of [null, NaN, Infinity, -Infinity]) assert.equal(premiereCountdownParts(target, now), null);
  assert.equal(premiereCountdownParts(now, NaN), null);
});

function clockFixture(start = 0, initiallyVisible = true) {
  let now = start, visible = initiallyVisible;
  let tick: (() => void) | null = null, changed: (() => void) | null = null;
  let scheduled = 0, cancelled = 0, subscribed = 0, unsubscribed = 0;
  return {
    clock: { now: () => now, visible: () => visible,
      everySecond(callback: () => void) { scheduled++; tick = callback; return () => { cancelled++; tick = null; }; },
      onVisibilityChange(callback: () => void) { subscribed++; changed = callback; return () => { unsubscribed++; changed = null; }; },
    },
    advance(value: number) { now = value; tick?.(); },
    visibility(value: boolean) { visible = value; changed?.(); },
    silentVisibility(value: boolean) { visible = value; },
    counts: () => ({ scheduled, cancelled, subscribed, unsubscribed, active: tick !== null }),
  };
}

test("premiere countdown clock: hidden tabs own no timer and resume against the real clock", () => {
  const f = clockFixture(1000), values: number[] = [];
  const dispose = observePremiereClock(100_000, now => values.push(now), f.clock);
  assert.deepEqual(values, [1000]); assert.equal(f.counts().active, true);
  f.advance(2000); assert.deepEqual(values, [1000, 2000]);
  f.visibility(false); assert.equal(f.counts().active, false);
  f.advance(45_000); assert.deepEqual(values, [1000, 2000]);
  f.visibility(true); assert.deepEqual(values, [1000, 2000, 45_000]); assert.equal(f.counts().active, true);
  dispose(); assert.deepEqual(f.counts(), { scheduled: 2, cancelled: 2, subscribed: 1, unsubscribed: 1, active: false });
  f.advance(50_000); f.visibility(true); assert.deepEqual(values, [1000, 2000, 45_000]);
});

test("premiere countdown clock: initially hidden, expired and invalid dates cannot start intervals", () => {
  const hidden = clockFixture(1000, false), values: number[] = [];
  const disposeHidden = observePremiereClock(10_000, value => values.push(value), hidden.clock);
  assert.deepEqual(values, []); assert.equal(hidden.counts().scheduled, 0);
  hidden.advance(20_000); hidden.visibility(true);
  assert.deepEqual(values, [20_000]); assert.equal(hidden.counts().scheduled, 0); disposeHidden();
  const past = clockFixture(20_000); const disposePast = observePremiereClock(10_000, () => undefined, past.clock);
  assert.equal(past.counts().scheduled, 0); disposePast();
  for (const target of [null, NaN, Infinity]) {
    const invalid = clockFixture(); observePremiereClock(target, () => assert.fail("invalid date must not tick"), invalid.clock)();
    assert.deepEqual(invalid.counts(), { scheduled: 0, cancelled: 0, subscribed: 0, unsubscribed: 0, active: false });
  }
});

test("premiere countdown clock: exact expiry stops updates without publishing or depending on interval count", () => {
  const f = clockFixture(1000), values: number[] = [];
  const dispose = observePremiereClock(5000, now => values.push(now), f.clock);
  f.advance(5000); assert.deepEqual(values, [1000, 5000]); assert.equal(f.counts().active, false);
  f.advance(60_000); assert.deepEqual(values, [1000, 5000]); dispose();
});

test("premiere countdown clock: late hidden-tab ticks stop and clock corrections are recomputed", () => {
  const f = clockFixture(1000), values: number[] = [];
  const dispose = observePremiereClock(5000, now => values.push(now), f.clock);
  f.advance(500); assert.deepEqual(values, [1000, 500]);
  f.silentVisibility(false); f.advance(1500); assert.equal(f.counts().active, false); assert.deepEqual(values, [1000, 500]);
  dispose();
});

test("premiere countdown UI: hydration uses server instant, semantic date and non-live timer with no side effects", async () => {
  const source = await readFile(new URL("../../components/premiere-countdown.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../../components/premiere-countdown.module.css", import.meta.url), "utf8");
  assert.match(source, /useState\(initialNow\)/); assert.doesNotMatch(source, /useState\([^)]*Date\.now/);
  assert.match(source, /<time dateTime=\{new Date\(target\)\.toISOString\(\)\}/);
  assert.match(source, /role="timer" aria-live="off"/); assert.doesNotMatch(source, /aria-live="polite"|aria-live="assertive"/);
  assert.match(source, /document\.visibilityState === "visible"/); assert.match(source, /removeEventListener\("visibilitychange"/);
  assert.doesNotMatch(source, /fetch\(|router\.|location\.|publish|localStorage/);
  assert.match(css, /repeat\(4, minmax\(0, 1fr\)\)/); assert.match(css, /tabular-nums/); assert.match(css, /prefers-reduced-motion/);
});

test("premiere countdown copy: six-language keys state a Paris reference, not guaranteed platform availability", () => {
  assert(Object.keys(premiereMessages).length >= 10);
  for (const translations of Object.values(premiereMessages)) { assert.equal(translations.length, 5); assert(translations.every(text => text.trim().length > 0)); }
  assert(premiereMessages["Repère : 00:00, heure de Paris. L’heure de disponibilité peut varier selon les plateformes."]);
  assert(premiereMessages["La date annoncée est atteinte. Consultez les liens des plateformes pour vérifier la disponibilité."]);
});

test("premiere navigation: one link follows Home in shared desktop data and mobile Discover group", async () => {
  assert.equal(navigation[0].href, "/"); assert.deepEqual(navigation[1], { label: "Avant-premières", href: "/avant-premieres" });
  assert.equal(navigation.filter(link => link.href === "/avant-premieres").length, 1);
  const header = await readFile(new URL("../../components/site-header.tsx", import.meta.url), "utf8");
  assert.match(header, /"\/avant-premieres": "headphones"/);
  assert.match(header, /label: "Découvrir", items: navigation\.filter\(\(\{ href \}\) => \["\/", "\/avant-premieres", "\/discographie", "\/creations"\]\.includes\(href\)\)/);
  assert.match(header, /navigation\.map\(\(item\)/); assert.match(header, /group\.items\.map/);
  assert.match(header, /aria-current=\{isActive\(item.href\) \? "page" : undefined\}/);
  assert.match(header, /onClick=\{closeMenu\}/);
});

test("premiere experience: every literal and conditional T label has five translations without translating titles or brands", async () => {
  const content = await readFile(new URL("../../components/premiere-experience.tsx", import.meta.url), "utf8");
  const source = ts.createSourceFile("premiere-experience.tsx", content, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const variables = new Map<string, ts.Expression>();
  const collectVariables = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) variables.set(node.name.text, node.initializer);
    ts.forEachChild(node, collectVariables);
  };
  collectVariables(source);
  const keys = new Set<string>();
  const collectText = (node: ts.Node) => {
    if (ts.isStringLiteral(node)) keys.add(node.text);
    else if (ts.isJsxExpression(node) || ts.isParenthesizedExpression(node)) { if (node.expression) collectText(node.expression); }
    else if (ts.isConditionalExpression(node)) { collectText(node.whenTrue); collectText(node.whenFalse); }
    else if (ts.isIdentifier(node) && variables.has(node.text)) collectText(variables.get(node.text)!);
    else assert.fail(`Unreviewed dynamic translation: ${node.getText(source)}`);
  };
  const collectLabels = (node: ts.Node) => {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(source) === "T") {
      const attribute = node.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.getText(source) === "text");
      assert(attribute && ts.isJsxAttribute(attribute) && attribute.initializer);
      collectText(attribute.initializer);
    }
    ts.forEachChild(node, collectLabels);
  };
  collectLabels(source);
  assert(keys.size >= 40); assert(!keys.has("ALBUM"));
  const dictionary = { ...messages, ...premiereMessages };
  for (const key of keys) {
    assert(dictionary[key], `Missing translations: ${key}`);
    assert.equal(dictionary[key].length, 5, key);
    const placeholders = [...key.matchAll(/\{[A-Za-z][A-Za-z0-9_]*\}/g)].map(match => match[0]).sort();
    for (const value of dictionary[key]) {
      assert(value.trim().length > 0, key);
      assert.deepEqual([...value.matchAll(/\{[A-Za-z][A-Za-z0-9_]*\}/g)].map(match => match[0]).sort(), placeholders, key);
      if (key.includes("LNX Beats")) assert(value.includes("LNX Beats"), key);
    }
  }
  assert.match(content, /<OriginalName>\{featured.title\}<\/OriginalName>/);
  assert.match(content, /<OriginalName>\{project.title\}<\/OriginalName>/);
  assert.match(content, /<OriginalName>LNX Beats Studio<\/OriginalName>/);
  assert.doesNotMatch(content, /<T text=\{(?:project|featured).title\}/);
});
