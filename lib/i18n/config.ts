export const LANGUAGES = [
  { code: "fr", label: "Français", intl: "fr-FR" },
  { code: "en", label: "English", intl: "en-GB" },
  { code: "es", label: "Español", intl: "es-ES" },
  { code: "pt", label: "Português", intl: "pt-PT" },
  { code: "zh", label: "简体中文", intl: "zh-CN" },
  { code: "ja", label: "日本語", intl: "ja-JP" },
] as const;
export type SiteLocale = typeof LANGUAGES[number]["code"];
export const LANGUAGE_COOKIE = "lnx_language";
export function siteLocale(value: unknown): SiteLocale { return LANGUAGES.some(l => l.code === value) ? value as SiteLocale : "fr"; }
export function localeIntl(locale: SiteLocale) { return LANGUAGES.find(l => l.code === locale)!.intl; }
export function localizedMoney(cents: number, locale: SiteLocale) { return new Intl.NumberFormat(localeIntl(locale), { style: "currency", currency: "EUR" }).format(cents / 100); }
