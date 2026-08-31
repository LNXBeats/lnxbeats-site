import type { ShippingProviderScenario } from "@/lib/shop/shipping-provider";

const SHOP_ORDER_NUMBER = /^LNX-SHOP-[0-9]{4}-[0-9]{6,}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const SHOP_SHIPPING_PROVIDER_CONFIRMATIONS = Object.freeze({
  create: "CONFIRM_FAKE_SHIPPING_PROVIDER_QA",
  reconcile: "CONFIRM_FAKE_SHIPPING_PROVIDER_RECONCILIATION_QA",
});

export class ShopShippingProviderInputError extends Error {
  constructor(message = "Le formulaire provider transporteur QA est invalide.") {
    super(message);
    this.name = "ShopShippingProviderInputError";
  }
}

function exactFormValues(formData: FormData, allowed: readonly string[]) {
  const allowedSet = new Set(allowed);
  const values = new Map<string, string>();
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("$ACTION_")) {
      if (typeof value !== "string") throw new ShopShippingProviderInputError();
      continue;
    }
    if (!allowedSet.has(key) || typeof value !== "string" || values.has(key)) {
      throw new ShopShippingProviderInputError();
    }
    values.set(key, value);
  }
  if (values.size !== allowed.length || allowed.some((key) => !values.has(key))) {
    throw new ShopShippingProviderInputError();
  }
  return values;
}

function orderNumber(value: string | undefined) {
  if (!value || !SHOP_ORDER_NUMBER.test(value)) throw new ShopShippingProviderInputError();
  return value;
}

export function parseShopShippingProviderCreateForm(formData: FormData) {
  const values = exactFormValues(formData, ["orderNumber", "scenario", "confirmation"]);
  if (values.get("confirmation") !== SHOP_SHIPPING_PROVIDER_CONFIRMATIONS.create) {
    throw new ShopShippingProviderInputError("La confirmation du provider fictif QA est requise.");
  }
  const scenario = values.get("scenario");
  if (!scenario || !["SUCCEEDED", "PENDING", "FAILED", "AMBIGUOUS"].includes(scenario)) {
    throw new ShopShippingProviderInputError("Le scénario provider fictif est invalide.");
  }
  return Object.freeze({
    orderNumber: orderNumber(values.get("orderNumber")),
    scenario: scenario as ShippingProviderScenario,
  });
}

export function parseShopShippingProviderReconcileForm(formData: FormData) {
  const values = exactFormValues(formData, ["orderNumber", "attemptId", "confirmation"]);
  if (values.get("confirmation") !== SHOP_SHIPPING_PROVIDER_CONFIRMATIONS.reconcile) {
    throw new ShopShippingProviderInputError("La confirmation de réconciliation fictive QA est requise.");
  }
  const attemptId = values.get("attemptId");
  if (!attemptId || !UUID.test(attemptId)) throw new ShopShippingProviderInputError();
  return Object.freeze({
    orderNumber: orderNumber(values.get("orderNumber")),
    attemptId,
  });
}
