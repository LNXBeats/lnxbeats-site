import "server-only";

import { cookies, headers } from "next/headers";
import { LANGUAGE_COOKIE, localeIntl, localizedMoney, siteLocale, type SiteLocale } from "./config";
import { translate } from "./messages";
import { brandSafeTranslation } from "./protected-content";
import { formatMessage, type MessageValues } from "./interpolate";

/** Presentation only: never used for residence, contract snapshots or payment calculations. */
export async function getSiteLocale(): Promise<SiteLocale> {
  if (process.env.SITE_LANGUAGES_ENABLED !== "true") return "fr";
  const [requestCookies, requestHeaders] = await Promise.all([cookies(), headers()]);
  const selected = requestHeaders.get("x-lnx-ui-language");
  return siteLocale(selected ?? requestCookies.get(LANGUAGE_COOKIE)?.value);
}

export function serverT(locale: SiteLocale, source: string, values?: MessageValues): string {
  return formatMessage(brandSafeTranslation(source, translate(locale, source)), values);
}

export function serverMoney(locale: SiteLocale, cents: number): string {
  return localizedMoney(cents, locale);
}

export function serverDate(locale: SiteLocale, value: string | Date, options: Intl.DateTimeFormatOptions = {}): string {
  return new Intl.DateTimeFormat(localeIntl(locale), { timeZone: "Europe/Paris", ...options }).format(new Date(value));
}
