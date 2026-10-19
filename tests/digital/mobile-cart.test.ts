import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { digitalArticleCount, digitalMoney, digitalQuotedCartIds } from "@/lib/digital/cart-presentation";
import { normalizeDigitalCart, type DigitalCompletionSource, type DigitalSelection } from "@/lib/digital/domain";
import { completeDigitalAlbum } from "@/lib/digital/completion-policy";

const source = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("mobile cart: French euro formatting retains two decimals and a non-breaking euro", () => {
  for (const [cents, expected] of [[0, "0,00"], [129, "1,29"], [990, "9,90"], [1000, "10,00"]] as const) {
    assert.equal(digitalMoney(cents), `${expected}\u00a0€`);
    assert.equal(digitalMoney(cents).includes("\n"), false);
  }
  assert.match(digitalMoney(123456), /^1[\u202f\u00a0]234,56\u00a0€$/);
});

test("mobile cart: item label is explicit for empty, singular, plural and fifty selections", () => {
  for (const [count, text] of [[0, "0 articles"], [1, "1 article"], [4, "4 articles"], [50, "50 articles"]] as const) {
    assert.equal(digitalArticleCount(count), text);
  }
});

test("mobile cart: quoted membership accepts only unique server-quoted requested IDs", () => {
  assert.deepEqual(digitalQuotedCartIds({ lines: [{ id: "album" }] }, ["track", "album"]), ["album"]);
  assert.deepEqual(digitalQuotedCartIds({ lines: [] }, []), []);
  for (const invalid of [null, {}, { lines: null }, { lines: [{ id: "other" }] }, { lines: [{ id: "album" }, { id: "album" }] }, { lines: [{ title: "Album" }] }]) {
    assert.equal(digitalQuotedCartIds(invalid, ["album"]), null);
  }
});

const tracks = Array.from({ length: 12 }, (_, i) => ({ trackId: randomUUID(), masterId: randomUUID(), position: i + 1, title: `Titre long numéro ${i + 1} — WAV et MP3` }));
const album: DigitalSelection = { id: randomUUID(), scope: "ALBUM", title: "Album synthétique", priceCents: 990, version: 1, tracks };
const singles = tracks.map(track => ({ id: randomUUID(), scope: "TRACK", title: track.title, priceCents: 129, version: 1, tracks: [track] }));

test("mobile cart: album plus covered titles is one article at 9.90 EUR, independent of addition order", () => {
  for (const selection of [[...singles, album], [album, ...singles], [singles[0], album, singles[0]]]) {
    const quote = normalizeDigitalCart(selection, new Set());
    assert.equal(quote.lines.length, 1);
    assert.equal(quote.lines[0].id, album.id);
    assert.equal(quote.totalCents, 990);
    assert.equal(quote.lines[0].completion, undefined);
    assert.equal(digitalArticleCount(quote.lines.length), "1 article");
  }
  const four = normalizeDigitalCart(singles.slice(0, 4), new Set());
  assert.equal(four.lines.length, 4);
  assert.equal(four.totalCents, 516);
  assert.equal(digitalMoney(four.totalCents), "5,16\u00a0€");
});

test("mobile cart: only separately acquired net paid titles form an album credit, not titles merely in this cart", () => {
  const paid: DigitalCompletionSource = { trackId: tracks[0].trackId, masterId: tracks[0].masterId, sourceLineId: randomUUID(), paidCents: 129,
    refundedCents: 29, availableCents: 100, creditCents: 100, proofHash: "a".repeat(64) };
  const owned = new Set([paid.trackId]);
  const completion = completeDigitalAlbum(album, owned, [paid]);
  const quote = normalizeDigitalCart([completion, singles[0], singles[1]], owned);
  assert.equal(quote.lines.length, 1);
  assert.equal(quote.totalCents, 890);
  assert.equal(quote.lines[0].completion?.creditCents, 100);
  assert.throws(() => normalizeDigitalCart([singles[0]], owned), { code: "ALREADY_OWNED" });
  assert.throws(() => normalizeDigitalCart([{ ...completion, priceCents: 861 }], owned), { code: "INVALID_COMPLETION" });
});

test("mobile cart: prices cannot break while long titles can shrink, and all removal controls have a 44px target", async () => {
  const css = await source("components/digital.module.css"), cart = await source("components/digital-cart.tsx");
  assert.match(css, /\.cartRow\s*\{[^}]*minmax\(0,1fr\) max-content/);
  assert.match(css, /\.cartIdentity\s*\{[^}]*min-width:0/);
  assert.match(css, /\.cartAmount\s*\{[^}]*white-space:nowrap;[^}]*overflow-wrap:normal;[^}]*word-break:normal;[^}]*flex-shrink:0/);
  assert.match(css, /\.cartRemove\s*\{[^}]*min-height:44px/);
  assert.match(cart, /aria-label=\{t\("Retirer \{title\} du panier", \{ title: l\.title \}\)\}/);
  assert.ok(cart.includes('window.location.assign("/musique/checkout")'));
  assert.ok(!cart.includes('router.push("/musique/checkout")'));
  assert.ok(cart.includes('href="/discographie"'));
  assert.ok(cart.includes('busy || updating || !value?.lines.length || !!error'));
});

test("mobile cart: navigation uses normalized quote counts and preserves public/order withdrawal links outside commercial navigation", async () => {
  const nav = await source("components/digital-navigation.tsx"), footer = await source("components/site-footer.tsx"), library = await source("components/digital-library.tsx");
  assert.ok(nav.includes('fetch("/api/digital/quote"'));
  assert.ok(nav.includes('JSON.stringify(readDigitalCart()) !== key'));
  assert.ok(nav.includes('if (confirmed !== key) writeDigitalCart(quoted.ids)'));
  assert.ok(nav.includes('if (!ids.length) { confirmed = ""; setTotalCents(null); setChecking(false); return; }'));
  assert.match(nav, /if \(key === confirmed\)[\s\S]*?confirmed = "";\s*setTotalCents\(null\)/);
  assert.ok(nav.includes('aria-busy={checking}'));
  assert.ok(nav.includes('role="status" aria-live="polite"'));
  assert.ok(nav.includes('href="/discographie"'));
  assert.ok(nav.includes('href="/compte/musique"'));
  assert.ok(!nav.includes('href="/retractation'));
  assert.ok(footer.includes('href="/retractation"'));
  assert.ok(library.includes('`/retractation?contrat=digital&commande=${o.id}`'));
});
