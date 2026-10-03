import { requireAdmin } from "@/lib/auth/session";
import { listAdminSupportContributions } from "@/lib/support/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function csv(value: unknown) {
  const raw = String(value ?? "");
  const safe = /^[\s]*[=+@-]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}
export async function GET() {
  await requireAdmin();
  const entries = await listAdminSupportContributions();
  const rows = [["id", "date", "montant_brut_centimes", "devise", "prestataire", "mode", "statut", "reference_prestataire", "reference_paiement", "reference_remboursement"],
    ...entries.map((entry) => [entry.id, entry.createdAt.toISOString(), entry.amountCents, entry.currency, entry.provider, entry.mode, entry.status, entry.providerReference, entry.paymentReference, entry.refundReference])];
  return new Response(`\uFEFF${rows.map((row) => row.map(csv).join(";")).join("\r\n")}`, { headers: {
    "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": 'attachment; filename="lnx-soutiens-200-derniers.csv"',
    "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex", "X-Content-Type-Options": "nosniff",
  } });
}
