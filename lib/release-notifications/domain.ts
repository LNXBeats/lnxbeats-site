import { siteLocale, type SiteLocale } from "@/lib/i18n/config";

export const RELEASE_ALERT_CONSENT_VERSION = "release-alerts-v1-20261022";
export const RELEASE_ALERT_KINDS = ["MUSIC", "SHOP", "EDITORIAL"] as const;
export type ReleaseAlertKind = typeof RELEASE_ALERT_KINDS[number];
export type ReleaseAlertChoices = Readonly<{ music: boolean; shop: boolean; editorial: boolean; locale: SiteLocale }>;
export const DEFAULT_RELEASE_ALERT_CHOICES: ReleaseAlertChoices = { music: false, shop: false, editorial: false, locale: "fr" };

/** No coercion: missing, checked-looking strings or unknown fields are not consent. */
export function parseReleaseAlertChoices(input: unknown): ReleaseAlertChoices | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const value = input as Record<string, unknown>;
  if (Object.keys(value).some(key => !["music", "shop", "editorial", "locale"].includes(key))) return null;
  if (typeof value.music !== "boolean" || typeof value.shop !== "boolean" || typeof value.editorial !== "boolean") return null;
  if (typeof value.locale !== "string" || siteLocale(value.locale) !== value.locale) return null;
  return { music: value.music, shop: value.shop, editorial: value.editorial, locale: siteLocale(value.locale) };
}

type Preference = Pick<ReleaseAlertChoices, "music" | "shop" | "editorial"> & {
  musicConsentedAt: Date | null; shopConsentedAt: Date | null; editorialConsentedAt: Date | null;
};
export function releaseAlertEligible(preference: Preference | null | undefined, kind: string, publicationAt: Date) {
  if (!preference) return false;
  const category = kind === "MUSIC" ? "music" : kind === "SHOP" ? "shop" : kind === "EDITORIAL" ? "editorial" : null;
  if (!category || !preference[category]) return false;
  const consentedAt = preference[`${category}ConsentedAt`];
  return Boolean(consentedAt && consentedAt <= publicationAt);
}

export function releaseAlertPreferenceData(previous: Preference | null, choices: ReleaseAlertChoices, now: Date) {
  const consentDate = (category: "music" | "shop" | "editorial") => choices[category]
    ? previous?.[category] && previous[`${category}ConsentedAt`] ? previous[`${category}ConsentedAt`] : now
    : null;
  return { ...choices, consentVersion: RELEASE_ALERT_CONSENT_VERSION,
    musicConsentedAt: consentDate("music"), shopConsentedAt: consentDate("shop"), editorialConsentedAt: consentDate("editorial") };
}

export function releaseAlertPublicPath(kind: ReleaseAlertKind, slug: string) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || slug.length > 160) throw new Error("INVALID_PUBLIC_SLUG");
  return `${kind === "MUSIC" ? "/album" : kind === "SHOP" ? "/boutique" : "/creations"}/${slug}`;
}
