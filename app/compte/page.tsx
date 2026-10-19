import { getSiteLocale, serverDate, serverMoney } from "@/lib/i18n/server";
import { OriginalName } from "@/components/original-name";
import { T } from "@/components/site-language";
import type { Metadata } from "next";
import Link from "next/link";

import { ChangePasswordForm } from "@/components/auth/change-password-form";
import { LogoutButton } from "@/components/auth/logout-button";
import { ProfileForm } from "@/components/auth/profile-form";
import { Container } from "@/components/container";
import { orderIllustrationFormatLabel } from "@/data/order-illustration";
import { requireVerifiedUser } from "@/lib/auth/session";
import { qaAccessAvailable } from "@/lib/auth/qa-access";
import { listMemberInvoices } from "@/lib/billing/service";
import { runSequentialDatabaseQueries } from "@/lib/database/sequential-queries";
import { listMemberWithdrawalRequests } from "@/lib/legal/withdrawal";
import { clientOrderAction, clientPaymentPresentation } from "@/lib/orders/checkout";
import { type OrderActor } from "@/lib/orders/domain";
import { listMemberOrders } from "@/lib/orders/service";
import { completedOrderStatuses, orderStatusPresentation } from "@/lib/orders/status";
import { rightsStatusPresentation } from "@/lib/rights/domain";
import { listRightsRequestsForActor } from "@/lib/rights/service";
import { effectiveShopOrderStatus, shopFulfillmentLabel } from "@/lib/shop/order-presentation";
import { listMemberShopOrders } from "@/lib/shop/order-service";
import { digitalEnabled } from "@/lib/digital/domain";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Mon espace",
  description: "Profil, sécurité et suivi des demandes LNX Beats.",
  robots: { index: false, follow: false },
};

const roleLabels = { ADMIN: "Administrateur", CUSTOMER: "Client", MEMBER: "Membre" } as const;
const statusLabels = { ACTIVE: "Actif", DEACTIVATED: "Désactivé", PENDING: "En attente", SUSPENDED: "Suspendu" } as const;

export default async function AccountPage() {
  const locale = await getSiteLocale();
  const session = await requireVerifiedUser("/compte");
  const qaProfileSwitchAvailable = qaAccessAvailable();
  const actor: OrderActor = {
    id: session.user.id,
    email: session.user.email,
    name: session.user.name,
    role: session.user.role,
    status: "ACTIVE",
    emailVerified: true,
  };
  const [orders, rightsRequests, shopOrders, withdrawalRequests, invoices] = await runSequentialDatabaseQueries(
    () => listMemberOrders(actor),
    () => listRightsRequestsForActor(actor),
    () => listMemberShopOrders(session.user.id),
    () => listMemberWithdrawalRequests(session.user.id),
    () => listMemberInvoices(session.user.id),
  );
  const drafts = orders.filter((order) => order.status === "DRAFT");
  const awaitingPayment = orders.filter((order) => order.status === "AWAITING_PAYMENT");
  const completed = orders.filter((order) => completedOrderStatuses.has(order.status));
  const active = orders.filter((order) => !["DRAFT", "AWAITING_PAYMENT"].includes(order.status) && !completedOrderStatuses.has(order.status));

  return (
    <section className="auth-shell account-shell account-overview-page">
      <Container className="auth-shell__inner auth-shell__inner--account">
        <div className="auth-intro">
          <p className="eyebrow"><T text="Votre espace" /></p>
          <h1><T text="Bonjour," />{" "}{<OriginalName>{session.user.name}</OriginalName>}.</h1>
          <div className="account-intro__summary">
            <p><T text="Retrouvez vos créations et ce qui demande votre attention." /></p>
            {session.user.role === "ADMIN" || qaProfileSwitchAvailable ? (
              <div className="account-intro__actions">
                {session.user.role === "ADMIN" ? <Link className="account-admin-link" href="/admin"><T text="Ouvrir l’administration" />{" "}<span aria-hidden="true">→</span></Link> : null}
                {qaProfileSwitchAvailable ? <Link className="account-admin-link" href="/qa/access"><T text="Changer de profil QA" />{" "}<span aria-hidden="true">→</span></Link> : null}
              </div>
            ) : null}
          </div>
        </div>
        <div className="auth-account-stack">
          {digitalEnabled() ? <section className="member-orders"><h2><T text="Ma musique." /></h2><p><T text="Vos albums et titres numériques, distincts des commandes Boutique et des créations sur mesure." /></p><Link className="button button--quiet" href="/compte/musique"><T text="Ouvrir ma bibliothèque" /></Link></section> : null}
          <section className="member-orders" aria-labelledby="member-orders-title">
            <div className="member-orders__heading">
              <div>
                <p className="auth-panel__label"><T text="Mes commandes" /></p>
                <h2 id="member-orders-title"><T text="Vos créations." /></h2>
              </div>
              <Link className="button button--quiet" href="/commander"><T text="Préparer une histoire" /></Link>
            </div>
            {!orders.length ? (
              <div className="member-orders__empty">
                <p><strong><T text="Aucune création en cours." /></strong><br /><T text="Une histoire en tête ?" /></p>
                <Link className="text-link" href="/commander"><T text="Préparer une création" />{" "}<span aria-hidden="true">→</span></Link>
              </div>
            ) : (
              <div className="member-order-groups">
                <OrderGroup locale={locale} title="Paiement et confirmation" orders={awaitingPayment} />
                <OrderGroup locale={locale} title="Demandes actives" orders={active} />
                <OrderGroup locale={locale} title="Brouillons" orders={drafts} draft />
                <OrderGroup locale={locale} title="Terminées ou arrêtées" orders={completed} />
              </div>
            )}
          </section>

          <section className="member-orders" aria-labelledby="member-shop-orders-title">
            <div className="member-orders__heading">
              <div>
                <p className="auth-panel__label"><T text="Mes achats Boutique" /></p>
                <h2 id="member-shop-orders-title"><T text="Vos commandes Boutique." /></h2>
              </div>
              <Link className="button button--quiet" href="/boutique"><T text="Ouvrir la Boutique" /></Link>
            </div>
            {!shopOrders.length ? (
              <div className="member-orders__empty">
                <p><strong><T text="Aucun achat Boutique préparé." /></strong><br /><T text="Les commandes Boutique restent séparées de vos créations musicales." /></p>
              </div>
            ) : (
              <ul className="member-order-list">
                {shopOrders.map((order) => {
                  const effectiveStatus = effectiveShopOrderStatus(order);
                  return <li key={order.orderNumber}>
                    <Link href={`/compte/achats/${encodeURIComponent(order.orderNumber)}`}>
                      <span>
                        <strong>{order.items.map(({ productTitle }) => productTitle).join(" · ")}</strong>
                        <small><span className="technical-reference technical-reference--inline">{order.orderNumber}</span> · {serverDate(locale, new Date(order.createdAt), {dateStyle:"short"})}</small>
                      </span>
                      <span>
                        <em>{order.paymentReviewAt ? <T text="Paiement à vérifier" /> : order.paymentStatus === "PAID" ? shopFulfillmentLabel(order.fulfillmentStatus) : effectiveStatus === "OPEN" ? <T text="Prête pour paiement" /> : effectiveStatus === "EXPIRED" ? <T text="Réservation expirée" /> : <T text="Annulée" />}</em>
                        <small>{order.paymentReviewAt ? <T text="Revue humaine requise" /> : order.paymentStatus === "PAID" ? <T text="Paiement confirmé" /> : order.paymentStatus === "CANCELLED" ? <T text="Paiement annulé" /> : <T text="Paiement en attente" />}</small>
                        <strong>{serverMoney(locale,order.totalCents)}</strong>
                      </span>
                    </Link>
                    <p><T text={order.items.length === 1 ? "{count} produit" : "{count} produits"} values={{count:order.items.length}} /><T text=". Réservation jusqu’au" />{" "}{serverDate(locale, new Date(order.reservationExpiresAt), {dateStyle:"short",timeStyle:"short"})}.</p>
                  </li>
                })}
              </ul>
            )}
          </section>

          <section className="member-orders" aria-labelledby="account-invoices-title">
            <div className="member-orders__heading"><div><p className="auth-panel__label"><T text="Factures et avoirs" /></p><h2 id="account-invoices-title"><T text="Vos documents." /></h2></div></div>
            {!invoices.length ? <div className="member-orders__empty"><p><strong><T text="Aucun document émis." /></strong><br /><T text="Une facture apparaît après confirmation serveur d’un paiement." /></p></div> : (
              <ul className="member-order-list">{invoices.map((invoice) => <li key={invoice.id}>
                <Link href={`/compte/factures/${encodeURIComponent(invoice.invoiceNumber)}`}><span><strong className="technical-reference technical-reference--list">{invoice.invoiceNumber}</strong><small><span className="technical-reference technical-reference--inline">{invoice.orderNumberSnapshot}</span> · {serverDate(locale, new Date(invoice.issuedAt), {dateStyle:"short"})}</small></span><span><em>{invoice.documentType === "SHOP" ? <T text="Boutique" /> : <T text="Création musicale" />}</em><small>{invoice.creditNotes.length ? <T text={invoice.creditNotes.length === 1 ? "{count} avoir" : "{count} avoirs"} values={{count:invoice.creditNotes.length}} /> : <T text="Aucun avoir" />}</small><strong>{serverMoney(locale,invoice.totalCents)}</strong></span></Link>
                {invoice.creditNotes.map((creditNote) => <p key={creditNote.id}><Link className="text-link" href={`/compte/avoirs/${encodeURIComponent(creditNote.creditNoteNumber)}`}><T text="Avoir" />{" "}{creditNote.creditNoteNumber} · {serverMoney(locale,creditNote.amountCents)} <span aria-hidden="true">→</span></Link></p>)}
              </li>)}</ul>
            )}
          </section>

          <section className="member-orders rights-account" aria-labelledby="account-rights-title">
            <div className="member-orders__heading"><div><p className="auth-panel__label"><T text="Droits et autorisations" /></p><h2 id="account-rights-title"><T text="Vos demandes contractuelles." /></h2></div></div>
            {!rightsRequests.length ? <div className="member-orders__empty"><p><strong><T text="Aucune demande de droits." /></strong><br /><T text="Les options apparaissent après la livraison d’une création." /></p></div> : <ul className="member-order-list">{rightsRequests.map((request) => { const presentation = rightsStatusPresentation[request.status]; return <li key={request.requestNumber}><Link href={`/compte/droits/${request.requestNumber}`}><span><strong>{request.type === "PUBLICATION_LICENSE" ? <T text="Licence de publication" /> : <T text="Partenariat d’exploitation" />}</strong><small>{request.requestNumber} · {request.orderNumber}</small></span><span><em>{<T text={presentation.label} />}</em><small>{<T text={presentation.action} />}</small><strong>{serverMoney(locale,request.requestedPriceCents)}</strong></span></Link><p><strong><T text="Création :" /></strong> {<OriginalName>{request.workTitle}</OriginalName>}. <strong><T text="Paiement :" /></strong> <T text="non disponible dans cette version." /></p></li>; })}</ul>}
          </section>

          <section className="member-orders" aria-labelledby="account-withdrawals-title">
            <div className="member-orders__heading">
              <div>
                <p className="auth-panel__label"><T text="Rétractation" /></p>
                <h2 id="account-withdrawals-title"><T text="Vos demandes enregistrées." /></h2>
              </div>
              <Link className="button button--quiet" href="/retractation"><T text="Exercer mon droit" /></Link>
            </div>
            {!withdrawalRequests.length ? (
              <div className="member-orders__empty">
                <p><strong><T text="Aucune demande enregistrée." /></strong><br /><T text="Le formulaire reste accessible sans connexion et n’exige aucun motif." /></p>
              </div>
            ) : (
              <ul className="member-order-list">
                {withdrawalRequests.map((request) => (
                  <li key={request.requestNumber}>
                    <div>
                      <span>
                        <strong>{request.contractType === "SHOP_ORDER" ? <T text="Commande Boutique" /> : <T text="Création musicale" />}</strong>
                        <small>{request.requestNumber} <T text="· reçue le" />{" "}{serverDate(locale, new Date(request.receivedAt), {dateStyle:"short"})}</small>
                      </span>
                      <span>
                        <em>{request.status === "RECEIVED" ? <T text="Reçue" /> : request.status === "UNDER_REVIEW" ? <T text="En cours d’examen" /> : request.status === "ACCEPTED" ? <T text="Acceptée" /> : request.status === "REJECTED" ? <T text="Non éligible" /> : <T text="Annulée" />}</em>
                        <small>{request.eligibilityReview === "PENDING_REVIEW" ? <T text="Éligibilité à vérifier" /> : request.eligibilityReview === "ELIGIBLE" ? <T text="Éligibilité confirmée" /> : <T text="Éligibilité non confirmée" />}</small>
                      </span>
                    </div>
                    <p><strong><T text="Commande déclarée :" /></strong> {request.claimedOrderReference}<T text=". Accusé persistant archivé sous empreinte SHA-256." /></p>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="account-settings" aria-labelledby="account-settings-title">
            <div className="account-settings__heading">
              <p className="auth-panel__label"><T text="Votre compte" /></p>
              <h2 id="account-settings-title"><T text="Profil." /></h2>
            </div>
            <div className="account-settings__profile">
              <dl className="auth-profile">
                <div><dt><T text="Nom d’affichage" /></dt><dd>{<OriginalName>{session.user.name}</OriginalName>}</dd></div>
                <div><dt><T text="Email vérifié" /></dt><dd>{session.user.email}</dd></div>
                <div><dt><T text="Type de compte" /></dt><dd>{<T text={roleLabels[session.user.role]} />}</dd></div>
                <div><dt><T text="Accès" /></dt><dd>{<T text={statusLabels[session.user.status]} />}</dd></div>
                <div className="auth-profile__action"><dt><T text="Session" /></dt><dd><LogoutButton /></dd></div>
              </dl>
              <details className="auth-panel account-disclosure">
                <summary><T text="Modifier mon profil" />{" "}<span aria-hidden="true">＋</span></summary>
                <div><ProfileForm initialName={session.user.name} /></div>
              </details>
            </div>
          </section>
          <details className="auth-panel account-disclosure">
            <summary><T text="Changer mon mot de passe" />{" "}<span aria-hidden="true">＋</span></summary>
            <div><ChangePasswordForm /></div>
          </details>
        </div>
      </Container>
    </section>
  );
}
function OrderGroup({ title, orders, draft = false, locale }: { locale: import("@/lib/i18n/config").SiteLocale; title: string; orders: Awaited<ReturnType<typeof listMemberOrders>>; draft?: boolean }) {
  if (!orders.length) return null;
  return (
    <section>
      <h3><T text={title} /></h3>
      <ul className="member-order-list">
        {orders.map((order) => {
          const presentation = orderStatusPresentation[order.status];
          const href = draft ? `/commander?brouillon=${encodeURIComponent(order.orderNumber)}` : `/compte/commandes/${encodeURIComponent(order.orderNumber)}`;
          return (
            <li key={order.orderNumber}>
              <Link href={href}>
                <span><strong>{order.title || order.recipient ? <OriginalName>{order.title || order.recipient}</OriginalName> : <T text="Histoire sans titre" />}</strong><small><span className="technical-reference technical-reference--inline">{order.orderNumber}</span> · {serverDate(locale, new Date(order.createdAt), {dateStyle:"short"})}</small></span>
                <span><em>{<T text={presentation.label} />}</em><small>{<T text={clientPaymentPresentation(order)} />}</small><strong>{serverMoney(locale,order.totalCents)}</strong></span>
              </Link>
              <p><strong><T text="Options :" /></strong> {order.coverIncluded ? <><T text="Illustration" /> (<T text={orderIllustrationFormatLabel(order.illustrationFormat)} />)</> : null}{order.coverIncluded && order.priorityProcessing ? " · " : null}{order.priorityProcessing ? <T text="Priorité" /> : null}{!order.coverIncluded && !order.priorityProcessing ? <T text="Aucune" /> : null}. <strong><T text="Action attendue :" /></strong> {<T text={clientOrderAction(order)} />}. {<T text={presentation.next} />}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
