import assert from "node:assert/strict";
import test from "node:test";

import {
  centsToAdminInput,
  nextMusicPricingVersionLabel,
  parseEuroAmountToCents,
  parseExpectedMusicPricingRevision,
  validateMusicPricingDraft,
  MusicPricingValidationError,
} from "@/lib/pricing/domain";

test("human EUR inputs are converted to exact integer cents without floats", () => {
  const values = new Map([
    ["20", 2_000],
    ["20,00", 2_000],
    ["25,5", 2_550],
    ["25.50", 2_550],
    ["0,01", 1],
  ]);
  for (const [input, expected] of values) {
    assert.equal(parseEuroAmountToCents(input, { allowZero: true, label: "Tarif" }), expected);
  }
});

test("altered, negative, imprecise and unreasonable prices are rejected", () => {
  for (const value of ["", "-1", "+20", "01", "1,999", "1e2", "NaN", "Infinity", "10000,01", 20]) {
    assert.throws(
      () => parseEuroAmountToCents(value, { allowZero: true, label: "Tarif" }),
      MusicPricingValidationError,
    );
  }
});

test("base price must be positive while explicit zero supplements remain valid", () => {
  assert.throws(
    () => validateMusicPricingDraft({ currency: "EUR", basePrice: "0", coverPrice: "10", priorityPrice: "30" }),
    (error: unknown) => error instanceof MusicPricingValidationError && error.code === "AMOUNT_OUT_OF_RANGE",
  );
  assert.deepEqual(
    validateMusicPricingDraft({ currency: "EUR", basePrice: "20", coverPrice: "0", priorityPrice: "0,00" }),
    { currency: "EUR", basePriceCents: 2_000, coverPriceCents: 0, priorityPriceCents: 0 },
  );
});

test("EUR is the only accepted currency and revisions are strict positive integers", () => {
  assert.throws(
    () => validateMusicPricingDraft({ currency: "USD", basePrice: "20", coverPrice: "10", priorityPrice: "30" }),
    (error: unknown) => error instanceof MusicPricingValidationError && error.code === "UNSUPPORTED_CURRENCY",
  );
  assert.equal(parseExpectedMusicPricingRevision("1"), 1);
  assert.equal(parseExpectedMusicPricingRevision(42), 42);
  for (const revision of ["0", "01", "1.0", "1e2", "-1", "", null]) {
    assert.throws(() => parseExpectedMusicPricingRevision(revision), MusicPricingValidationError);
  }
});

test("version labels preserve the established V1 sequence and have a deterministic fallback", () => {
  assert.equal(nextMusicPricingVersionLabel("2026-08-v2", 2), "2026-08-v3");
  assert.equal(nextMusicPricingVersionLabel("legacy", 7), "music-pricing-r7");
  assert.equal(centsToAdminInput(2_550), "25,50");
});
