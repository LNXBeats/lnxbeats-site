import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import { registerHooks } from "node:module";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { SiteLanguageProvider } from "@/components/site-language";
import { LANGUAGES, localizedMoney } from "@/lib/i18n/config";
import { translate } from "@/lib/i18n/messages";

// Text-only SSR test: CSS is stubbed, so this is not visual/mobile evidence.
registerHooks({ load(url, context, next) {
  if (url.endsWith(".css")) return { format: "module", source: "export default new Proxy({}, { get: (_target, key) => String(key) });", shortCircuit: true };
  return next(url, context);
} });
const { DigitalCheckout } = await import("@/components/digital-checkout");
const names = ["hydrate", "saveResidence", "refreshResidence", "requestCheckout", "payByCardOrLocal", "createPaypalOrder", "approvePaypalOrder"];
function financialBodies(source: string) {
  const ast = ts.createSourceFile("checkout.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const result: Record<string, string> = {};
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name && names.includes(node.name.text)) result[node.name.text] = node.getText(ast);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return result;
}
test("DCN traduction : résidence, facturation, verrous et requêtes identiques à HEAD", () => {
  const path = "components/digital-checkout.tsx";
  const before = financialBodies(execFileSync("git", ["show", `HEAD:${path}`], { encoding: "utf8" }));
  const after = financialBodies(fs.readFileSync(path, "utf8"));
  assert.deepEqual(Object.keys(after).sort(), [...names].sort());
  assert.deepEqual(after, before);
});

const router = { bfcacheId: "digital-ui-local-only", back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {} };
const escaped = (value: string) => renderToStaticMarkup(<>{value}</>);
test("DCN SSR six langues : prix EUR, titres originaux, consentements FR, aucun paiement prêt", () => {
  for (const { code } of LANGUAGES) {
    const html = renderToStaticMarkup(<AppRouterContext.Provider value={router}><PathnameContext.Provider value="/musique/checkout"><SiteLanguageProvider initialLocale={code} enabled>
      <DigitalCheckout revision={17} totalCents={1119} lines={[
        { id: "synthetic-title-not-an-offer", title: "Commander", priceCents: 129, trackCount: 1 },
        { id: "synthetic-album-not-an-offer", title: "LNX Beats — VIE DE CHIEN", priceCents: 990, trackCount: 12 },
      ]} providers={["STRIPE"]} termsVersion="qa-source-only" mode="LIVE" contractApproved newSalesOpen paypalClientId={null}/>
    </SiteLanguageProvider></PathnameContext.Provider></AppRouterContext.Provider>);
    for (const amount of [129, 990, 1119]) assert.ok(html.includes(localizedMoney(amount, code)), `${code} ${amount}`);
    assert.ok(html.includes('<strong translate="no" class="notranslate">Commander</strong>'));
    assert.ok(html.includes("LNX Beats — VIE DE CHIEN"));
    assert.ok(html.includes('lang="fr" translate="no"'));
    assert.ok(html.includes("J’accepte les CGV numériques."));
    assert.ok(html.includes(escaped(translate(code, "Vos coordonnées"))));
    assert.ok(html.includes(escaped(translate(code, "Vérifiez votre adresse et cochez les deux confirmations pour continuer."))));
    assert.ok(!html.includes("paypal.com/sdk/"));
    assert.ok(html.includes('disabled=""'));
  }
});
