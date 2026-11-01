import { collectRevenuePackageDocuments } from "@/lib/admin/revenue-document-collector";
import { buildRevenueDocumentPackage } from "@/lib/admin/revenue-document-package";
import { loadRevenue } from "@/lib/admin/revenue";
import { buildRevenueExchange } from "@/lib/admin/revenue-exchange";
import { isGestionRevenueSyncAuthorized } from "@/lib/admin/revenue-sync-auth";
import { decodeRevenueSyncCursor, revenueSyncWindowStart, sliceRevenueExchange } from "@/lib/admin/revenue-sync-cursor";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "X-Robots-Tag": "noindex, nofollow" };
const day = /^20\d{2}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;

export async function GET(request: Request) {
  if (!isGestionRevenueSyncAuthorized(request)) return new Response("Not found", { status: 404, headers });
  try {
    const url = new URL(request.url), cursor = decodeRevenueSyncCursor(url.searchParams.get("cursor"));
    const from = cursor ? revenueSyncWindowStart(cursor) : url.searchParams.get("from");
    const to = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    if (!from || !day.test(from) || from > to || [...url.searchParams.keys()].some(key => !["cursor", "from"].includes(key))) return new Response("Invalid request", { status: 400, headers });
    const report = await loadRevenue({ from, to, mode: "LIVE" });
    const sliced = sliceRevenueExchange(buildRevenueExchange(report), cursor);
    const collected = await collectRevenuePackageDocuments(sliced.exchange);
    const bundle = buildRevenueDocumentPackage(sliced.exchange, collected.documents, collected.reviewReasons);
    return Response.json({ format: "lnx-gestion-revenue-pull", version: 1, nextCursor: sliced.nextCursor, package: bundle }, { headers });
  } catch {
    return new Response("Sync unavailable", { status: 503, headers });
  }
}
