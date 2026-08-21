import Link from "next/link";
import { notFound } from "next/navigation";

import { Container } from "@/components/container";
import { ContractAcceptanceForm } from "@/components/contract-acceptance-form";
import { PartnershipPreauthorizationRevision } from "@/components/partnership-preauthorization-revision";
import { RightsInformationResponse } from "@/components/rights-information-response";
import { RightsRequestCloseActions } from "@/components/rights-request-close-actions";
import { requireVerifiedUser } from "@/lib/auth/session";
import type { OrderActor } from "@/lib/orders/domain";
import { formatRightsCurrency, humanRightsPlatform } from "@/lib/rights/document-presentation";
import { rightsEventPresentation, rightsStatusPresentation } from "@/lib/rights/domain";
import { getRightsRequestForActor } from "@/lib/rights/service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Droits et autorisations", robots: { index: false, follow: false } };

const grantLabels: Record<string, string> = {
  PUBLICATION: "Publication", DISTRIBUTION: "Distribution", PUBLIC_COMMUNICATION: "Communication publique",
  REPRODUCTION: "Reproduction", MONETIZATION: "Monétisation", ADAPTATION: "Adaptation / modification",
  ADVERTISING: "Publicité", AUDIOVISUAL_SYNCHRONIZATION: "Synchronisation audiovisuelle", CONTENT_ID: "Content ID",
  SUBLICENSE: "Sous-licence", CREDIT: "Crédit", OTHER: "Autre droit",
};

const cancellable = new Set(["SUBMITTED", "INFORMATION_REQUIRED", "UNDER_REVIEW", "PREAUTHORIZATION_GENERATED", "CONTRACT_PREPARATION", "CONTRACT_READY"]);

export default async function RightsRequestPage({ params }: { params: Promise<{ requestNumber: string }> }) {
  const { requestNumber } = await params;
  const session = await requireVerifiedUser(`/compte/droits/${requestNumber}`);
  const actor: OrderActor = { id: session.user.id, email: session.user.email, name: session.user.name, role: session.user.role, status: "ACTIVE", emailVerified: true };
  const request = await getRightsRequestForActor(actor, requestNumber);
  if (!request) notFound();
  const presentation = rightsStatusPresentation[request.status];
  const latestContract = request.documents.find((document) => document.kind === "CONTRACT" && document.status !== "SUPERSEDED");
  const expectedName = request.party?.companyName || [request.party?.firstName, request.party?.lastName].filter(Boolean).join(" ");
  const project = request.formData && typeof request.formData === "object" && !Array.isArray(request.formData)
    ? (request.formData as { project?: Record<string, unknown> }).project
    : undefined;
  const authorizedGrants = request.grants.filter((grant) => grant.authorized);
  const administrativeDurations = [...new Set(authorizedGrants.map((grant) => grant.duration).filter(Boolean))];
  const administrativeTerritories = [...new Set(authorizedGrants.map((grant) => grant.territory).filter(Boolean))];
  const latestDocumentIds = new Set<string>();
  for (const document of request.documents) {
    if (!request.documents.some((candidate) => candidate.kind === document.kind && candidate.documentVersion > document.documentVersion)) latestDocumentIds.add(document.id);
  }
  const preauthorizations = request.documents.filter((document) => document.kind === "PREAUTHORIZATION");
  const canGeneratePartnershipP02 = request.type === "EXPLOITATION_PARTNERSHIP"
    && request.status === "PREAUTHORIZATION_GENERATED"
    && preauthorizations.length === 1
    && preauthorizations[0]?.documentVersion === 1
    && preauthorizations[0]?.status === "DRAFT";
  const documentVersionLabel = (contractNumber: string, version: number) => {
    const suffix = contractNumber.match(/-([A-Z]\d{2})$/)?.[1] ?? `V${String(version).padStart(2, "0")}`;
    return `Version ${version} — ${suffix}`;
  };

  return (
    <section className="auth-shell rights-shell">
      <Container className="rights-detail">
        <Link className="back-link" href={`/compte/commandes/${encodeURIComponent(request.orderNumber)}`}>← Retour à la commande</Link>
        <header>
          <p className="eyebrow">{request.requestNumber}</p>
          <h1>{request.type === "PUBLICATION_LICENSE" ? "Licence de publication" : "Partenariat d’exploitation"}</h1>
          <p>{presentation.action}</p>
          <span className="rights-status">{presentation.label}</span>
        </header>
        <dl className="order-detail__facts">
          <div><dt>Identité</dt><dd>{expectedName || "À vérifier"}</dd></div>
          <div><dt>Commande</dt><dd>{request.orderNumber}</dd></div>
          <div><dt>Création</dt><dd>{request.workTitle}</dd></div>
          <div><dt>Offre</dt><dd>{request.type === "PUBLICATION_LICENSE" ? "Licence de publication" : "Partenariat d’exploitation"}</dd></div>
          <div><dt>Montant cible futur</dt><dd>{formatRightsCurrency(request.requestedPriceCents)}</dd></div>
          <div><dt>{administrativeTerritories.length ? "Territoire retenu pour étude" : "Territoire souhaité"}</dt><dd>{administrativeTerritories.length ? administrativeTerritories.join(" ; ") : typeof project?.territory === "string" ? project.territory : "À définir"}</dd></div>
          <div><dt>{administrativeDurations.length ? "Durée retenue pour étude" : "Durée souhaitée"}</dt><dd>{administrativeDurations.length ? administrativeDurations.join(" ; ") : typeof project?.duration === "string" ? project.duration : "À définir"}</dd></div>
          <div><dt>Plateformes souhaitées</dt><dd>{Array.isArray(project?.platforms) ? project.platforms.filter((item): item is string => typeof item === "string").map(humanRightsPlatform).join(", ") : "À définir"}</dd></div>
          <div><dt>Paiement</dt><dd>Non disponible - validation juridique et technique requise</dd></div>
        </dl>

        {request.grants.length ? <section>
          <h2>Paramètres de droits à vérifier</h2>
          <ul className="rights-document-list">{request.grants.map((grant) => <li key={grant.kind}><div>
            <strong>{grantLabels[grant.kind] ?? "Droit étudié"}</strong>
            <small>{grant.authorized ? `${grant.exclusive ? "Exclusif" : "Non exclusif"} · ${grant.territory || "territoire à définir"} · ${grant.duration || "durée à définir"}` : "Non accordé"}</small>
            {grant.authorized && grant.platforms.length ? <small>Supports : {grant.platforms.map(humanRightsPlatform).join(", ")}</small> : null}
            {grant.restrictions ? <small>Restrictions : {grant.restrictions}</small> : null}
          </div></li>)}</ul>
          <p>Tout droit non expressément autorisé reste non accordé.</p>
        </section> : null}

        {request.splitProposal ? <section className="rights-info-request"><h2>Proposition commerciale étudiée</h2><p>{request.splitProposal.clientSharePercent} % client / {request.splitProposal.lnxSharePercent} % LNX Beats.</p><p>Cette proposition n’est pas automatiquement une clé de répartition SACEM.</p></section> : null}
        {request.needsInformationMessage ? <section className="rights-info-request"><h2>Informations complémentaires demandées</h2><p>{request.needsInformationMessage}</p><RightsInformationResponse requestNumber={request.requestNumber} /></section> : null}
        {request.rejectionReason ? <section className="rights-info-request"><h2>Demande non retenue</h2><p>{request.rejectionReason}</p></section> : null}

        <section>
          <h2>Documents privés</h2>
          {request.documents.length ? <ul className="rights-document-list">{request.documents.map((document) => <li key={document.id}><div>
            <strong>{document.kind === "PREAUTHORIZATION" ? "Projet de préautorisation" : document.kind === "CONTRACT" ? "Projet de contrat" : document.kind === "ACCEPTANCE_RECEIPT" ? "Preuve d’acceptation" : "Fiche de préparation SACEM"}{latestDocumentIds.has(document.id) ? " · Dernière version" : ""}</strong>
            <small>{document.contractNumber} · {documentVersionLabel(document.contractNumber, document.documentVersion)} · {new Date(document.generatedAt).toLocaleDateString("fr-FR", { dateStyle: "long" })} · Projet non actif · hash {document.hashShort}</small>
          </div><div><a className="form-button" href={`/api/rights/documents/${document.id}`} target="_blank" rel="noreferrer">CONSULTER</a><a className="text-link" href={`/api/rights/documents/${document.id}?telecharger=1`}>Télécharger</a></div></li>)}</ul> : <p>Aucun document généré.</p>}
          {canGeneratePartnershipP02 ? <PartnershipPreauthorizationRevision requestNumber={request.requestNumber} /> : null}
        </section>
        {latestContract?.status === "READY_FOR_CLIENT" && expectedName ? <ContractAcceptanceForm requestNumber={request.requestNumber} expectedName={expectedName} documentId={latestContract.id} documentVersion={latestContract.documentVersion} hashShort={latestContract.hashShort} /> : null}
        {cancellable.has(request.status) ? <RightsRequestCloseActions requestNumber={request.requestNumber} orderNumber={request.orderNumber} draft={false} /> : null}
        <section>
          <h2>Historique</h2>
          <ol className="order-timeline">{request.events.map((event) => <li key={event.id}><span aria-hidden="true" /><div><time>{new Date(event.createdAt).toLocaleString("fr-FR")}</time><strong>{rightsEventPresentation[event.type]}</strong>{event.note ? <p>{event.note}</p> : null}</div></li>)}</ol>
        </section>
        <p className="rights-form__warning">Aucun document de cette version n’accorde de droit actif. Aucune déclaration SACEM et aucun paiement de droits ne sont réalisés.</p>
      </Container>
    </section>
  );
}
