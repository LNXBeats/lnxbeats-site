import { NextResponse } from "next/server";

import { handleShopShippingQuote } from "@/lib/shop/shipping-quote-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const result = await handleShopShippingQuote(request);
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  });
}
