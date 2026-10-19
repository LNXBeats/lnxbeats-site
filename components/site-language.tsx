"use client";
import { createContext, useContext, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { LANGUAGES, LANGUAGE_COOKIE, siteLocale, localizedMoney, type SiteLocale } from "@/lib/i18n/config";
import { messages, translate } from "@/lib/i18n/messages";
import { brandSafeTranslation, brandSegments } from "@/lib/i18n/protected-content";
import { OriginalName } from "@/components/original-name";
import { formatMessage, type MessageValues } from "@/lib/i18n/interpolate";
const LanguageContext = createContext<{ locale: SiteLocale; enabled: boolean; change: (locale: SiteLocale) => void }>({ locale: "fr", enabled: false, change() {} });
export function SiteLanguageProvider({ initialLocale, enabled = false, children }: { initialLocale: SiteLocale; enabled?: boolean; children: React.ReactNode }) {
  const [locale, setLocale] = useState(initialLocale);
  const router = useRouter();
  const pathname = usePathname();
  // Administration stays French; preference is retained for the public site.
  const effectiveLocale = !enabled || pathname.startsWith("/admin") ? "fr" : locale;
  useEffect(() => { document.documentElement.lang = effectiveLocale === "zh" ? "zh-Hans" : effectiveLocale; }, [effectiveLocale]);
  return <LanguageContext.Provider value={{ locale: effectiveLocale, enabled, change(next) {
    const safe = siteLocale(next);
    document.cookie = `${LANGUAGE_COOKIE}=${safe}; Path=/; Max-Age=31536000; SameSite=Lax${window.location.protocol === "https:" ? "; Secure" : ""}`;
    setLocale(safe);
    router.refresh();
  } }}>{children}</LanguageContext.Provider>;
}
export function useSiteLanguage() {
  const { locale, change, enabled } = useContext(LanguageContext);
  return { locale, change, enabled, t: (source: string, values?: MessageValues) => formatMessage(brandSafeTranslation(source, translate(locale, source)), values), money: (cents: number) => localizedMoney(cents, locale) };
}
export function T({ text, values }: { text: string; values?: MessageValues }) {
  const { t, locale } = useSiteLanguage();
  const value = t(text);
  const translated = Object.hasOwn(messages, text) && (locale === "fr" || value !== text);
  const pieces = value.split(/(\{[A-Za-z][A-Za-z0-9_]*\})/g);
  return <span lang={translated ? locale === "zh" ? "zh-Hans" : locale : "fr"}>{pieces.map((piece, i) => {
    const key = piece.startsWith("{") && piece.endsWith("}") ? piece.slice(1, -1) : null;
    if (key && values && Object.hasOwn(values, key)) return <OriginalName key={i}>{values[key]}</OriginalName>;
    return brandSegments(piece).map((part, j) => part.protected ? <OriginalName key={`${i}-${j}`}>{part.text}</OriginalName> : part.text);
  })}</span>;
}
export function LanguageSelector({ menu = false }: { menu?: boolean }) {
  const { locale, change, t, enabled } = useSiteLanguage();
  const pathname = usePathname();
  if (!enabled || pathname.startsWith("/admin")) return null;
  return <label className={`site-language${menu ? " site-language--menu" : ""}`}><span>{t("Langue")}</span><select aria-label={t("Langue")} value={locale} onChange={e => change(siteLocale(e.target.value))}>{LANGUAGES.map(l => <option lang={l.code === "zh" ? "zh-Hans" : l.code} value={l.code} key={l.code}>{l.label}</option>)}</select></label>;
}
export function ContractLanguageNotice() {
  const { locale, t } = useSiteLanguage();
  return locale === "fr" ? null : <p className="site-language-notice">{t("Les conditions contractuelles et les justificatifs restent en français. La langue d’interface ne change ni vos droits ni les territoires de vente.")}</p>;
}
/** Reading aid only; the visible, versioned French declaration is still the accepted source. */
export function ContractReadingAid({ text }: { text: string }) {
  const { locale } = useSiteLanguage();
  return locale === "fr" ? null : <details className="site-language-notice"><summary><T text="Aide de lecture — original contractuel en français"/></summary><p><T text={text}/></p></details>;
}
