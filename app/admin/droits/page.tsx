import Link from "next/link";

import { approveContractTemplateAction } from "@/app/admin/droits/actions";
import { AdminBackLink } from "@/components/admin-back-link";
import {
  evaluateRightsCommerceReadiness,
  type RightsCommerceReason,
} from "@/lib/rights/commerce";
import {
  countRightsAdminViews,
  parseRightsAdminView,
  rightsAdminViewLabels,
  rightsAdminViews,
  rightsRequestMatchesAdminView,
} from "@/lib/rights/admin-views";
import { contractTemplateStatusPresentation, rightsStatusPresentation } from "@/lib/rights/domain";
import { listAdminRightsArchiveIds, listAdminRightsCases, listContractTemplates } from "@/lib/rights/workflow";

export const dynamic = "force-dynamic";
export const metadata = { title: "Droits & contrats" };

const commerceStateLabels = {
  BLOCKED: "Bloqué — prérequis incomplets",
  READY_NOT_OPEN: "Prêt techniquement — non ouvert",
  OPEN: "Ouvert",
} as const;

const contractTemplateTypeLabels = {
  PUBLICATION_LICENSE: "Licence de publication",
  EXPLOITATION_PARTNERSHIP: "Partenariat d’exploitation",
} as const;

const readinessReasonLabels: Record<RightsCommerceReason, string> = {
  REQUIRED_TEMPLATE_MISSING: "Modèle contractuel requis absent",
  TEMPLATE_SOURCE_INVALID: "Source du modèle invalide",
  LEGAL_REVIEW_REQUIRED: "Validation juridique du modèle manquante",
  TEMPLATE_RENDERER_BINDING_MISSING: "Binding entre le modèle approuvé et le renderer absent",
  RIGHTS_BILLING_UNAVAILABLE: "Facturation dédiée aux droits indisponible",
  RIGHTS_PAYMENT_UNAVAILABLE: "Paiement dédié aux droits indisponible",
  RIGHTS_ACTIVATION_UNAVAILABLE: "Activation contractuelle indisponible",
};

function euros(cents: number, currency = "EUR") {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(cents / 100);
}

function templateStatusLabel(status: string | null) {
  if (!status) return "Absent";
  return contractTemplateStatusPresentation[status as keyof typeof contractTemplateStatusPresentation] ?? status;
}

export default async function AdminRightsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const query = await searchParams;
  const type = typeof query.type === "string" ? query.type : "";
  const status = typeof query.statut === "string" ? query.statut : "";
  const search = typeof query.q === "string" ? query.q : "";
  const view = parseRightsAdminView(typeof query.vue === "string" ? query.vue : undefined);
  const [allRequests, templates, archivedIds] = await Promise.all([
    listAdminRightsCases({ type, status, query: search }),
    listContractTemplates(),
    listAdminRightsArchiveIds(),
  ]);
  const requestCounts = countRightsAdminViews(allRequests, archivedIds);
  const requests = allRequests.filter((request) => rightsRequestMatchesAdminView({
    status: request.status,
    archived: archivedIds.has(request.id),
  }, view));
  const commerce = evaluateRightsCommerceReadiness(templates);

  return (
    <main className="admin-main admin-rights">
      <AdminBackLink href="/admin">Retour à l’Administration</AdminBackLink>
      <header className="admin-page-heading">
        <div>
          <p className="admin-section-label">Droits & contrats</p>
          <h1>MODULE DROITS &amp; CONTRATS NON OUVERT.</h1>
          <p>Les demandes et documents restent préparatoires. Aucun paiement et aucun droit actif ne sont disponibles.</p>
        </div>
        <span className="admin-status">{commerceStateLabels[commerce.state]}</span>
      </header>

      <section className="admin-panel" aria-labelledby="rights-offers-title">
        <div className="admin-panel__heading">
          <p className="admin-section-label">Offres</p>
          <h2 id="rights-offers-title">Offres LNX Beats.</h2>
        </div>
        <div className="admin-template-grid admin-template-grid--offers">
          {commerce.offers.map((offer) => (
            <article key={offer.type}>
              <h3>{offer.label}</h3>
              <p><strong>{euros(offer.priceCents, offer.currency)}</strong> · tarif serveur {offer.pricingVersion}</p>
              <p>{offer.title}. La portée finale dépendra exclusivement du contrat juridiquement validé.</p>
              <p>Offre unique post-livraison, rattachée à une œuvre livrée et à sa commande source.</p>
              <dl className="admin-definition-grid">
                <div><dt>Statut</dt><dd>{offer.reasons.length ? "Verrouillée" : "Prête techniquement"}</dd></div>
                <div><dt>Modèle</dt><dd>{contractTemplateTypeLabels[offer.requiredTemplateType]}</dd></div>
                <div><dt>Version</dt><dd>{offer.templateVersion ?? "Aucune"}</dd></div>
                <div><dt>Validation juridique</dt><dd>{offer.legalReviewApproved ? "Référencée" : "Requise"}</dd></div>
                <div><dt>Paiement activable</dt><dd>{offer.paymentReady && commerce.open ? "Oui" : "Non"}</dd></div>
                <div><dt>Readiness</dt><dd>{offer.reasons.length ? "Bloquée" : commerceStateLabels[commerce.state]}</dd></div>
              </dl>
              <p><strong>Non payable actuellement. Achat public désactivé.</strong></p>
            </article>
          ))}
        </div>
        <aside className="admin-alert"><strong>Ancien périmètre 1 500 € non proposé.</strong> Aucun produit, tarif, CTA ou checkout public n’est disponible. Toute demande atypique relève d’un contact direct hors e-commerce.</aside>
      </section>

      <section className="admin-panel" aria-labelledby="rights-requests-title">
        <div className="admin-panel__heading">
          <p className="admin-section-label">Demandes</p>
          <h2 id="rights-requests-title">Demandes contractuelles.</h2>
        </div>
        <nav className="admin-filters" aria-label="Filtrer les demandes de droits">
          {rightsAdminViews.map((candidate) => (
            <Link
              key={candidate}
              href={candidate === "attention" ? "/admin/droits" : `/admin/droits?vue=${candidate}`}
              aria-current={view === candidate ? "page" : undefined}
            >
              {rightsAdminViewLabels[candidate]} <span aria-label={`${requestCounts[candidate]} demande${requestCounts[candidate] === 1 ? "" : "s"}`}>{requestCounts[candidate]}</span>
            </Link>
          ))}
        </nav>
        <form className="admin-rights__filters" method="get">
          <input type="hidden" name="vue" value={view} />
          <label>Recherche<input name="q" defaultValue={search} placeholder="Client, Order, création…" /></label>
          <label>Offre<select name="type" defaultValue={type}><option value="">Toutes</option>{commerce.offers.map((offer) => <option key={offer.type} value={offer.type}>{offer.label} · {euros(offer.priceCents, offer.currency)}</option>)}</select></label>
          <label>Statut<select name="statut" defaultValue={status}><option value="">Tous</option>{Object.entries(rightsStatusPresentation).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}</select></label>
          <button className="admin-button" type="submit">FILTRER</button>
        </form>
        <div className="admin-table-wrap">
          <table>
            <thead><tr><th>Demande</th><th>Client / création</th><th>Offre</th><th>Statut</th><th>Documents</th></tr></thead>
            <tbody>{requests.map((request) => <tr key={request.requestNumber}><td><Link href={`/admin/droits/${request.requestNumber}`}>{request.requestNumber}</Link><small>{request.order.orderNumber}</small></td><td>{request.owner.displayName}<small>{request.workTitle}</small></td><td>{request.type === "PUBLICATION_LICENSE" ? "Licence" : "Partenariat"}<small>{euros(request.requestedPriceCents, request.currency)}</small></td><td>{rightsStatusPresentation[request.status].label}</td><td>{request._count.documents}</td></tr>)}</tbody>
          </table>
          {!requests.length ? <p>Aucune demande dans la vue « {rightsAdminViewLabels[view]} ».</p> : null}
        </div>
        {view === "payment-closed" ? <p className="admin-alert">Ces dossiers ne sont pas des paiements confirmés : le module Droits ne possède encore aucun rattachement Payment/Invoice et reste fermé.</p> : null}
      </section>

      <section className="admin-panel" aria-labelledby="templates-title">
        <div className="admin-panel__heading">
          <p className="admin-section-label">Modèles</p>
          <h2 id="templates-title">Validation juridique des modèles.</h2>
        </div>
        <p>Une approbation exige une référence de revue juridique. Un modèle déjà utilisé reste immuable. Cette approbation ne suffit pas à ouvrir le commerce tant que son contenu n’est pas lié au renderer effectif.</p>
        <div className="admin-template-grid">
          {templates.map((template) => (
            <article key={template.id}>
              <h3>{template.title}</h3>
              <p>Version {template.version} · {contractTemplateStatusPresentation[template.status]} · {template._count.documents} document(s)</p>
              {template.status !== "APPROVED" && template.status !== "RETIRED" ? (
                <form action={approveContractTemplateAction}>
                  <input type="hidden" name="templateId" value={template.id} />
                  <label>Référence de revue juridique<input name="legalReviewReference" required maxLength={240} /></label>
                  <button className="admin-button" type="submit">APPROUVER APRÈS REVUE</button>
                </form>
              ) : <p><strong>{contractTemplateStatusPresentation[template.status]}</strong>{template.legalReviewReference ? ` · ${template.legalReviewReference}` : ""}</p>}
            </article>
          ))}
        </div>
      </section>

      <section className="admin-panel" aria-labelledby="rights-diagnostic-title">
        <div className="admin-panel__heading">
          <p className="admin-section-label">Diagnostic</p>
          <h2 id="rights-diagnostic-title">Readiness fail-closed.</h2>
        </div>
        <details className="admin-technical-details">
          <summary>DIAGNOSTIC AVANCÉ</summary>
          <p><strong>État : {commerceStateLabels[commerce.state]}.</strong> L’ouverture n’est pilotée par aucune variable distante.</p>
          <div className="admin-template-grid">
            {commerce.offers.map((offer) => (
              <article key={offer.type}>
                <h3>{offer.label}</h3>
                <dl className="admin-definition-grid">
                  <div><dt>Prix serveur</dt><dd>{euros(offer.priceCents, offer.currency)}</dd></div>
                  <div><dt>Modèle requis</dt><dd>{offer.requiredTemplateType}</dd></div>
                  <div><dt>Version / état</dt><dd>{offer.templateVersion ?? "—"} · {templateStatusLabel(offer.templateStatus)}</dd></div>
                  <div><dt>Validation juridique</dt><dd>{offer.legalReviewApproved ? "Référencée" : "Manquante"}</dd></div>
                  <div><dt>Binding renderer</dt><dd>{offer.rendererBound ? "Prêt" : "Absent"}</dd></div>
                  <div><dt>Facturation</dt><dd>{offer.billingReady ? "Prête" : "Indisponible"}</dd></div>
                  <div><dt>Paiement</dt><dd>{offer.paymentReady ? "Prêt" : "Indisponible"}</dd></div>
                  <div><dt>Activation</dt><dd>{offer.activationReady ? "Prête" : "Indisponible"}</dd></div>
                </dl>
                <ul>{offer.reasons.map((reason) => <li key={reason}>{readinessReasonLabels[reason]}</li>)}</ul>
              </article>
            ))}
          </div>
        </details>
      </section>

      <aside className="admin-alert"><strong>MODULE DROITS &amp; CONTRATS NON OUVERT.</strong> Ne pas encaisser, activer un contrat ou présenter une fiche SACEM comme une déclaration.</aside>
    </main>
  );
}
