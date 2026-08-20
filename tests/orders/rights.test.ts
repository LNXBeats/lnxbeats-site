import assert from "node:assert/strict";
import test from "node:test";

import { canCreateRightsRequest, rightsPriceSnapshot } from "@/lib/rights/domain";

test("fige les deux tarifs de demandes de droits côté serveur", () => {
  assert.equal(rightsPriceSnapshot("PUBLICATION_LICENSE").priceCents, 15_000);
  assert.equal(rightsPriceSnapshot("EXPLOITATION_PARTNERSHIP").priceCents, 150_000);
  assert.equal(rightsPriceSnapshot("EXPLOITATION_PARTNERSHIP").currency, "EUR");
});

test("autorise une demande seulement après livraison publiée sans demande active", () => {
  assert.equal(canCreateRightsRequest({ orderStatus: "IN_PROGRESS", hasPublishedDelivery: true, existingStatuses: [] }), false);
  assert.equal(canCreateRightsRequest({ orderStatus: "DELIVERED", hasPublishedDelivery: false, existingStatuses: [] }), false);
  assert.equal(canCreateRightsRequest({ orderStatus: "DELIVERED", hasPublishedDelivery: true, existingStatuses: [] }), true);
  assert.equal(canCreateRightsRequest({ orderStatus: "DELIVERED", hasPublishedDelivery: true, existingStatuses: ["SUBMITTED"] }), false);
  assert.equal(canCreateRightsRequest({ orderStatus: "DELIVERED", hasPublishedDelivery: true, existingStatuses: ["ACTIVE"] }), false);
  assert.equal(canCreateRightsRequest({ orderStatus: "DELIVERED", hasPublishedDelivery: true, existingStatuses: ["REJECTED"] }), true);
});
