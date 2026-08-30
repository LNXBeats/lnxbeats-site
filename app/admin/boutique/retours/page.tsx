import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminBackLink } from "@/components/admin-back-link";
import { requireAdmin } from "@/lib/auth/session";
import { shopAfterSalesQaEnabled } from "@/lib/shop/after-sales-config";
import { listAdminShopReturns } from "@/lib/shop/after-sales-service";
import { formatShopMoney } from "@/lib/shop/order-presentation";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Retours Boutique · Administration" };

const DATE = new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Paris" });

export default async function AdminShopReturnsPage({ searchParams }: { searchParams: Promise<{ etat?: string }> }) {
  await requireAdmin();
  if (!shopAfterSalesQaEnabled()) notFound();
  const requests = await listAdminShopReturns();
  const state = (await searchParams).etat;
  return <div className="admin-main">
    <AdminBackLink href="/admin/boutique">Retour à la Boutique</AdminBackLink>
    <header className="admin-page-heading"><div><p className="admin-kicker">Boutique · SAV</p><h1>Retours sous contrôle.</h1></div><p>Chaque décision est explicite : autorisation, réception, inspection, remboursement, avoir et restock restent des événements distincts.</p></header>
    {state ? <p className="admin-alert" role="alert">{state === "confirmation-requise" ? "La confirmation explicite est requise." : "L’opération a été refusée sans mutation."}</p> : null}
    <section className="admin-list-window" aria-labelledby="shop-returns-title"><div className="admin-list-window__heading"><h2 id="shop-returns-title">Dossiers SAV</h2><span>{requests.length} résultat{requests.length === 1 ? "" : "s"}</span></div>
      {requests.length ? <ul className="admin-order-list">{requests.map((request) => <li key={request.id}><Link href={`/admin/boutique/retours/${encodeURIComponent(request.requestNumber)}`}>
        <span className="admin-order-list__identity"><small>{DATE.format(request.requestedAt)}</small><strong>{request.requestNumber}</strong><em>{request.shopOrder.orderNumber}</em></span>
        <span className="admin-order-list__facts"><span>{request.status}</span><small>{request.type}</small><b>{request.shopOrder.user.displayName || request.shopOrder.user.email}</b></span>
        <span className="admin-order-list__next"><strong>{request.totalRefundCents ? formatShopMoney(request.totalRefundCents) : "À déterminer"}</strong><small>{request.items.length} ligne{request.items.length === 1 ? "" : "s"}</small></span><span className="admin-order-list__arrow" aria-hidden="true">→</span>
      </Link></li>)}</ul> : <div className="admin-empty"><h2>Aucun dossier SAV.</h2><p>Les demandes membres apparaîtront ici après enregistrement.</p></div>}
    </section>
  </div>;
}
