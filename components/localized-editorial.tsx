"use client";

import { OriginalName } from "./original-name";
import { useSiteLanguage } from "./site-language";
import { messages } from "@/lib/i18n/messages";
import { editorialIdentityParts, editorialSafeTranslation } from "@/lib/i18n/editorial-content";

export function LocalizedEditorial({ text, names = [] }: { text: string; names?: readonly string[] }) {
  const { t, locale } = useSiteLanguage();
  const value = editorialSafeTranslation(text, t(text), names);
  const translated = locale === "fr" || Object.hasOwn(messages, text) && value !== text;
  return <span lang={translated ? locale === "zh" ? "zh-Hans" : locale : "fr"} data-editorial-language={translated ? locale : "fr"}>
    {editorialIdentityParts(value, names).map((part, index) => part.original ? <OriginalName key={index}>{part.text}</OriginalName> : part.text)}
  </span>;
}
