import "server-only";

import { createMerchantCenterFeedResponse } from "@/lib/merchant/product-feed";
import { listPublicShopProducts } from "@/lib/shop/order-service";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  return createMerchantCenterFeedResponse(await listPublicShopProducts());
}
