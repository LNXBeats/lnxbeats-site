import "server-only";
import { prisma } from "@/lib/prisma";

/** Read the existing immutable digital register; never issue a second invoice. */
export async function listAdminDigitalInvoices(search?: string) {
  const value = search?.trim().slice(0, 120);
  const docs = await prisma.digitalDocument.findMany({
    where: { kind: { in: ["INVOICE", "CREDIT_NOTE"] }, ...(value ? { OR: [
      { number: { contains: value, mode: "insensitive" } },
      { order: { lines: { some: { title: { contains: value, mode: "insensitive" } } } } },
      { snapshot: { path: ["customerSnapshot", "name"], string_contains: value, mode: "insensitive" } },
      { snapshot: { path: ["customerSnapshot", "email"], string_contains: value, mode: "insensitive" } },
    ] } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 201,
    select: { id: true, kind: true, number: true, status: true, createdAt: true, snapshot: true,
      order: { select: { id: true, mode: true, lines: { select: { title: true } } } } },
  });
  return { limited: docs.length > 200, rows: docs.slice(0, 200).map(d => {
    const s = (d.snapshot && typeof d.snapshot === "object" && !Array.isArray(d.snapshot) ? d.snapshot : {}) as { totalCents?: number; amountCents?: number; customerSnapshot?: { name?: string }; invoice?: { customerSnapshot?: { name?: string } } };
    return { id: d.id, kind: d.kind, number: d.number, status: d.status, createdAt: d.createdAt, orderId: d.order.id, mode: d.order.mode,
      title: d.order.lines.map(l => l.title).join(" · "), customer: s.customerSnapshot?.name ?? s.invoice?.customerSnapshot?.name ?? "Client non documenté",
      amountCents: d.kind === "INVOICE" ? s.totalCents : s.amountCents };
  }) };
}
