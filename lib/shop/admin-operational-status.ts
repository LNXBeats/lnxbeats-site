import "server-only";

import { shopAfterSalesQaEnabled, shopAfterSalesRefundProvider } from "@/lib/shop/after-sales-config";
import { parseShopConfiguration } from "@/lib/shop/config";
import { parseShopPaymentConfiguration } from "@/lib/shop/payment-config";
import { parseShopShippingConfiguration } from "@/lib/shop/shipping-config";
import { shopShippingOperationsQaEnabled } from "@/lib/shop/shipping-operations-config";

type Environment = NodeJS.ProcessEnv;

export type ShopAdminOperationalStatus = Readonly<{
  shop: "OPEN" | "CLOSED" | "BLOCKED";
  payments: "ACTIVE" | "INACTIVE" | "BLOCKED";
  shipping: "ACTIVE" | "INACTIVE" | "BLOCKED";
  afterSales: "ACTIVE" | "INACTIVE" | "BLOCKED";
  tracking: "MANUAL" | "INACTIVE" | "BLOCKED";
  carrierApi: "DISABLED" | "ACTIVE" | "BLOCKED";
}>;

export function getShopAdminOperationalStatus(environment: Environment = process.env): ShopAdminOperationalStatus {
  let shop: ShopAdminOperationalStatus["shop"] = "BLOCKED";
  let payments: ShopAdminOperationalStatus["payments"] = "BLOCKED";
  let shipping: ShopAdminOperationalStatus["shipping"] = "BLOCKED";
  try { shop = parseShopConfiguration(environment).enabled ? "OPEN" : "CLOSED"; } catch { /* fail closed in the Admin view */ }
  try { payments = parseShopPaymentConfiguration(environment).enabled ? "ACTIVE" : "INACTIVE"; } catch { /* fail closed */ }
  try { shipping = parseShopShippingConfiguration(environment).enabled ? "ACTIVE" : "INACTIVE"; } catch { /* fail closed */ }

  let afterSales: ShopAdminOperationalStatus["afterSales"] = "BLOCKED";
  try {
    const requested = environment.SHOP_AFTER_SALES_ENABLED === "true";
    const provider = shopAfterSalesRefundProvider(environment);
    afterSales = !requested ? "INACTIVE" : shopAfterSalesQaEnabled(environment) && provider === "payments" ? "ACTIVE"
      : provider === "blocked" ? "BLOCKED" : "INACTIVE";
  } catch { /* fail closed */ }

  let tracking: ShopAdminOperationalStatus["tracking"] = "BLOCKED";
  try {
    tracking = shopShippingOperationsQaEnabled(environment)
      ? environment.SHOP_SHIPPING_OPERATIONS_PROVIDER === "manual" ? "MANUAL" : "BLOCKED"
      : environment.SHOP_SHIPPING_OPERATIONS_ENABLED === "true" ? "BLOCKED" : "INACTIVE";
  } catch { /* fail closed */ }

  const carrierApi = environment.SHOP_SHIPPING_PROVIDER_ENABLED === "false" || !environment.SHOP_SHIPPING_PROVIDER_ENABLED
    ? "DISABLED"
    : environment.SHOP_SHIPPING_PROVIDER_ENABLED === "true" ? "ACTIVE" : "BLOCKED";
  return { shop, payments, shipping, afterSales, tracking, carrierApi };
}

export const shopAdminOperationalLabel = {
  OPEN: "OUVERTE", CLOSED: "FERMÉE", ACTIVE: "ACTIFS", INACTIVE: "INACTIFS",
  BLOCKED: "À VÉRIFIER", MANUAL: "MANUEL", DISABLED: "DÉSACTIVÉE",
} as const;
