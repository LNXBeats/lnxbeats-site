import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { PathnameContext } from "next/dist/shared/lib/hooks-client-context.shared-runtime";
import { SiteLanguageProvider } from "@/components/site-language";
import { StripeCheckoutAction } from "@/components/stripe-checkout-action";
import { PaypalCheckoutAction } from "@/components/paypal-checkout-action";
import { PaymentReturnNotice } from "@/components/payment-return-notice";
import { DigitalPaypalButtons } from "@/components/digital-paypal-buttons";
import { paymentMessages } from "@/lib/i18n/messages-payment";
import { LANGUAGES, localizedMoney, type SiteLocale } from "@/lib/i18n/config";
import { translate } from "@/lib/i18n/messages";

const files = ["stripe-checkout-action", "paypal-checkout-action", "paypal-return-capture", "payment-return-notice", "digital-paypal-buttons"];
function protectedBodies(source: string) {
  const ast = ts.createSourceFile("component.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const found: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "startCheckout") found.push(node.getText(ast));
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect") found.push(node.getText(ast));
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return found;
}
test("paiements UI : requêtes, captures, callbacks SDK, reprises et polling inchangés", () => {
  for (const name of files) {
    const path = `components/${name}.tsx`;
    const before = execFileSync("git", ["show", `HEAD:${path}`], { encoding: "utf8" });
    const after = fs.readFileSync(path, "utf8");
    assert.deepEqual(protectedBodies(after), protectedBodies(before), name);
  }
});

test("paiements UI : cinq traductions non vides, marques et paramètres inchangés", () => {
  for (const [source, translations] of Object.entries(paymentMessages)) {
    const tokens = [...source.matchAll(/\{\w+\}/g)].map(m => m[0]).sort();
    assert.equal(translations.length, 5);
    for (const value of translations) {
      assert.ok(value.trim(), source);
      assert.deepEqual([...value.matchAll(/\{\w+\}/g)].map(m => m[0]).sort(), tokens, source);
      for (const brand of ["LNX Beats", "LNX Studio", "PayPal", "Stripe", "Apple Pay"]) if (source.includes(brand)) assert.ok(value.includes(brand), source);
    }
  }
});

const router = { bfcacheId: "payment-ui-local-only", back() {}, forward() {}, refresh() {}, hmrRefresh() {}, push() {}, replace() {}, prefetch() {} };
function render(locale: SiteLocale, child: React.ReactNode) {
  return renderToStaticMarkup(<AppRouterContext.Provider value={router}><PathnameContext.Provider value="/commander"><SiteLanguageProvider initialLocale={locale} enabled>{child}</SiteLanguageProvider></PathnameContext.Provider></AppRouterContext.Provider>);
}
const escaped = (source: string) => renderToStaticMarkup(<>{source}</>);
test("paiements SSR : six langues, montants exacts, états de retour et blocage préflight sans réseau", () => {
  for (const { code } of LANGUAGES) {
    if (code !== "fr") {
      assert.notEqual(translate(code, "Confirmation du paiement"), "Confirmation du paiement", code);
      assert.notEqual(translate(code, "Payer {amount} avec PayPal"), "Payer {amount} avec PayPal", code);
    }
    for (const target of ["music", "shop"] as const) {
      const stripe = render(code, <StripeCheckoutAction orderNumber="QA-LOCAL-NO-ORDER" amountCents={990} target={target}/>);
      const paypal = render(code, <PaypalCheckoutAction orderNumber="QA-LOCAL-NO-ORDER" amountCents={990} target={target}/>);
      const amount = localizedMoney(990, code);
      assert.ok(stripe.includes(amount));
      assert.ok(paypal.includes(amount));
      const source = target === "shop" ? "Payer {amount} — commande avec obligation de paiement" : "Payer {amount} avec PayPal";
      assert.ok(paypal.includes(escaped(translate(code, source).replace("{amount}", amount))));
    }
    for (const state of ["confirmed", "failed", "review", "confirming", "ready"] as const) {
      const html = render(code, <PaymentReturnNotice state="return" paymentState={state} orderNumber="QA-LOCAL-NO-ORDER"/>);
      assert.ok(html.includes(escaped(translate(code, "Confirmation du paiement"))));
    }
    const notReady = render(code, <DigitalPaypalButtons ready={false} clientId={null} createOrder={async () => { throw new Error("Must not execute"); }} onApprove={async () => { throw new Error("Must not execute"); }} onCancel={() => { throw new Error("Must not execute"); }} onError={() => { throw new Error("Must not execute"); }}/>);
    assert.ok(notReady.includes(escaped(translate(code, "Complétez l’adresse et les confirmations pour afficher le bouton PayPal sécurisé."))));
    assert.ok(!notReady.includes("paypal.com/sdk/"));
  }
});
