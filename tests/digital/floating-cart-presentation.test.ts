import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { floatingDigitalCartQuote, showFloatingDigitalCart } from "../../lib/digital/floating-cart-presentation";
import { shopCartMessages } from "../../lib/i18n/messages-shop-cart";
import { brandSafeTranslation } from "../../lib/i18n/protected-content";

test("floating music cart uses the validated server quote, including legitimate zero totals", () => {
  assert.deepEqual(floatingDigitalCartQuote({ totalCents: 129, lines: [{ id: "track" }] }, ["track"]), { ids: ["track"], totalCents: 129 });
  assert.deepEqual(floatingDigitalCartQuote({ totalCents: 0, lines: [] }, ["track"]), { ids: [], totalCents: 0 });
  assert.deepEqual(floatingDigitalCartQuote({ totalCents: 990, lines: [{ id: "album" }] }, ["album", "covered-track"]), { ids: ["album"], totalCents: 990 });
});

test("unknown, duplicate or untrusted totals never appear as authoritative prices", () => {
  for (const value of [null, {}, { lines: [], totalCents: "129" }, { lines: [], totalCents: 129 },
    { lines: [{ id: "other" }], totalCents: 129 }, { lines: [{ id: "track" }, { id: "track" }], totalCents: 258 },
    ...[-1, 1.29, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1].map(totalCents => ({ lines: [{ id: "track" }], totalCents }))]) {
    assert.equal(floatingDigitalCartQuote(value, ["track"]), null);
  }
});

test("floating digital CTA is restricted to public music discovery, never physical checkout", () => {
  assert.equal(showFloatingDigitalCart("/discographie"), true);
  assert.equal(showFloatingDigitalCart("/album/vie-de-chien"), true);
  for (const path of ["/admin", "/boutique", "/boutique/panier", "/musique/panier", "/musique/checkout", "/musique/confirmation/123", "/compte/musique", "/"]) assert.equal(showFloatingDigitalCart(path), false);
});

test("presentation reuses one quote path, portal and real cart, and respects reduced motion", () => {
  const component = readFileSync(new URL("../../components/digital-navigation.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../../components/digital-navigation.module.css", import.meta.url), "utf8");
  assert.equal((component.match(/fetch\("\/api\/digital\/quote"/g) ?? []).length, 1);
  assert.match(component, /createPortal/);
  assert.match(component, /data-digital-floating-cart/);
  assert.match(component, /href="\/musique\/panier"/);
  assert.match(component, /AbortController/);
  assert.match(component, /request !== current/);
  assert.match(component, /aria-live="polite"/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(css, /safe-area-inset-bottom/);
  assert.doesNotMatch(css, /animation:[^;}]*infinite/);
});

test("shop and cart translations preserve branding and complete all five language slots", () => {
  for (const [source, values] of Object.entries(shopCartMessages)) {
    assert.equal(values.length, 5, source);
    for (const value of values) {
      assert.ok(value.trim(), source);
      assert.equal(brandSafeTranslation(source, value), value, source);
      for (const token of source.match(/\{\w+\}/g) ?? []) assert.ok(value.includes(token), `${source}: ${token}`);
    }
  }
});
