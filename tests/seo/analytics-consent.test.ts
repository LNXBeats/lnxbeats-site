import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createAnalyticsBrowserSession, createAnalyticsDocumentBoundary, ANALYTICS_DATA_LAYER, ANALYTICS_SCRIPT_ID } from "@/lib/analytics/browser";
import { ANALYTICS_CONSENT_STORAGE_KEY, ANALYTICS_CONSENT_MAX_AGE_MS, serializeAnalyticsConsent, type AnalyticsConfiguration, type AnalyticsConsent } from "@/lib/analytics/policy";

// Isolated fake browser/transport. No DOM, provider call, cookie or client data.
const config: AnalyticsConfiguration = { enabled: true, mode: "production", origin: "https://www.lnxbeats.fr", measurementId: "G-TESTONLY" };
type Handler = (event: never) => void;
class Events {
  listeners = new Map<string, Set<Handler>>();
  addEventListener(name: string, handler: Handler) { const set = this.listeners.get(name) ?? new Set(); set.add(handler); this.listeners.set(name, set); }
  removeEventListener(name: string, handler: Handler) { this.listeners.get(name)?.delete(handler); }
  dispatch(name: string, event: object = {}) { for (const handler of [...(this.listeners.get(name) ?? [])]) handler(event as never); }
}
function fixture({ url = "https://www.lnxbeats.fr/album/vie-de-chien?email=private@example.test#private", nonce = "A".repeat(43) + "=", consent = null as string | null, configuration = config } = {}) {
  let time = 1_800_000_000_000;
  let currentUrl = new URL(url);
  let storageError = false;
  const values = new Map<string, string>();
  if (consent !== null) values.set(ANALYTICS_CONSENT_STORAGE_KEY, consent);
  const states: AnalyticsConsent[] = [];
  const cookies: string[] = [];
  const scripts: Array<Record<string, unknown> & { removed: boolean; remove: () => void; onerror?: () => void }> = [];
  const navigation: Array<{ mode: string; url?: string; disabled: unknown }> = [];
  const timers = new Map<number, () => void>();
  let serial = 0;
  const winEvents = new Events();
  const docEvents = new Events();
  const win = Object.assign(winEvents, {
    performance: { getEntriesByType: (kind: string) => kind === "navigation" ? [{ name: url }] : [] },
    location: {
      get origin() { return currentUrl.origin; }, get pathname() { return currentUrl.pathname; },
      get href() { return currentUrl.href; }, get hostname() { return currentUrl.hostname; },
      assign(value: string) { navigation.push({ mode: "assign", url: value, disabled: (win as unknown as Record<string, unknown>)[`ga-disable-${configuration.measurementId}`] }); },
      replace(value: string) { navigation.push({ mode: "replace", url: value, disabled: (win as unknown as Record<string, unknown>)[`ga-disable-${configuration.measurementId}`] }); },
      reload() { navigation.push({ mode: "reload", disabled: (win as unknown as Record<string, unknown>)[`ga-disable-${configuration.measurementId}`] }); },
    },
    localStorage: {
      getItem(key: string) { if (storageError) throw new Error("storage unavailable"); return values.get(key) ?? null; },
      setItem(key: string, value: string) { if (storageError) throw new Error("storage unavailable"); values.set(key, value); },
    },
    history: {
      pushState(_data: unknown, _unused: string, value?: string | URL | null) { if (value != null) currentUrl = new URL(String(value), currentUrl); },
      replaceState(_data: unknown, _unused: string, value?: string | URL | null) { if (value != null) currentUrl = new URL(String(value), currentUrl); },
    },
    setTimeout(callback: () => void) { timers.set(++serial, callback); return serial; },
    clearTimeout(id: number) { timers.delete(id); },
  });
  const originalPush = win.history.pushState;
  const doc = Object.assign(docEvents, {
    visibilityState: "visible",
    querySelector() { return nonce ? { nonce } : null; },
    createElement(tag: string) { assert.equal(tag, "script"); const element = { removed: false, remove() { element.removed = true; } }; return element; },
    head: { append(element: typeof scripts[number]) { scripts.push(element); } },
  });
  Object.defineProperty(doc, "cookie", { set(value: string) { cookies.push(value); } });
  const session = createAnalyticsBrowserSession({ configuration, win: win as unknown as Window, doc: doc as unknown as Document, onConsent: value => states.push(value), now: () => time });
  return { win, doc, states, scripts, cookies, navigation, values, session, originalPush, timers,
    disable: () => (win as unknown as Record<string, unknown>)[`ga-disable-${configuration.measurementId}`],
    commands: () => (((win as unknown as Record<string, unknown>)[ANALYTICS_DATA_LAYER] ?? []) as IArguments[]).map(args => Array.from(args)),
    stored: (decision: "granted" | "denied") => serializeAnalyticsConsent(decision, time)!,
    timeAdvance: (ms: number) => { time += ms; },
    storageFailure: () => { storageError = true; },
    changeUrl: (next: string) => { currentUrl = new URL(next, currentUrl); },
  };
}

test("no Google script or command before a dedicated choice, including refusal", () => {
  const f = fixture();
  assert.deepEqual(f.states, ["unknown"]);
  assert.equal(f.disable(), true);
  assert.equal(f.scripts.length, 0);
  assert.deepEqual(f.commands(), []);
  assert.equal(f.session.choose("denied"), true);
  assert.equal(f.scripts.length, 0);
  assert.equal(f.navigation.length, 0);
  f.session.dispose();
});
test("agreement loads one nonced tag, one sanitized page view and no advertising permission", () => {
  const f = fixture();
  f.session.choose("granted");
  assert.equal(f.scripts.length, 1);
  assert.equal(f.scripts[0].id, ANALYTICS_SCRIPT_ID);
  assert.equal(f.scripts[0].referrerPolicy, "no-referrer");
  assert.match(String(f.scripts[0].src), /^https:\/\/www\.googletagmanager\.com\/gtag\/js\?id=G-TESTONLY&l=lnxAnalyticsData$/);
  const commands = f.commands();
  assert.equal(commands[0][0], "consent");
  assert.deepEqual(commands[0][2], { analytics_storage: "denied", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied" });
  const options = commands.find(c => c[0] === "config")![2] as Record<string, unknown>;
  assert.equal(options.send_page_view, false);
  assert.equal(options.allow_google_signals, false);
  assert.equal(options.allow_ad_personalization_signals, false);
  assert.equal(options.page_location, "https://www.lnxbeats.fr/album/vie-de-chien");
  assert.equal(options.page_referrer, "");
  assert.equal(options.page_title, "");
  assert.equal(options.cookie_update, false);
  assert.equal(options.cookie_domain, "www.lnxbeats.fr");
  assert.equal(options.cookie_expires, ANALYTICS_CONSENT_MAX_AGE_MS / 1000);
  assert.equal(commands.filter(c => c[0] === "event" && c[1] === "page_view").length, 1);
  assert.doesNotMatch(JSON.stringify(commands), /private@example|#private|\?email/);
  f.win.dispatch("storage", { key: ANALYTICS_CONSENT_STORAGE_KEY });
  assert.equal(f.scripts.length, 1);
  f.session.dispose();
});
test("no tag without current-document nonce, on a private route, foreign origin or test transport", () => {
  for (const options of [{ nonce: "" }, { nonce: "untrusted" }, { url: "https://www.lnxbeats.fr/compte" }, { url: "https://www.lnxbeats.fr/admin" }, { url: "http://127.0.0.1:3194/" }, { configuration: { ...config, mode: "test" as const, origin: "http://127.0.0.1:3194" }, url: "http://127.0.0.1:3194/" }]) {
    const f = fixture(options);
    f.session.choose("granted");
    assert.equal(f.scripts.length, 0);
    assert.equal(f.disable(), true);
    f.session.dispose();
  }
});
test("withdrawal disables late callbacks, empties pending commands and reloads the document", () => {
  const f = fixture();
  f.session.choose("granted");
  f.session.choose("denied");
  assert.equal(f.disable(), true);
  assert.equal(f.scripts[0].removed, true);
  assert.deepEqual(f.commands(), []);
  assert.equal(f.navigation.at(-1)?.mode, "reload");
  assert.ok(f.cookies.every(cookie => /^(lnx_ga|lnx_ga_TESTONLY)=;/.test(cookie)));
  assert.ok(f.cookies.every(cookie => cookie.includes("Max-Age=0")));
  assert.equal(f.win.history.pushState, f.originalPush);
  f.scripts[0].onerror?.();
  assert.equal(f.disable(), true);
  assert.equal(f.scripts.length, 1);
  f.session.dispose();
});
test("cross-tab withdrawal and storage removal stop before reloading", () => {
  for (const clear of [false, true]) {
    const f = fixture(); f.session.choose("granted");
    if (clear) f.values.clear(); else f.values.set(ANALYTICS_CONSENT_STORAGE_KEY, f.stored("denied"));
    f.win.dispatch("storage", { key: clear ? null : ANALYTICS_CONSENT_STORAGE_KEY });
    assert.equal(f.disable(), true);
    assert.equal(f.navigation.at(-1)?.disabled, true);
    assert.deepEqual(f.commands(), []);
    f.session.dispose();
  }
});
test("expired choice never extends itself and stops on visibility check", () => {
  const f = fixture(); f.session.choose("granted");
  const originalRecord = f.values.get(ANALYTICS_CONSENT_STORAGE_KEY);
  f.timeAdvance(ANALYTICS_CONSENT_MAX_AGE_MS);
  f.doc.dispatch("visibilitychange");
  assert.equal(f.states.at(-1), "unknown");
  assert.equal(f.disable(), true);
  assert.equal(f.values.get(ANALYTICS_CONSENT_STORAGE_KEY), originalRecord);
  assert.equal(f.navigation.at(-1)?.mode, "reload");
  f.session.dispose();
});
test("failed storage cannot enable measurement or leave an already-loaded tag active", () => {
  for (const loaded of [false, true]) {
    const f = fixture(); if (loaded) f.session.choose("granted");
    f.storageFailure();
    assert.equal(f.session.choose("granted"), false);
    assert.equal(f.states.at(-1), "unknown");
    assert.equal(f.disable(), true);
    assert.equal(f.scripts.length, loaded ? 1 : 0);
    f.session.dispose();
  }
});
test("programmatic navigation cannot move an instrumented document into a private route", () => {
  for (const mode of ["pushState", "replaceState"] as const) {
    const f = fixture(); f.session.choose("granted");
    f.win.history[mode]({}, "", "/compte?token=private");
    assert.equal(f.win.location.pathname, "/album/vie-de-chien");
    assert.equal(f.disable(), true);
    assert.equal(f.navigation.at(-1)?.disabled, true);
    assert.equal(f.navigation.at(-1)?.url, "https://www.lnxbeats.fr/compte?token=private");
    assert.deepEqual(f.commands(), []);
    f.session.dispose();
  }
});
test("hash/query navigation remains native without a second page view", () => {
  const f = fixture(); f.session.choose("granted");
  f.win.history.pushState({}, "", "?new=private#track");
  assert.equal(f.win.location.pathname, "/album/vie-de-chien");
  assert.equal(f.navigation.length, 0);
  assert.equal(f.commands().filter(c => c[0] === "event").length, 1);
  assert.doesNotMatch(JSON.stringify(f.commands()), /new=private/);
  f.session.dispose();
});
test("private back-navigation pauses before reload and bfcache never reuses tracking", () => {
  const f = fixture(); f.session.choose("granted");
  f.changeUrl("/compte"); f.win.dispatch("popstate");
  assert.equal(f.disable(), true);
  assert.equal(f.navigation.at(-1)?.mode, "reload");
  f.win.dispatch("pageshow", { persisted: true });
  assert.equal(f.navigation.at(-1)?.disabled, true);
  f.session.dispose();
});
test("normal links leave via a new document; new tabs and download links are preserved", () => {
  for (const target of ["_self", "_blank", "download"] as const) {
    const f = fixture(); f.session.choose("granted");
    let prevented = false;
    const anchor = { target: target === "download" ? "" : target, href: "https://www.lnxbeats.fr/compte", hasAttribute: () => target === "download" };
    f.doc.dispatch("click", { button: 0, target: { closest: () => anchor }, preventDefault() { prevented = true; } });
    assert.equal(prevented, target === "_self");
    assert.equal(f.navigation.length, target === "_self" ? 1 : 0);
    f.session.dispose();
  }
});
test("disposing removes own listeners and timers without overwriting a later history wrapper", () => {
  const f = fixture(); f.session.choose("granted");
  const other = () => {}; f.win.history.pushState = other;
  f.session.dispose();
  assert.equal(f.win.history.pushState, other);
  assert.equal(f.disable(), true);
  assert.equal(f.timers.size, 0);
  assert.ok([...f.win.listeners.values(), ...f.doc.listeners.values()].every(set => set.size === 0));
  assert.equal(f.session.choose("granted"), false);
});
test("a remount cannot inject a duplicate provider into a previously instrumented document", () => {
  const f = fixture(); f.session.choose("granted"); f.session.dispose();
  const next = createAnalyticsBrowserSession({ configuration: { ...config }, win: f.win as unknown as Window, doc: f.doc as unknown as Document, onConsent: () => {}, now: () => 1_800_000_000_000 });
  assert.equal(f.scripts.length, 1);
  assert.equal(f.disable(), true);
  assert.equal(f.navigation.at(-1)?.mode, "reload");
  next.dispose();
});
test("private document to public SPA transition requires one fresh document, independent of a checkout nonce", () => {
  for (const [path, nonce] of [["/compte", ""], ["/musique/checkout", "A".repeat(43) + "="]] as const) {
    const f = fixture({ url: `https://www.lnxbeats.fr${path}`, nonce });
    f.session.dispose();
    const win = f.win as unknown as Window;
    const boundary = createAnalyticsDocumentBoundary({ configuration: config, win });
    assert.equal(boundary.mayStartSession(), false);
    assert.equal(f.navigation.length, 0);
    f.changeUrl("/discographie");
    assert.equal(boundary.mayStartSession(), false);
    assert.equal(f.navigation.length, 1);
    assert.deepEqual(f.navigation[0], { mode: "replace", url: "https://www.lnxbeats.fr/discographie", disabled: true });
    // Repeated effects/remounts cannot start the tag or loop the navigation.
    assert.equal(boundary.mayStartSession(), false);
    assert.equal(createAnalyticsDocumentBoundary({ configuration: { ...config }, win }).mayStartSession(), false);
    assert.equal(f.navigation.length, 1);
    assert.equal(f.scripts.length, 0);
    assert.deepEqual(f.commands(), []);
    const fresh = fixture({ url: "https://www.lnxbeats.fr/discographie" });
    assert.equal(createAnalyticsDocumentBoundary({ configuration: config, win: fresh.win as unknown as Window }).mayStartSession(), true);
    assert.equal(fresh.navigation.length, 0);
    fresh.session.dispose();
  }
});
test("late mount still uses the initial document route, not the new SPA path or a payment nonce", () => {
  const f = fixture({ url: "https://www.lnxbeats.fr/musique/checkout", nonce: "A".repeat(43) + "=" });
  f.session.dispose();
  f.changeUrl("/discographie");
  assert.equal(createAnalyticsDocumentBoundary({ configuration: config, win: f.win as unknown as Window }).mayStartSession(), false);
  assert.equal(f.navigation.length, 1);
  assert.equal(f.scripts.length, 0);
});
test("a public document lacking its nonce remains closed without any reload loop", () => {
  const f = fixture({ url: "https://www.lnxbeats.fr/discographie", nonce: "" });
  const boundary = createAnalyticsDocumentBoundary({ configuration: config, win: f.win as unknown as Window });
  assert.equal(boundary.mayStartSession(), true);
  f.session.choose("granted");
  assert.equal(f.scripts.length, 0);
  assert.equal(f.navigation.length, 0);
  assert.equal(boundary.mayStartSession(), true);
  f.session.dispose();
});
test("consent UI has six languages, equal actions and no TCF/account preference reuse", async () => {
  const source = await readFile(new URL("../../components/site-analytics.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../../components/site-analytics.module.css", import.meta.url), "utf8");
  for (const locale of ["fr", "en", "es", "pt", "zh", "ja"]) assert.ok(source.includes(`${locale}: {`));
  assert.ok(source.includes('choose("denied")') && source.includes('choose("granted")'));
  assert.match(source, /aria-labelledby/);
  assert.doesNotMatch(source, /__tcfapi|release_alert|aria-modal="true"/);
  assert.match(source, /role="dialog" aria-modal="false"/);
  assert.match(source, /event\.key === "Escape"/);
  assert.match(source, /\[enabled, mode, origin, measurementId, pathname\]/);
  assert.doesNotMatch(source, /\[configuration, pathname\]/);
  assert.ok(source.indexOf("boundary.mayStartSession()") < source.indexOf("const current = createAnalyticsBrowserSession"));
  assert.match(css, /\.actions button \{/);
});
