/** Pure, client-safe policy. No environment, browser storage, clock or network I/O.
 * Analytics consent is independent of advertising/TCF and functional cookies.
 */
export const ANALYTICS_CANONICAL_ORIGIN = "https://www.lnxbeats.fr";
export const ANALYTICS_CONNECT_ORIGINS = Object.freeze([
  "https://www.google-analytics.com", "https://region1.google-analytics.com",
] as const);
export const ANALYTICS_CONSENT_VERSION = 1;
export const ANALYTICS_CONSENT_STORAGE_KEY = "lnx.analytics.consent.v1";
export const ANALYTICS_CONSENT_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;

export type AnalyticsEnvironment = Readonly<Record<string, string | undefined>>;
export type AnalyticsConsent = "unknown" | "denied" | "granted";
export type AnalyticsDecision = Exclude<AnalyticsConsent, "unknown">;
export type AnalyticsConfiguration = Readonly<{
  enabled: true;
  mode: "production" | "test";
  origin: string;
  measurementId: string;
}>;
export type AnalyticsConsentRecord = Readonly<{
  version: typeof ANALYTICS_CONSENT_VERSION;
  decision: AnalyticsDecision;
  decidedAt: number;
  expiresAt: number;
}>;
export type AnalyticsRequest = Readonly<{
  configuration: AnalyticsConfiguration | null;
  origin: string;
  pathname: string;
  consent: AnalyticsConsent;
}>;
export type AnalyticsPageViewParameters = Readonly<{
  page_location: string;
  page_referrer: "";
  page_title: "";
}>;

const PUBLIC_PATHS = new Set([
  "/", "/discographie", "/avant-premieres", "/creations", "/boutique", "/a-propos",
]);
const CONSENT_KEYS = ["decidedAt", "decision", "expiresAt", "version"];
const MAX_STORED_CONSENT_LENGTH = 512;
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);
const timestamp = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const explicitDecision = (value: unknown): value is AnalyticsDecision =>
  value === "denied" || value === "granted";

/** Syntax only: the property/stream still has to be verified in the owner's account. */
export function isAnalyticsMeasurementId(value: unknown): value is string {
  // Unlike $, the final assertion cannot match before a trailing line terminator.
  return typeof value === "string" && /^G-[A-Z0-9]{1,32}(?![\s\S])/.test(value);
}

/** No implicit process.env and no preview/QA environment flag can opt into tracking. */
export function resolveAnalyticsConfiguration(env: AnalyticsEnvironment = {}): AnalyticsConfiguration | null {
  if (!record(env) || env.ANALYTICS_ENABLED !== "true"
    || env.NODE_ENV !== "production" || env.RAILWAY_ENVIRONMENT_NAME !== "production"
    || env.SITE_URL !== ANALYTICS_CANONICAL_ORIGIN
    || !isAnalyticsMeasurementId(env.ANALYTICS_MEASUREMENT_ID)) return null;
  return Object.freeze({ enabled: true, mode: "production", origin: ANALYTICS_CANONICAL_ORIGIN, measurementId: env.ANALYTICS_MEASUREMENT_ID });
}

function isTestOrigin(origin: unknown): origin is string {
  if (typeof origin !== "string" || origin.length > 128) return false;
  try {
    const url = new URL(origin);
    return ["http:", "https:"].includes(url.protocol)
      && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      && url.origin === origin && !url.username && !url.password;
  } catch { return false; }
}

/** Explicit dependency-injection fixture only. Production resolution never calls this.
 * Tests must supply a fake transport; this configuration does not authorize Google I/O.
 */
export function createAnalyticsTestConfiguration(input: Readonly<{ origin: string; measurementId: string }>): AnalyticsConfiguration | null {
  if (!record(input) || !isTestOrigin(input.origin) || !isAnalyticsMeasurementId(input.measurementId)) return null;
  return Object.freeze({ enabled: true, mode: "test", origin: input.origin, measurementId: input.measurementId });
}

/** Validate the raw pathname, never decode/normalize an ambiguous path into eligibility. */
export function allowsAnalyticsPath(pathname: unknown): pathname is string {
  if (typeof pathname !== "string" || pathname.length > 127) return false;
  // The 127-character cap includes the seven-character /album/ prefix.
  return PUBLIC_PATHS.has(pathname) || /^\/album\/[a-z0-9]+(?:-[a-z0-9]+)*(?![\s\S])/.test(pathname);
}

/** Queries, fragments, private route names and arbitrary URL origins cannot enter payloads. */
export function canonicalAnalyticsPageLocation(pathname: unknown): string | null {
  return allowsAnalyticsPath(pathname) ? `${ANALYTICS_CANONICAL_ORIGIN}${pathname}` : null;
}

export function mayLoadAnalytics(input: AnalyticsRequest): boolean {
  if (!record(input)) return false;
  const config = input.configuration;
  return record(config) && config.enabled === true && isAnalyticsMeasurementId(config.measurementId)
    && (config.mode === "production" ? config.origin === ANALYTICS_CANONICAL_ORIGIN
      : config.mode === "test" && isTestOrigin(config.origin))
    && input.origin === config.origin && input.consent === "granted" && allowsAnalyticsPath(input.pathname);
}

/** Explicit empty referrer/title suppress provider defaults; never accept user-supplied values. */
export function analyticsPageViewParameters(input: AnalyticsRequest): AnalyticsPageViewParameters | null {
  if (!mayLoadAnalytics(input)) return null;
  return Object.freeze({
    page_location: canonicalAnalyticsPageLocation(input.pathname)!,
    page_referrer: "",
    page_title: "",
  });
}

/** Call only for an explicit analytics choice, never for a TCF/functional-cookie signal. */
export function createAnalyticsConsentRecord(decision: unknown, nowMs: number): AnalyticsConsentRecord | null {
  if (!explicitDecision(decision) || !timestamp(nowMs)
    || !Number.isSafeInteger(nowMs + ANALYTICS_CONSENT_MAX_AGE_MS)) return null;
  return Object.freeze({
    version: ANALYTICS_CONSENT_VERSION,
    decision,
    decidedAt: nowMs,
    expiresAt: nowMs + ANALYTICS_CONSENT_MAX_AGE_MS,
  });
}

/** Storage errors are handled by the caller as null/unknown. Reading never renews expiry. */
export function parseAnalyticsConsentRecord(raw: unknown, nowMs: number): AnalyticsConsentRecord | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_STORED_CONSENT_LENGTH
    || raw.includes("\\") || !timestamp(nowMs)) return null;
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { return null; }
  if (!record(parsed) || Object.keys(parsed).sort().join(",") !== CONSENT_KEYS.join(",")) return null;
  // Reject duplicate/escaped field names rather than resolving ambiguous saved choices.
  const keys = [...raw.matchAll(/"(version|decision|decidedAt|expiresAt)"\s*:/g)].map(match => match[1]).sort();
  if (keys.join(",") !== CONSENT_KEYS.join(",")) return null;
  if (parsed.version !== ANALYTICS_CONSENT_VERSION || !explicitDecision(parsed.decision)
    || !timestamp(parsed.decidedAt) || !timestamp(parsed.expiresAt)
    || parsed.decidedAt > nowMs || parsed.expiresAt <= nowMs
    || parsed.expiresAt <= parsed.decidedAt
    || parsed.expiresAt - parsed.decidedAt > ANALYTICS_CONSENT_MAX_AGE_MS) return null;
  return Object.freeze({ version: ANALYTICS_CONSENT_VERSION, decision: parsed.decision, decidedAt: parsed.decidedAt, expiresAt: parsed.expiresAt });
}

export function readAnalyticsConsent(raw: unknown, nowMs: number): AnalyticsConsent {
  return parseAnalyticsConsentRecord(raw, nowMs)?.decision ?? "unknown";
}

export function serializeAnalyticsConsent(decision: unknown, nowMs: number): string | null {
  const consent = createAnalyticsConsentRecord(decision, nowMs);
  return consent ? JSON.stringify(consent) : null;
}
