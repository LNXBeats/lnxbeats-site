import "server-only";

import { isStrictShopProductionEnvironment } from "@/lib/shop/production-environment";
import { shopProductionReadinessQaEnabled } from "@/lib/shop/production-readiness-config";
import { evaluateLiveRefundProductionPolicy } from "@/lib/payments/live-refund-policy";

export const SHOP_MAINTENANCE_PRODUCTION_CONFIRMATION = "enable-production-shop-maintenance";

export function shopMaintenanceEnabled(environment: NodeJS.ProcessEnv = process.env) {
  if (shopProductionReadinessQaEnabled(environment)) return true;
  const liveRefunds = evaluateLiveRefundProductionPolicy(environment);
  return isStrictShopProductionEnvironment(environment)
    && environment.SHOP_MAINTENANCE_ENABLED === "true"
    && environment.SHOP_MAINTENANCE_CONFIRM === SHOP_MAINTENANCE_PRODUCTION_CONFIRMATION
    && environment.SHOP_AFTER_SALES_ENABLED === "true"
    && liveRefunds.state !== "BLOCKED";
}

export function assertShopMaintenanceEnabled(environment: NodeJS.ProcessEnv = process.env) {
  if (!shopMaintenanceEnabled(environment)) throw new Error("SHOP_MAINTENANCE_DISABLED");
}
