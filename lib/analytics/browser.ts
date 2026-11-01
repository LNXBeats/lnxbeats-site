import {
  ANALYTICS_CONSENT_STORAGE_KEY,
  analyticsPageViewParameters,
  mayLoadAnalytics,
  parseAnalyticsConsentRecord,
  readAnalyticsConsent,
  serializeAnalyticsConsent,
  type AnalyticsConfiguration,
  type AnalyticsConsent,
  type AnalyticsDecision,
} from "./policy";
import { isScriptNonce } from "../security/csp-nonce";

export const ANALYTICS_SCRIPT_ID = "lnx-analytics";
export const ANALYTICS_DATA_LAYER = "lnxAnalyticsData";
const COOKIE_PREFIX = "lnx";
const MAX_TIMEOUT = 2_147_483_647;
type AnalyticsWindow = Window & {
  lnxAnalyticsData?: unknown[];
  lnxAnalyticsBootstrapped?: boolean;
  [key: `ga-disable-${string}`]: boolean | undefined;
};
const documentBoundaries = new WeakMap<Window, { eligible: boolean; navigationRequested: boolean }>();

/** A Next SPA transition does not replace the initial document's CSP.
 * Remember eligibility even while on a private route. A checkout nonce only
 * authorizes its own payment policy; it is not evidence of Analytics eligibility.
 */
export function createAnalyticsDocumentBoundary({ configuration, win }: {
  configuration: AnalyticsConfiguration;
  win: Window;
}) {
  let state = documentBoundaries.get(win);
  if (!state) {
    let initialOrigin = win.location.origin;
    let initialPathname = win.location.pathname;
    // Navigation Timing keeps the actual initial document URL through SPA changes.
    // Only its eligibility boolean is retained, never a private URL or query.
    const navigation = win.performance?.getEntriesByType("navigation")[0];
    if (navigation) {
      try {
        const initial = new URL(navigation.name);
        initialOrigin = initial.origin;
        initialPathname = initial.pathname;
      } catch { initialOrigin = ""; initialPathname = ""; }
    }
    state = {
      eligible: mayLoadAnalytics({ configuration, origin: initialOrigin, pathname: initialPathname, consent: "granted" }),
      navigationRequested: false,
    };
    documentBoundaries.set(win, state);
  }
  const boundary = state;
  return {
    mayStartSession() {
      const currentEligible = mayLoadAnalytics({ configuration, origin: win.location.origin, pathname: win.location.pathname, consent: "granted" });
      if (!currentEligible || boundary.navigationRequested) return false;
      if (boundary.eligible) return true;
      boundary.navigationRequested = true; // At most once in this document, including remounts.
      (win as AnalyticsWindow)[`ga-disable-${configuration.measurementId}`] = true;
      win.location.replace(win.location.href);
      return false;
    },
  };
}

/** One document, one explicit page view. No real Google transport in QA/test mode.
 * All browser dependencies are injected so the tests never contact Google.
 */
export function createAnalyticsBrowserSession({ configuration, win, doc, onConsent, now = Date.now }: {
  configuration: AnalyticsConfiguration;
  win: Window;
  doc: Document;
  onConsent: (consent: AnalyticsConsent) => void;
  now?: () => number;
}) {
  const browser = win as AnalyticsWindow;
  const disabledKey = `ga-disable-${configuration.measurementId}` as const;
  const initialPath = win.location.pathname;
  let disposed = false;
  let tracking = false;
  let script: HTMLScriptElement | null = null;
  let timer: number | undefined;
  let restoreNavigation: (() => void) | undefined;
  browser[disabledKey] = true;

  const read = () => {
    try { return win.localStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY); } catch { return null; }
  };
  const request = (consent: AnalyticsConsent) => ({
    configuration, origin: win.location.origin, pathname: win.location.pathname, consent,
  });
  const clearOwnCookies = () => {
    // These exact cookie names belong to this integration, never the session/cart.
    const names = [`${COOKIE_PREFIX}_ga`, `${COOKIE_PREFIX}_ga_${configuration.measurementId.slice(2)}`];
    for (const name of names) {
      doc.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax; Secure`;
      doc.cookie = `${name}=; Path=/; Domain=${win.location.hostname}; Max-Age=0; SameSite=Lax; Secure`;
    }
  };
  const stop = (clearCookies = false) => {
    browser[disabledKey] = true; // First: also blocks a late-arriving provider script.
    tracking = false;
    if (browser.lnxAnalyticsData) browser.lnxAnalyticsData.length = 0;
    script?.remove();
    script = null;
    restoreNavigation?.();
    restoreNavigation = undefined;
    if (clearCookies) clearOwnCookies();
  };
  const leaveDocument = (url: URL, replace = false) => {
    stop();
    if (replace) win.location.replace(url.href);
    else win.location.assign(url.href);
  };
  const protectNavigation = () => {
    const previousPush = win.history.pushState;
    const previousReplace = win.history.replaceState;
    const wrap = (original: History["pushState"], replace: boolean): History["pushState"] => function (data, unused, url) {
      if (url != null) {
        const target = new URL(String(url), win.location.href);
        // Preserve query/hash-only transitions and native cross-origin errors.
        if (target.origin === win.location.origin && target.pathname !== win.location.pathname) {
          leaveDocument(target, replace);
          return;
        }
      }
      return original.call(win.history, data, unused, url);
    };
    const push = wrap(previousPush, false);
    const replace = wrap(previousReplace, true);
    win.history.pushState = push;
    win.history.replaceState = replace;
    const click = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || (anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return;
      const target = new URL(anchor.href, win.location.href);
      if (target.origin === win.location.origin && target.pathname !== win.location.pathname) {
        event.preventDefault();
        leaveDocument(target);
      }
    };
    const pop = () => {
      if (win.location.pathname !== initialPath) { stop(); win.location.reload(); }
    };
    doc.addEventListener("click", click, true);
    win.addEventListener("popstate", pop, true);
    restoreNavigation = () => {
      // Do not overwrite wrappers subsequently installed by another component.
      if (win.history.pushState === push) win.history.pushState = previousPush;
      if (win.history.replaceState === replace) win.history.replaceState = previousReplace;
      doc.removeEventListener("click", click, true);
      win.removeEventListener("popstate", pop, true);
    };
  };
  const start = (raw: string | null) => {
    if (disposed || tracking || configuration.mode !== "production") return;
    const record = parseAnalyticsConsentRecord(raw, now());
    const parameters = analyticsPageViewParameters(request(record?.decision ?? "unknown"));
    // An RSC response's nonce is not the nonce of this document.
    const nonce = doc.querySelector<HTMLScriptElement>('script[nonce][src^="/_next/"]')?.nonce;
    if (!record || !parameters || !isScriptNonce(nonce)) return;
    // A removed script cannot be unloaded. A new session needs a new document.
    if (browser.lnxAnalyticsBootstrapped) { win.location.reload(); return; }
    protectNavigation();
    browser.lnxAnalyticsBootstrapped = true;
    browser[disabledKey] = false;
    const queue: unknown[] = [];
    browser.lnxAnalyticsData = queue;
    const command: (...args: unknown[]) => void = function () {
      // Use the provider's documented IArguments queue format, not an event object.
      // eslint-disable-next-line prefer-rest-params
      queue.push(arguments);
    };
    command("consent", "default", {
      analytics_storage: "denied", ad_storage: "denied", ad_user_data: "denied", ad_personalization: "denied",
    });
    command("js", new Date(now()));
    command("consent", "update", { analytics_storage: "granted" });
    command("config", configuration.measurementId, {
      ...parameters,
      send_page_view: false,
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      ignore_referrer: true,
      cookie_prefix: COOKIE_PREFIX,
      cookie_domain: win.location.hostname,
      cookie_path: "/",
      cookie_expires: Math.max(1, Math.floor((record.expiresAt - now()) / 1000)),
      cookie_update: false,
      cookie_flags: "SameSite=Lax;Secure",
    });
    command("event", "page_view", { ...parameters, send_to: configuration.measurementId });
    script = doc.createElement("script");
    script.id = ANALYTICS_SCRIPT_ID;
    script.async = true;
    script.nonce = nonce;
    script.referrerPolicy = "no-referrer";
    script.src = `https://www.googletagmanager.com/gtag/js?id=${configuration.measurementId}&l=${ANALYTICS_DATA_LAYER}`;
    script.onerror = () => { stop(); };
    tracking = true;
    doc.head.append(script);
  };
  const reconcile = () => {
    if (disposed) return;
    if (timer !== undefined) win.clearTimeout(timer);
    const raw = read();
    const consent = readAnalyticsConsent(raw, now());
    onConsent(consent);
    const allowed = mayLoadAnalytics(request(consent));
    if (!allowed && tracking) {
      stop(true);
      // A full reload removes provider listeners as well as its script element.
      win.location.reload();
      return;
    }
    if (allowed) start(raw);
    const record = parseAnalyticsConsentRecord(raw, now());
    if (record) timer = win.setTimeout(reconcile, Math.min(MAX_TIMEOUT, Math.max(1, record.expiresAt - now())));
  };
  const storage = (event: StorageEvent) => {
    if (event.key === null || event.key === ANALYTICS_CONSENT_STORAGE_KEY) reconcile();
  };
  const visibility = () => { if (doc.visibilityState === "visible") reconcile(); };
  const pagehide = () => { stop(); };
  const pageshow = (event: PageTransitionEvent) => { if (event.persisted && browser.lnxAnalyticsBootstrapped) win.location.reload(); };
  win.addEventListener("storage", storage);
  win.addEventListener("pagehide", pagehide);
  win.addEventListener("pageshow", pageshow);
  doc.addEventListener("visibilitychange", visibility);
  reconcile();
  return {
    choose(decision: AnalyticsDecision) {
      if (disposed) return false;
      const raw = serializeAnalyticsConsent(decision, now());
      if (!raw) return false;
      try { win.localStorage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, raw); }
      catch {
        // Never turn a failed persistence operation into a remembered agreement.
        stop(true);
        onConsent("unknown");
        if (browser.lnxAnalyticsBootstrapped) win.location.reload();
        return false;
      }
      if (decision === "denied") clearOwnCookies();
      reconcile();
      return true;
    },
    dispose() {
      disposed = true;
      if (timer !== undefined) win.clearTimeout(timer);
      stop();
      win.removeEventListener("storage", storage);
      win.removeEventListener("pagehide", pagehide);
      win.removeEventListener("pageshow", pageshow);
      doc.removeEventListener("visibilitychange", visibility);
    },
  };
}
