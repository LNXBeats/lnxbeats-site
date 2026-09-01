import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  orderIllustrationFormatLabel,
  orderIllustrationFormatOptions,
} from "@/data/order-illustration";
import { calculateOrderPrice, parseOrderDraftInput } from "@/lib/orders/domain";
import { checkoutLineItemsFromOrderSnapshot } from "@/lib/payments/domain";

const baseDraft = {
  title: "Élégie d’été",
  recipient: "Camille",
  occasion: "Souvenir",
  brief: "Une histoire suffisamment longue pour devenir une création musicale.",
  musicalDirection: "Soul / R&B",
  emotion: "Lumineuse",
  importantDetails: "",
  wordsToInclude: "",
  avoid: "",
  pronunciationNotes: "",
  illustrationFormat: null,
  illustrationFormatCustom: "",
  coverIncluded: false,
  priorityProcessing: false,
} as const;

test("exposes the five human illustration formats without technical labels", () => {
  assert.deepEqual(orderIllustrationFormatOptions.map(({ value }) => value), [
    "SQUARE",
    "VERTICAL",
    "LANDSCAPE",
    "PORTRAIT",
    "CUSTOM",
  ]);
  assert.equal(orderIllustrationFormatLabel("SQUARE"), "Carré — 1:1");
  assert.equal(orderIllustrationFormatLabel("VERTICAL"), "Vertical — 9:16");
  assert.equal(orderIllustrationFormatLabel("LANDSCAPE"), "Paysage — 16:9");
  assert.equal(orderIllustrationFormatLabel("PORTRAIT"), "Portrait — 4:5");
  assert.equal(orderIllustrationFormatLabel("CUSTOM"), "Autre format");
  assert.equal(orderIllustrationFormatLabel(null), "Non renseigné");
});

test("keeps every illustration format at the same server-computed price", () => {
  for (const format of orderIllustrationFormatOptions.map(({ value }) => value)) {
    const parsed = parseOrderDraftInput({
      ...baseDraft,
      coverIncluded: true,
      illustrationFormat: format,
      illustrationFormatCustom: format === "CUSTOM" ? "Bannière 21:9" : "",
    });
    assert.equal(parsed.ok, true, format);
    if (parsed.ok) {
      const pricing = calculateOrderPrice(parsed.value);
      assert.equal(pricing.totalCents, 3_000, format);
      const checkoutTotal = checkoutLineItemsFromOrderSnapshot({
        basePriceCents: pricing.basePriceCents,
        coverPriceCents: pricing.coverPriceCents,
        priorityPriceCents: pricing.priorityPriceCents,
        totalCents: pricing.totalCents,
        currency: pricing.currency,
        pricingVersion: pricing.pricingVersion,
        coverIncluded: true,
        priorityProcessing: false,
      }).reduce((sum, item) => sum + item.price_data.unit_amount, 0);
      assert.equal(checkoutTotal, 3_000, `Checkout ${format}`);
    }
  }
});

test("Commander carries the illustration choice through draft, recap and finalization", () => {
  const form = readFileSync("components/music-order-form.tsx", "utf8");
  assert.match(form, /illustrationFormat: order\.illustrationFormat/);
  assert.match(form, /illustrationFormatCustom: order\.illustrationFormatCustom/);
  assert.match(form, /name="illustrationFormat"/);
  assert.match(form, /orderIllustrationFormatOptions\.map/);
  assert.match(form, /orderIllustrationFormatLabel\(form\.illustrationFormat\)/);
  assert.match(form, /body: JSON\.stringify\(form\)/);
  assert.match(form, /personalUseTermsAccepted: true/);
  assert.match(form, /earlyPerformanceConsentAccepted: true/);
  assert.match(form, /setForm\(draftFromOrder\(payload\.order\)\)/);
  assert.match(form, /illustrationFormatCustom: value === "CUSTOM" \? current\.illustrationFormatCustom : ""/);
  assert.doesNotMatch(form, /Cover personnalisée|\bCover \+10/);
});

test("Commander links validation errors and exposes a keyboard-safe premium upload", () => {
  const form = readFileSync("components/music-order-form.tsx", "utf8");
  const css = readFileSync("app/v084-commander.css", "utf8");
  assert.match(form, /aria-busy=\{busy\}/);
  assert.match(form, /<fieldset className="form-step" disabled=\{busy\} key=\{step\}>/);
  assert.match(form, /const errorFieldSteps/);
  assert.match(form, /if \(targetStep !== undefined && targetStep !== step\) moveToStep\(targetStep\)/);
  assert.match(form, /requestAnimationFrame/);
  assert.match(form, /aria-invalid=\{errorField === "recipient"\}/);
  assert.match(form, /order-brief-counter order-brief-error/);
  assert.match(form, /aria-describedby=\{errorField === "illustrationFormatCustom"/);
  assert.match(form, /id="order-illustration-format-custom"\s+required/);
  assert.match(form, /id="order-confirmations-error"/);
  assert.match(form, /type="file" multiple accept="image\/jpeg,image\/png,image\/webp/);
  assert.match(form, /progress\.scrollTo/);
  assert.doesNotMatch(form, /activeItem\.scrollIntoView/);
  assert.match(css, /\.order-upload-zone:has\(\+ \.order-upload-input:focus-visible\)/);
  assert.match(css, /\.order-upload-field:focus-within \.order-upload-zone/);
  assert.match(css, /\.order-step-heading h2:focus-visible/);
  assert.match(css, /\.order-form--premium \.order-photo-list button \{[^}]*min-height: 44px/s);
  assert.match(css, /@media \(max-width: 430px\)/);
  assert.match(css, /@media \(max-width: 360px\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.doesNotMatch(form, /Stockage R2 privé/);
  assert.match(form, /Le total sera recalculé et vérifié lors de l’enregistrement/);
  assert.doesNotMatch(css, /\.form-navigation \.form-button--primary \{ grid-row: 1/);
});

test("Compte, confirmation and Admin use Illustration terminology and expose the saved format", () => {
  const surfaces = [
    readFileSync("app/compte/page.tsx", "utf8"),
    readFileSync("app/compte/commandes/[orderNumber]/page.tsx", "utf8"),
    readFileSync("app/commande/[orderNumber]/confirmation/page.tsx", "utf8"),
    readFileSync("app/admin/commandes/page.tsx", "utf8"),
    readFileSync("app/admin/commandes/[orderNumber]/page.tsx", "utf8"),
  ];
  for (const surface of surfaces) {
    assert.match(surface, /Illustration/);
    assert.doesNotMatch(surface, />Cover<|"Cover"/);
  }
  assert.match(surfaces[1], /Format demandé/);
  assert.match(surfaces[1], /order\.illustrationFormat === "CUSTOM" \? <div><dt>Précision/);
  assert.match(surfaces[4], /Format demandé/);
  assert.match(surfaces[4], /order\.illustrationFormat === "CUSTOM" \? <div><dt>Précision/);
});
