import Link from "next/link";
import { notFound } from "next/navigation";

import {
  adminValidateRightsContractAction,
  generateRightsDocumentAction,
  rejectRightsRequestAction,
  requestRightsInformationAction,
  startRightsReviewAction,
  updateAiAssessmentAction,
} from "@/app/admin/droits/actions";
import { AdminRightsGrantForm } from "@/components/admin-rights-grant-form";
import { AdminPrivateDocumentHeading } from "@/components/admin-private-document-heading";
import { AdminRightsSplitForm } from "@/components/admin-rights-split-form";
import {
  adminClientRightsWishes,
  adminRightsNotice,
  adminRightsAuditTimestamp,
  adminRightsGrantPrefill,
  adminRightsProjectSummary,
  adminRightsRequestedFieldLabels,
  formatAdminRightsDateTime,
  rightsDocumentActionLabel,
} from "@/lib/rights/admin-presentation";
import {
  canGenerateContractDraft,
  canStartRightsReview,
  contractPartyPresentation,
  contractTemplateStatusPresentation,
  isLegalTemplateUsable,
  rightsEventPresentation,
  rightsStatusPresentation,
} from "@/lib/rights/domain";
import { orderStatusPresentation } from "@/lib/orders/status";
import { getAdminRightsCase, listContractTemplates } from "@/lib/rights/workflow";

export const dynamic = "force-dynamic";
export const metadata = { title: "Demande de droits" };

const contributionLabels: Record<string, string> = {
  NONE: "Aucune contribution créative",
  STORY_BRIEF_ONLY: "Histoire / brief uniquement",
  LYRICS_FULL: "Paroles entièrement fournies",
  LYRICS_PARTIAL: "Paroles partiellement fournies",
  LYRICS_CO_WRITTEN: "Paroles coécrites",
  MELODY: "Mélodie",
  MUSICAL_COMPOSITION: "Composition musicale",
  ARRANGEMENT: "Arrangement",
  INSTRUMENTAL: "Instrumental",
  ARTISTIC_DIRECTION: "Direction artistique",
  VOICE: "Voix",
  MIX_MASTER: "Mix / master",
  INSTRUMENTS: "Instruments",
  PRODUCTION: "Production",
  OTHER: "Autre",
};
const grantLabels: Record<string, string> = {
  PUBLICATION: "Publication",
  DISTRIBUTION: "Distribution",
  PUBLIC_COMMUNICATION: "Communication publique",
  REPRODUCTION: "Reproduction",
  MONETIZATION: "Monétisation",
  ADAPTATION: "Adaptation / modification",
  ADVERTISING: "Publicité",
  AUDIOVISUAL_SYNCHRONIZATION: "Synchronisation audiovisuelle",
  CONTENT_ID: "Content ID",
  SUBLICENSE: "Sous-licence",
  CREDIT: "Crédit",
  OTHER: "Autre droit",
};
const fieldLabels: Record<string, string> = {
  party: "Coordonnées",
  project: "Projet",
  platforms: "Plateformes",
  territory: "Territoire",
  duration: "Durée",
  contributions: "Contributions",
  lyrics: "Paroles",
  composition: "Composition",
  production: "Production",
  aiContribution: "Apport créatif humain / IA",
  sacem: "Informations SACEM",
  credits: "Crédits",
};
const assessmentLabels: Record<string, string> = {
  NOT_REVIEWED: "Non revu",
  HUMAN_CONTRIBUTION_DOCUMENTED: "Apport humain documenté",
  LEGAL_REVIEW_REQUIRED: "Revue juridique requise",
  DECLARATION_NOT_RECOMMENDED: "Déclaration non recommandée",
  POTENTIALLY_ELIGIBLE: "Potentiellement éligible",
};
const documentKindLabels: Record<string, string> = {
  PREAUTHORIZATION: "Projet de préautorisation",
  CONTRACT: "Conditions particulières",
  ACCEPTANCE_RECEIPT: "Preuve d’acceptation",
  SACEM_PREPARATION: "Fiche de préparation SACEM",
};
const documentStatusLabels: Record<string, string> = {
  DRAFT: "Projet",
  READY_FOR_CLIENT: "Prêt pour revue client",
  CLIENT_ACCEPTED: "Accepté par le client",
  ADMIN_VALIDATED: "Validé par LNX Beats",
  SUPERSEDED: "Remplacé",
  ACTIVE: "Actif",
};

function euros(cents: number) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100);
}

function date(value: Date | null) {
  return formatAdminRightsDateTime(value);
}

export default async function AdminRightsDetailPage({ params, searchParams }: {
  params: Promise<{ requestNumber: string }>;
  searchParams: Promise<{ etat?: string }>;
}) {
  const { requestNumber } = await params;
  const { etat } = await searchParams;
  const request = await getAdminRightsCase(requestNumber);
  if (!request) notFound();
  const templates = await listContractTemplates();

  const party = request.partySnapshots[0];
  const split = request.splitProposals[0];
  const latestContract = request.documents.find((document) => document.kind === "CONTRACT" && document.status !== "SUPERSEDED");
  const clientAcceptance = latestContract?.acceptances.find((acceptance) => acceptance.kind === "CLIENT");
  const projectSummary = adminRightsProjectSummary(request.formData, request.workTitle);
  const clientWishes = adminClientRightsWishes(request.formData);
  const grantPrefill = adminRightsGrantPrefill(request.formData);
  const contractDocuments = request.documents.filter((document) => document.kind === "CONTRACT");
  const latestTemplate = templates.find((template) => template.type === request.type);
  const currentTemplate = latestTemplate?.status === "RETIRED" ? undefined : latestTemplate;
  const canGenerateContract = canGenerateContractDraft(request.status, request.grants.length) && Boolean(currentTemplate);
  const documentCta = rightsDocumentActionLabel(contractDocuments.length);
  const expectedContractDocumentVersion = Math.max(0, ...contractDocuments.map((document) => document.documentVersion)) + 1;
  const sacemDocuments = request.documents.filter((document) => document.kind === "SACEM_PREPARATION");
  const expectedSacemDocumentVersion = Math.max(0, ...sacemDocuments.map((document) => document.documentVersion)) + 1;

  return <main className="admin-main admin-rights-detail">
    <Link className="admin-back-link" href="/admin/droits">← Toutes les demandes</Link>
    {etat ? <p className="admin-notice" role="status">{adminRightsNotice(etat)}</p> : null}
    <header className="admin-page-heading">
      <div>
        <p className="admin-section-label">{request.requestNumber}</p>
        <h1>{request.workTitle}</h1>
        <p>{request.type === "PUBLICATION_LICENSE" ? "Licence de publication · 150 €" : "Partenariat d’exploitation · 1 500 €"}</p>
      </div>
      <span className="admin-status">{rightsStatusPresentation[request.status].label}</span>
    </header>

    <section className="admin-panel">
      <div className="admin-panel__heading"><p className="admin-section-label">Synthèse</p><h2>Client, Order et livraison.</h2></div>
      <dl className="admin-definition-grid">
        <div><dt>Client</dt><dd>{request.owner.displayName}<small>{request.owner.email} · email {request.owner.emailVerified ? "vérifié" : "non vérifié"}</small></dd></div>
        <div><dt>Commande</dt><dd><Link href={`/admin/commandes/${request.order.orderNumber}`}>{request.order.orderNumber}</Link><small>{orderStatusPresentation[request.order.status].label} · {euros(request.order.totalCents)}</small></dd></div>
        <div><dt>Paiement initial</dt><dd>{request.order.payments.length === 1 ? "Confirmé" : "À vérifier"}<small>{request.order.payments[0] ? `${euros(request.order.payments[0].amountCents)} · ${date(request.order.payments[0].paidAt)}` : "Aucune preuve"}</small></dd></div>
        <div><dt>Livraison</dt><dd>{request.order.assets.length === 1 ? "Master privé publié" : "À vérifier"}<small>{request.order.assets[0]?.asset.filename ?? "Aucun fichier"}</small></dd></div>
        <div><dt>Montant cible</dt><dd>{euros(request.requestedPriceCents)}<small>Aucun paiement de droits</small></dd></div>
        <div><dt>Évaluation IA</dt><dd>{assessmentLabels[request.aiAssessment]}</dd></div>
      </dl>
      {canStartRightsReview(request.status) ? <form action={startRightsReviewAction}><input type="hidden" name="requestNumber" value={request.requestNumber} /><button className="admin-button" type="submit">PLACER EN ÉTUDE</button></form> : null}
    </section>

    <section className="admin-panel">
      <div className="admin-panel__heading"><p className="admin-section-label">Coordonnées vérifiées</p><h2>Partie contractuelle.</h2></div>
      {party ? <dl className="admin-definition-grid">
        <div><dt>Version</dt><dd>{party.version} · confirmée {date(party.confirmedAt)}</dd></div>
        <div><dt>Partie</dt><dd>{party.companyName || [party.firstName, party.lastName].filter(Boolean).join(" ")}<small>{contractPartyPresentation[party.partyType]}</small></dd></div>
        <div><dt>Adresse</dt><dd>{party.streetAddress}<small>{party.postalCode} {party.city} · {party.country}</small></dd></div>
        <div><dt>E-mail contractuel</dt><dd>{party.contractEmail}</dd></div>
        <div><dt>SIRET</dt><dd>{party.siret || "Non renseigné"}</dd></div>
        <div><dt>Représentant</dt><dd>{party.legalRepresentative || "Non applicable"}</dd></div>
      </dl> : <p>Coordonnées absentes.</p>}

      <div className="admin-rights-summary-heading"><p className="admin-section-label">Projet d’exploitation</p><h3>Réponses du formulaire.</h3></div>
      <dl className="admin-rights-summary-grid">
        {projectSummary.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}
      </dl>

      <div className="admin-rights-summary-heading"><p className="admin-section-label">Contribution déclarée</p><h3>Affirmations du client à vérifier.</h3></div>
      {request.contributions.length ? <div className="admin-contribution-list">
        {request.contributions.map((item) => <article key={item.id}>
          <dl>
            <div><dt>Nature</dt><dd>{contributionLabels[item.kind] ?? "Contribution déclarée"}</dd></div>
            <div><dt>Déclaration</dt><dd>{item.description || "Non renseigné"}</dd></div>
            <div><dt>Quote-part revendiquée</dt><dd>{item.claimedPercentage === null ? "Aucune" : `${item.claimedPercentage} %`}</dd></div>
            <div><dt>Justificatif</dt><dd>{item.evidenceNote || "Aucun"}</dd></div>
          </dl>
        </article>)}
      </div> : <p>Non renseigné</p>}
    </section>

    <section className="admin-panel">
      <div className="admin-panel__heading"><p className="admin-section-label">Apport créatif</p><h2>Évaluation interne.</h2></div>
      <form className="admin-inline-form" action={updateAiAssessmentAction}>
        <input type="hidden" name="requestNumber" value={request.requestNumber} />
        <label>État<select name="assessment" defaultValue={request.aiAssessment}>{Object.entries(assessmentLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        <button className="admin-button" type="submit">ENREGISTRER</button>
      </form>
      <p>Lorsque l’œuvre et les contributions concernées sont éligibles, LNX Beats peut effectuer les démarches correspondant aux droits qu’il détient. Aucune déclaration n’est garantie.</p>
    </section>

    <section className="admin-panel">
      <div className="admin-panel__heading"><p className="admin-section-label">Paramètres structurés</p><h2>Droits expressément étudiés.</h2></div>
      <p>Tout droit non expressément autorisé reste non accordé. Enregistrez un droit à la fois.</p>
      <AdminRightsGrantForm
        requestNumber={request.requestNumber}
        grantOptions={Object.entries(grantLabels).map(([value, label]) => ({ value, label }))}
        clientWishes={clientWishes}
        prefill={grantPrefill}
      />
      <div className="admin-card-list">
        {request.grants.map((grant) => <article key={grant.id}>
          <strong>{grantLabels[grant.kind] ?? grant.kind}</strong>
          <p>{grant.authorized ? `${grant.exclusive ? "Exclusif" : "Non exclusif"} · ${grant.territory || "territoire à définir"} · ${grant.duration || "durée à définir"}` : "Non accordé"}</p>
          {grant.restrictions ? <small>{grant.restrictions}</small> : null}
        </article>)}
      </div>
    </section>

    {request.type === "EXPLOITATION_PARTNERSHIP" ? <section className="admin-panel">
      <div className="admin-panel__heading"><p className="admin-section-label">Proposition commerciale</p><h2>Répartition envisagée.</h2></div>
      <aside className="admin-alert">Cette proposition contractuelle n’est pas automatiquement une clé de répartition SACEM. Les rôles, catégories de droits et règles applicables doivent être vérifiés.</aside>
      {split ? <p><strong>Version {split.version} :</strong> {split.clientSharePercent} % client / {split.lnxSharePercent} % LNX Beats. {split.contributionRationale}</p> : <p>Aucune valeur par défaut.</p>}
      <AdminRightsSplitForm requestNumber={request.requestNumber} />
    </section> : null}

    <section className="admin-panel">
      <div className="admin-panel__heading"><p className="admin-section-label">Échanges</p><h2>Demande d’informations.</h2></div>
      <ol className="admin-message-list">
        {request.messages.map((message) => {
          const timestamp = adminRightsAuditTimestamp(message.createdAt);
          const requestedFields = adminRightsRequestedFieldLabels(message.requestedFields);
          const isAdminRequest = message.kind === "ADMIN_REQUEST";
          return <li key={message.id}>
            <div className="admin-message-list__meta"><strong>{isAdminRequest ? "LNX Beats" : "Client"}</strong><span aria-hidden="true">·</span><time dateTime={timestamp.iso}>{timestamp.display}</time></div>
            {requestedFields.length ? <div className="admin-message-list__fields"><strong>Champs demandés :</strong><ul>{requestedFields.map((field) => <li key={field}>{field}</li>)}</ul></div> : null}
            <p><strong>{isAdminRequest ? "Demande :" : "Réponse :"}</strong> <q>{message.body}</q></p>
          </li>;
        })}
      </ol>
      <form className="admin-contract-form" action={requestRightsInformationAction}>
        <input type="hidden" name="requestNumber" value={request.requestNumber} />
        <fieldset><legend>Champs à préciser</legend><div className="admin-choice-row">{Object.entries(fieldLabels).map(([value, label]) => <label key={value}><input type="checkbox" name="requestedFields" value={value} /> {label}</label>)}</div></fieldset>
        <label>Message au client<textarea name="message" required maxLength={4000} /></label>
        <button className="admin-button" type="submit">DEMANDER DES INFORMATIONS</button>
      </form>
    </section>

    <section className="admin-panel">
      <div className="admin-panel__heading"><p className="admin-section-label">Documents privés</p><h2>Versions immuables.</h2></div>
      <ul className="admin-card-list">
        {request.documents.map((document) => {
          const latestVersion = Math.max(...request.documents.filter((candidate) => candidate.kind === document.kind).map((candidate) => candidate.documentVersion));
          const isLatest = document.documentVersion === latestVersion;
          return <li className={isLatest ? "admin-private-document admin-private-document--latest" : "admin-private-document"} key={document.id}>
            <AdminPrivateDocumentHeading
              contractNumber={document.contractNumber}
              documentVersion={document.documentVersion}
              isLatest={isLatest}
              kind={document.kind}
            />
            <p>{documentKindLabels[document.kind]} · {document.contractNumber}</p>
            <p>Modèle {document.templateVersion} ({contractTemplateStatusPresentation[document.template.status]}) · {documentStatusLabels[document.status]}</p>
            <p>Empreinte {document.documentHashSha256.slice(0, 12).toUpperCase()} · généré le {date(document.generatedAt)}</p>
            <a href={`/api/rights/documents/${document.id}`} target="_blank" rel="noreferrer">Consulter le PDF privé</a>
            {document.acceptances.map((acceptance) => <small key={acceptance.id}>{acceptance.kind === "CLIENT" ? "Client" : "LNX Beats"} : acceptation enregistrée par {acceptance.acceptedBy.displayName} le {date(acceptance.acceptedAt)}</small>)}
          </li>;
        })}
      </ul>
      <div className="admin-action-row">
        {canGenerateContract ? <form action={generateRightsDocumentAction}>
          <input type="hidden" name="requestNumber" value={request.requestNumber} />
          <input type="hidden" name="kind" value="CONTRACT" />
          <input type="hidden" name="expectedDocumentVersion" value={expectedContractDocumentVersion} />
          <button className="admin-button" type="submit">{documentCta}</button>
          {currentTemplate ? <p className="admin-action-note">Modèle {contractTemplateStatusPresentation[currentTemplate.status]} · version {currentTemplate.version}. {isLegalTemplateUsable(currentTemplate.status, currentTemplate.approvedAt, currentTemplate.approvedByAdminId, currentTemplate.legalReviewReference)
            ? "Le document pourra être présenté pour revue client."
            : "Le PDF restera DRAFT, filigrané, non actif, non payable et non acceptable avant revue juridique."}</p> : null}
        </form> : <div className="admin-disabled-action">
          <button className="admin-button" type="button" disabled>{documentCta}</button>
          <p>{request.grants.length === 0
            ? "Enregistrez d’abord au moins un paramètre structuré."
            : !canGenerateContractDraft(request.status, request.grants.length)
              ? "Placez la demande en étude avant de préparer le document."
              : "Aucun modèle contractuel n’est disponible pour cette offre."}</p>
        </div>}
        {request.type === "EXPLOITATION_PARTNERSHIP" && ["ADMIN_VALIDATED", "READY_FOR_PAYMENT"].includes(request.status) ? <form action={generateRightsDocumentAction}>
          <input type="hidden" name="requestNumber" value={request.requestNumber} />
          <input type="hidden" name="kind" value="SACEM_PREPARATION" />
          <input type="hidden" name="expectedDocumentVersion" value={expectedSacemDocumentVersion} />
          <button className="admin-button" type="submit">GÉNÉRER LA FICHE SACEM PRIVÉE</button>
        </form> : null}
      </div>
      {clientAcceptance && request.status === "CLIENT_ACCEPTED" ? <form className="admin-contract-form" action={adminValidateRightsContractAction}>
        <input type="hidden" name="requestNumber" value={request.requestNumber} />
        <p>Le client a accepté le document {latestContract?.contractNumber}. La validation Admin est distincte et n’active aucun droit.</p>
        <label>Nom complet de l’Admin<input name="typedFullName" required maxLength={200} /></label>
        <label className="admin-check"><input type="checkbox" name="accepted" /> Je valide ce projet après revue. Aucun paiement ni droit n’est activé.</label>
        <button className="admin-button" type="submit">VALIDER CÔTÉ ADMIN</button>
      </form> : null}
    </section>

    <section className="admin-panel">
      <div className="admin-panel__heading"><p className="admin-section-label">Historique</p><h2>Audit métier.</h2></div>
      <ol className="admin-rights-timeline">
        {request.events.map((item) => {
          const timestamp = adminRightsAuditTimestamp(item.createdAt);
          return <li key={item.id}>
            <time className="admin-rights-timeline__when" dateTime={timestamp.iso}>{timestamp.display}</time>
            <div className="admin-rights-timeline__content"><strong>{rightsEventPresentation[item.type]}</strong><p>{item.note}</p></div>
            <small className="admin-rights-timeline__actor">{item.actor?.displayName ?? "Système"}</small>
          </li>;
        })}
      </ol>
    </section>

    <section className="admin-panel admin-danger">
      <div className="admin-panel__heading"><p className="admin-section-label">Décision</p><h2>Rejeter la demande.</h2></div>
      <form className="admin-contract-form" action={rejectRightsRequestAction}>
        <input type="hidden" name="requestNumber" value={request.requestNumber} />
        <label>Motif humain<textarea name="reason" required maxLength={4000} /></label>
        <button className="admin-button admin-button--danger" type="submit">REJETER AVEC MOTIF</button>
      </form>
    </section>
    <aside className="admin-alert"><strong>Aucun paiement de droits implémenté.</strong> Aucun Checkout, PaymentIntent, contrat actif ou déclaration SACEM n’est créé par ces actions.</aside>
  </main>;
}
