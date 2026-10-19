import { getAuthSession } from "@/lib/auth/session";
import { loadRevenue } from "@/lib/admin/revenue";
import { revenueCsv } from "@/lib/admin/revenue-policy";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const session = await getAuthSession();
  const headers = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff" };
  if (!session || session.user.status !== "ACTIVE" || session.user.role !== "ADMIN") return new Response("Accès interdit", { status: 403, headers });
  const params = new URL(request.url).searchParams, mode = params.get("mode") ?? "LIVE";
  if (!["LIVE", "TEST"].includes(mode)) return new Response("Mode invalide", { status: 400, headers });
  try {
    const report = await loadRevenue({ from: params.get("du") || undefined, to: params.get("au") || undefined, mode: mode as "LIVE" | "TEST" });
    if (report.issues.length) return new Response("Export suspendu : rapprochez les anomalies signalées dans Recettes avant de produire un détail comptable.", { status: 409, headers });
    return new Response(revenueCsv(report.rows), { headers: { ...headers, "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="LNX-recettes-rapprochees-${mode}-${report.period.from}-${report.period.to}.csv"`, "X-LNX-Unmatched-Receipts": String(report.unmatchedReceipts) } });
  } catch { return new Response("Export indisponible : vérifiez la période ou le rapprochement.", { status: 400, headers }); }
}
