import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("immersive payment finish is a scoped stylesheet, without a replacement integration", async () => {
  const css = await source("app/immersive-payment.css");
  assert.doesNotMatch(css, /@import|@font-face|url\(|expression\(|javascript:/i);
  assert.doesNotMatch(css, /(?:^|\n)\s*(?:body|html|button|iframe)\s*[.{:#[]/);
  assert.doesNotMatch(css, /display:\s*none|visibility:\s*hidden|pointer-events:\s*none(?!;\s*\n\})/);
  assert.match(css, /\.payment-methods \.payment-methods__choice/);
});

test("provider surfaces never move, filter or clip the official PayPal SDK", async () => {
  const css = await source("app/immersive-payment.css");
  assert.match(css, /overflow:\s*visible;/);
  assert.doesNotMatch(css, /(?:^|[;{\n])\s*(?:transform|filter|backdrop-filter|perspective|clip-path)\s*:/m);
  for (const rule of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    if (!rule[1].includes("::before") && /\bopacity\s*:/.test(rule[2])) assert.match(rule[2], /opacity:\s*1;/);
  }
  assert.doesNotMatch(css, /(?:^|\n)[^/{]*\biframe\b[^{}]*\{/);
  assert.doesNotMatch(css, /@keyframes|animation\s*:/);
  const decorativeRule = css.match(/\.payment-methods \.payment-methods__choice::before\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.match(decorativeRule, /height:\s*1px;/);
  assert.match(decorativeRule, /pointer-events:\s*none;/);
  assert.match(decorativeRule, /z-index:\s*-1;/);
});

test("disabled and pending controls retain explicit stable styling", async () => {
  const css = await source("app/immersive-payment.css");
  const disabled = css.match(/\.form-button:disabled\s*\{([^}]+)\}/)?.[1] ?? "";
  assert.match(disabled, /cursor:\s*not-allowed;/);
  assert.match(disabled, /opacity:\s*1;/);
  assert.match(disabled, /transition:\s*none;/);
  assert.match(css, /\.form-button:not\(:disabled\):hover/);
});

test("keyboard, long translated labels, mobile and reduced motion are preserved", async () => {
  const css = await source("app/immersive-payment.css");
  assert.match(css, /\.form-button:focus-visible\s*\{\s*outline:\s*3px solid/);
  assert.match(css, /min-height:\s*54px;/);
  assert.match(css, /overflow-wrap:\s*anywhere;/);
  assert.match(css, /@media \(max-width:\s*430px\)/);
  assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)[\s\S]*?transition:\s*none;/);
  assert.match(css, /@media \(forced-colors:\s*active\)/);
});

test("official assets and existing actions remain the only provider entry points", async () => {
  const [shared, digital, sdk] = await Promise.all([
    source("components/payment-checkout-actions.tsx"),
    source("components/digital-checkout.tsx"),
    source("lib/digital/paypal-sdk-browser.ts"),
  ]);
  assert.match(shared, /src="\/brands\/paypal-white\.svg"/);
  assert.match(shared, /<StripeCheckoutAction/);
  assert.match(shared, /<PaypalCheckoutAction/);
  assert.match(digital, /<DigitalPaypalButtons/);
  assert.match(digital, /disabled=\{!paymentReady\|\|busy\}/);
  assert.match(sdk, /sdk\/js/);
  assert.match(sdk, /style: \{ layout: "vertical", color: "gold", shape: "rect", label: "pay", height: 48, tagline: false \}/);
  assert.match(sdk, /approving \?\?= Promise\.resolve\(\)/);
});
