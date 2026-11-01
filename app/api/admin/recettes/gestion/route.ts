import { getAuthSession } from "@/lib/auth/session";
import { loadRevenue } from "@/lib/admin/revenue";
import { buildRevenueExchange } from "@/lib/admin/revenue-exchange";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff" };
  const session = await getAuthSession();
  if (!session || session.user.status !== "ACTIVE" || session.user.role !== "ADMIN") return new Response("Accès interdit", { status: 403, headers });
  const params = new URL(request.url).searchParams;
  if (params.has("mode") && params.get("mode") !== "LIVE") return new Response("L’échange Gestion est réservé aux recettes LIVE.", { status: 400, headers });
  try {
    const report = await loadRevenue({ from: params.get("du") || undefined, to: params.get("au") || undefined, mode: "LIVE" });
    const exchange = buildRevenueExchange(report);
    return Response.json(exchange, { headers: {
      ...headers,
      "Content-Disposition": `attachment; filename="LNX-recettes-Gestion-v1-LIVE-${exchange.period.from}-${exchange.period.to}.json"`,
      "X-LNX-Export-Status": exchange.status,
    } });
  } catch {
    return new Response("Échange indisponible : vérifiez la période ou les incohérences signalées dans Recettes.", { status: 400, headers });
  }
}
