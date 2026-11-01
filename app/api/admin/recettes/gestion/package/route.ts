import { getAuthSession } from "@/lib/auth/session";
import { collectRevenuePackageDocuments } from "@/lib/admin/revenue-document-collector";
import { buildRevenueDocumentPackage } from "@/lib/admin/revenue-document-package";
import { loadRevenue } from "@/lib/admin/revenue";
import { buildRevenueExchange } from "@/lib/admin/revenue-exchange";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const privateHeaders = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff" };

export async function GET(request: Request) {
  const session = await getAuthSession();
  if (!session || session.user.status !== "ACTIVE" || session.user.role !== "ADMIN") return new Response("Accès interdit", { status: 403, headers: privateHeaders });
  const params = new URL(request.url).searchParams;
  if (params.has("mode") && params.get("mode") !== "LIVE") return new Response("Le paquet Gestion est réservé aux recettes LIVE.", { status: 400, headers: privateHeaders });
  try {
    const report = await loadRevenue({ from: params.get("du") || undefined, to: params.get("au") || undefined, mode: "LIVE" });
    const exchange = buildRevenueExchange(report);
    const collected = await collectRevenuePackageDocuments(exchange);
    const bundle = buildRevenueDocumentPackage(exchange, collected.documents, collected.reviewReasons);
    return Response.json(bundle, { headers: { ...privateHeaders,
      "Content-Disposition": `attachment; filename="LNX-recettes-documents-Gestion-v1-LIVE-${exchange.period.from}-${exchange.period.to}.json"`,
      "X-LNX-Export-Status": exchange.status } });
  } catch {
    return new Response("Paquet indisponible : réduisez la période ou vérifiez les incohérences signalées.", { status: 400, headers: privateHeaders });
  }
}
