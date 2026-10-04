import { prisma } from "@/lib/prisma";
import { supportAccountingHeader, supportAccountingRows, supportCsvCell } from "@/lib/support/accounting";
/** Internal, caller must authorize Admin first. */
export function createSupportExport(mode: string | null) {
  if (mode !== "TEST" && mode !== "LIVE") return new Response("Mode TEST ou LIVE requis", { status: 400 });
  // Stable cutoff, keyset pages, bounded memory, cancel-aware stream. No 200-row truncation.
  const cutoff = new Date(); let cursor: string | undefined; let header = false; let cancelled = false;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (cancelled) return;
      if (!header) { controller.enqueue(encoder.encode("\uFEFF" + supportAccountingHeader.map(supportCsvCell).join(";") + "\r\n")); header = true; return; }
      try {
        const entries = await prisma.supportContribution.findMany({ where: { mode, createdAt: { lte: cutoff } },
          ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}), orderBy: { id: "asc" }, take: 100,
          select: { id: true, createdAt: true, amountCents: true, currency: true, provider: true, mode: true, status: true,
            providerReference: true, paymentReference: true, refundReference: true,
            attempts: { select: { id: true, operation: true, status: true, lastCheckedAt: true }, orderBy: { createdAt: "asc" } } } });
        if (cancelled) return;
        if (!entries.length) { controller.close(); return; }
        cursor = entries.at(-1)!.id;
        controller.enqueue(encoder.encode(entries.flatMap(supportAccountingRows).map(r => r.map(supportCsvCell).join(";")).join("\r\n") + "\r\n"));
      } catch { controller.error(new Error("Export interrompu ; ne pas utiliser un fichier incomplet.")); }
    }, cancel() { cancelled = true; },
  });
  return new Response(stream, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="lnx-soutiens-${mode}.csv"`,
    "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex", "X-Content-Type-Options": "nosniff" } });
}
