import assert from "node:assert/strict";
import test from "node:test";

import {
  canRequestCommercialLicense,
  commercialLicensePricingSnapshot,
} from "@/lib/orders/domain";

test("fige l'extension de droits à 1 500 euros et exige un contrat", () => {
  assert.deepEqual(commercialLicensePricingSnapshot(), {
    pricingVersion: "2026-08-rights-v1",
    priceCents: 150_000,
    currency: "EUR",
    contractRequired: true,
  });
});

test("autorise une demande seulement après livraison sans extension ouverte", () => {
  assert.equal(canRequestCommercialLicense("IN_PROGRESS", []), false);
  assert.equal(canRequestCommercialLicense("DELIVERED", []), true);
  assert.equal(canRequestCommercialLicense("DELIVERED", ["REQUESTED"]), false);
  assert.equal(canRequestCommercialLicense("DELIVERED", ["CONTRACT_PENDING"]), false);
  assert.equal(canRequestCommercialLicense("DELIVERED", ["PAYMENT_PENDING"]), false);
  assert.equal(canRequestCommercialLicense("DELIVERED", ["ACTIVE"]), false);
  assert.equal(canRequestCommercialLicense("DELIVERED", ["REJECTED"]), true);
  assert.equal(canRequestCommercialLicense("DELIVERED", ["CANCELLED"]), true);
});
