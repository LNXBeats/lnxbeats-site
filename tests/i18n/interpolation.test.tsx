import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { SiteLanguageProvider, T } from "@/components/site-language";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { formatMessage } from "@/lib/i18n/interpolate";
import { messages } from "@/lib/i18n/messages";
import { brandSafeTranslation } from "@/lib/i18n/protected-content";
import { LANGUAGES } from "@/lib/i18n/config";

test("every translation retains explicit placeholders and protected brands", () => {
  const tokens = (value: string) => [...value.matchAll(/\{[A-Za-z][A-Za-z0-9_]*\}/g)].map(m => m[0]).sort();
  for (const [source, translations] of Object.entries(messages)) for (const value of translations) {
    assert.deepEqual(tokens(value), tokens(source), source);
    assert.equal(brandSafeTranslation(source, value), value, source);
  }
});
test("interpolation never evaluates markup or translates a work title", () => {
  assert.equal(formatMessage("{title} / {count} / {unknown}", {title:"LNX Beats <VIE DE CHIEN>", count:2}), "LNX Beats <VIE DE CHIEN> / 2 / {unknown}");
  for (const language of LANGUAGES) {
    const router = { bfcacheId:"interpolation-local",back(){},forward(){},refresh(){},hmrRefresh(){},push(){},replace(){},prefetch(){} };
    const html = renderToStaticMarkup(<AppRouterContext.Provider value={router}><PathnameContext.Provider value="/musique/panier"><SiteLanguageProvider initialLocale={language.code} enabled><T text="Retirer {title} du panier" values={{title:"LNX Beats <VIE DE CHIEN>"}}/></SiteLanguageProvider></PathnameContext.Provider></AppRouterContext.Provider>);
    assert.ok(html.includes('translate="no"'));
    assert.ok(html.includes("LNX Beats &lt;VIE DE CHIEN&gt;"));
    assert.ok(!html.includes("{title}"));
  }
});
