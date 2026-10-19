import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { SiteLanguageProvider } from "@/components/site-language";
import { OrderJourneyProvider } from "@/components/order-journey-provider";
import { MusicOrderForm } from "@/components/music-order-form";
import { LANGUAGES, localizedMoney } from "@/lib/i18n/config";
import { translate } from "@/lib/i18n/messages";

const router = {
  bfcacheId: "commander-local-render-only",
  back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {},
};
const headings = [
  "Donnons un premier repère à votre création.", "Racontez ce qui ne doit pas être perdu.",
  "Choisissez la couleur et les options.", "Ajoutez les images qui éclairent votre histoire.",
  "Connectez-vous pour protéger votre brief.", "Une dernière relecture avant l’enregistrement.",
];

test("SSR Commander : six étapes dans six langues, sans réseau ni écriture", () => {
  for (const language of LANGUAGES) for (let step = 0; step < 6; step++) {
    const html = renderToStaticMarkup(
      <AppRouterContext.Provider value={router}>
        <PathnameContext.Provider value="/commander">
          <SiteLanguageProvider initialLocale={language.code} enabled>
            <OrderJourneyProvider>
              <MusicOrderForm account={{ authenticated: false }} initialDraft={null} initialStep={step} paymentProviders={{ stripe: false, paypal: false }}/>
            </OrderJourneyProvider>
          </SiteLanguageProvider>
        </PathnameContext.Provider>
      </AppRouterContext.Provider>,
    );
    // Compare DOM text, not raw HTML entities escaped by React.
    const expected = renderToStaticMarkup(<>{translate(language.code, headings[step])}</>);
    assert.ok(html.includes(expected), `${language.code} step ${step}`);
    assert.ok(html.includes(localizedMoney(2000, language.code)), `${language.code} money`);
    assert.ok(!html.includes('name="amount"'));
    assert.ok(!html.includes('src="https://www.paypal.com/sdk/'));
    if (step === 2) {
      assert.ok(html.includes(translate(language.code, "Rap français")));
      assert.ok(html.includes("LNX Beats"));
    }
    if (step === 5) {
      assert.ok(html.includes('lang="fr" translate="no"'));
      assert.ok(html.includes("Je demande expressément que LNX Beats commence"));
    }
  }
});
