import type { Metadata } from "next";
import Link from "next/link";

import { ChangePasswordForm } from "@/components/auth/change-password-form";
import { LogoutButton } from "@/components/auth/logout-button";
import { ProfileForm } from "@/components/auth/profile-form";
import { Container } from "@/components/container";
import { requireVerifiedUser } from "@/lib/auth/session";
import { formatEuro, type OrderActor } from "@/lib/orders/domain";
import { listMemberOrders } from "@/lib/orders/service";
import { completedOrderStatuses, orderStatusPresentation } from "@/lib/orders/status";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Mon espace",
  description: "Profil, sécurité et suivi des demandes LNX Beats.",
  robots: { index: false, follow: false },
};

const roleLabels = { ADMIN: "Administrateur", CUSTOMER: "Client", MEMBER: "Membre" } as const;
const statusLabels = { ACTIVE: "Actif", DEACTIVATED: "Désactivé", PENDING: "En attente", SUSPENDED: "Suspendu" } as const;

export default async function AccountPage() {
  const session = await requireVerifiedUser("/compte");
  const actor: OrderActor = {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
    status: "ACTIVE",
    emailVerified: true,
  };
  const orders = await listMemberOrders(actor);
  const drafts = orders.filter((order) => order.status === "DRAFT");
  const completed = orders.filter((order) => completedOrderStatuses.has(order.status));
  const active = orders.filter((order) => order.status !== "DRAFT" && !completedOrderStatuses.has(order.status));

  return (
    <section className="auth-shell">
      <Container className="auth-shell__inner auth-shell__inner--account">
        <div className="auth-intro">
          <p className="eyebrow">Votre espace</p>
          <h1>Bonjour, {session.user.name}.</h1>
          <p>Votre profil, la sécurité de votre accès et vos demandes réelles sont réunis ici. Aucun paiement n’est encore disponible.</p>
        </div>
        <div className="auth-account-stack">
          <dl className="auth-profile">
            <div><dt>Email</dt><dd>{session.user.email}</dd></div>
            <div><dt>Vérification</dt><dd>Adresse confirmée</dd></div>
            <div><dt>Type de compte</dt><dd>{roleLabels[session.user.role]}</dd></div>
            <div><dt>Accès</dt><dd>{statusLabels[session.user.status]}</dd></div>
            <div className="auth-profile__action"><dt>Session</dt><dd><LogoutButton /></dd></div>
          </dl>

          <section className="member-orders" aria-labelledby="member-orders-title">
            <div className="member-orders__heading">
              <div>
                <p className="auth-panel__label">Mes commandes</p>
                <h2 id="member-orders-title">Vos histoires, sans tableau de bord inutile.</h2>
              </div>
              <Link className="button button--quiet" href="/commander">Préparer une histoire</Link>
            </div>
            {!orders.length ? (
              <div className="member-orders__empty">
                <p>Aucun brouillon ni aucune demande pour le moment.</p>
                <Link className="text-link" href="/commander">Commencer un brief <span aria-hidden="true">→</span></Link>
              </div>
            ) : (
              <div className="member-order-groups">
                <OrderGroup title="Brouillons" orders={drafts} draft />
                <OrderGroup title="Demandes actives" orders={active} />
                <OrderGroup title="Terminées ou arrêtées" orders={completed} />
              </div>
            )}
          </section>

          <section className="account-outlook" aria-labelledby="account-outlook-title">
            <p className="auth-panel__label">À venir séparément</p>
            <h2 id="account-outlook-title">Des fonctions annoncées seulement lorsqu’elles seront actives.</h2>
            <ul>
              <li><strong>Livraisons WAV</strong><span>Prévu — aucun téléchargement actif</span></li>
              <li><strong>Favoris et alertes de sortie</strong><span>À venir — aucun opt-in automatique</span></li>
              <li><strong>Newsletter et lives TikTok</strong><span>À évaluer avec des consentements distincts</span></li>
            </ul>
          </section>
          <section className="auth-panel" aria-labelledby="profile-title">
            <h2 className="auth-panel__label" id="profile-title">Profil</h2>
            <ProfileForm initialName={session.user.name} />
          </section>
          <section className="auth-panel" aria-labelledby="security-title">
            <h2 className="auth-panel__label" id="security-title">Sécurité</h2>
            <ChangePasswordForm />
          </section>
        </div>
      </Container>
    </section>
  );
}
function OrderGroup({ title, orders, draft = false }: { title: string; orders: Awaited<ReturnType<typeof listMemberOrders>>; draft?: boolean }) {
  if (!orders.length) return null;
  return (
    <section>
      <h3>{title}</h3>
      <ul className="member-order-list">
        {orders.map((order) => {
          const presentation = orderStatusPresentation[order.status];
          const href = draft ? `/commander?brouillon=${encodeURIComponent(order.orderNumber)}` : `/compte/commandes/${encodeURIComponent(order.orderNumber)}`;
          return (
            <li key={order.orderNumber}>
              <Link href={href}>
                <span><strong>{order.title || order.recipient || "Histoire sans titre"}</strong><small>{order.orderNumber} · {new Date(order.createdAt).toLocaleDateString("fr-FR")}</small></span>
                <span><em>{presentation.label}</em><strong>{formatEuro(order.totalCents)}</strong></span>
              </Link>
              <p>{presentation.next}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
