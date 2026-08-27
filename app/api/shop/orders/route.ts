import { NextResponse } from "next/server";

import { handleCreateShopOrder } from "@/lib/shop/order-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const result = await handleCreateShopOrder(request);
  return NextResponse.json(result.body, {
    status: result.status,
    headers: { "Cache-Control": "no-store" },
  });
}
