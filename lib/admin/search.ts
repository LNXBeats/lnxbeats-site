import "server-only";

import { assertDatabaseConfigured, prisma } from "@/lib/prisma";

export function normalizeAdminSearchQuery(value: string | undefined) {
  const query = (value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 120);
  return query.length >= 2 ? query : "";
}

export async function searchAdminRecords(query: string) {
  assertDatabaseConfigured();
  if (!query) return [];
  const text = { contains: query, mode: "insensitive" as const };
  const [orders, shopOrders, creations, projects, members, invoices, creditNotes] = await Promise.all([
    prisma.order.findMany({ where: { OR: [{ orderNumber: text }, { title: text }, { customerName: text }, { customerEmail: text }] }, select: { id: true, orderNumber: true, title: true, status: true }, orderBy: { updatedAt: "desc" }, take: 6 }),
    prisma.shopOrder.findMany({ where: { OR: [{ orderNumber: text }, { user: { is: { OR: [{ email: text }, { displayName: text }] } } }] }, select: { id: true, orderNumber: true, status: true, paymentStatus: true }, orderBy: { updatedAt: "desc" }, take: 6 }),
    prisma.creation.findMany({ where: { OR: [{ title: text }, { slug: text }, { collaborator: text }] }, select: { id: true, title: true, slug: true, status: true }, orderBy: { updatedAt: "desc" }, take: 6 }),
    prisma.project.findMany({ where: { OR: [{ title: text }, { slug: text }] }, select: { id: true, title: true, slug: true, status: true }, orderBy: { updatedAt: "desc" }, take: 6 }),
    prisma.user.findMany({ where: { OR: [{ displayName: text }, { email: text }] }, select: { id: true, displayName: true, email: true, status: true }, orderBy: { createdAt: "desc" }, take: 6 }),
    prisma.invoice.findMany({ where: { OR: [{ invoiceNumber: text }, { orderNumberSnapshot: text }, { customerNameSearch: text }, { customerEmailSearch: text }] }, select: { id: true, invoiceNumber: true, orderNumberSnapshot: true }, orderBy: { issuedAt: "desc" }, take: 6 }),
    prisma.creditNote.findMany({ where: { creditNoteNumber: text }, select: { id: true, creditNoteNumber: true }, orderBy: { issuedAt: "desc" }, take: 6 }),
  ]);
  return [
    ...orders.map((row) => ({ key: `order:${row.id}`, type: "Commande musicale", title: row.orderNumber, detail: row.title || row.status, href: `/admin/commandes/${encodeURIComponent(row.orderNumber)}` })),
    ...shopOrders.map((row) => ({ key: `shop:${row.id}`, type: "Commande Boutique", title: row.orderNumber, detail: `${row.status} · ${row.paymentStatus}`, href: `/admin/boutique/commandes/${encodeURIComponent(row.orderNumber)}` })),
    ...creations.map((row) => ({ key: `creation:${row.id}`, type: "Création", title: row.title, detail: row.status, href: `/admin/creations/${encodeURIComponent(row.slug)}` })),
    ...projects.map((row) => ({ key: `project:${row.id}`, type: "Projet Discographie", title: row.title, detail: row.status, href: `/admin/catalogue/${encodeURIComponent(row.slug)}` })),
    ...members.map((row) => ({ key: `member:${row.id}`, type: "Membre", title: row.displayName || row.email, detail: row.status, href: `/admin/membres?q=${encodeURIComponent(row.email)}` })),
    ...invoices.map((row) => ({ key: `invoice:${row.id}`, type: "Facture", title: row.invoiceNumber, detail: row.orderNumberSnapshot, href: `/admin/facturation/${encodeURIComponent(row.invoiceNumber)}` })),
    ...creditNotes.map((row) => ({ key: `credit:${row.id}`, type: "Avoir", title: row.creditNoteNumber, detail: "Document comptable", href: `/admin/facturation/avoirs/${encodeURIComponent(row.creditNoteNumber)}` })),
  ];
}
