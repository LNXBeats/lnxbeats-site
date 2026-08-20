import Link from "next/link";
import { notFound } from "next/navigation";

import { Container } from "@/components/container";
import { RightsContactConfirmation } from "@/components/rights-contact-confirmation";
import { RightsRequestCloseActions } from "@/components/rights-request-close-actions";
import { requireVerifiedUser } from "@/lib/auth/session";
import type { OrderActor } from "@/lib/orders/domain";
import { contractPartyPresentation } from "@/lib/rights/domain";
import { getRightsRequestForActor } from "@/lib/rights/service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Vérifier vos informations contractuelles", robots: { index: false, follow: false } };

export default async function VerifyRightsContactPage({ params }: { params: Promise<{ requestNumber: string }> }) {
  const { requestNumber } = await params;
  const session = await requireVerifiedUser(`/compte/droits/${requestNumber}/verifier`);
  const actor: OrderActor = { id: session.user.id, email: session.user.email, name: session.user.name, role: session.user.role, status: "ACTIVE", emailVerified: true };
  const request = await getRightsRequestForActor(actor, requestNumber);
  if (!request?.party || request.status !== "DRAFT") notFound();
  const party = request.party;

  return (
    <section className="auth-shell rights-shell">
      <Container className="rights-verification">
        <p className="eyebrow">{request.requestNumber}</p>
        <h1>Vérifiez vos informations contractuelles.</h1>
        <p>Ces informations seront reproduites sur votre document. Vérifiez-les attentivement avant de continuer.</p>
        <dl className="order-detail__facts">
          <div><dt>Type de partie</dt><dd>{contractPartyPresentation[party.partyType]}</dd></div>
          <div><dt>Nom</dt><dd>{party.companyName || `${party.firstName} ${party.lastName}`}</dd></div>
          {party.legalRepresentative ? <div><dt>Représentant</dt><dd>{party.legalRepresentative}</dd></div> : null}
          <div><dt>Adresse</dt><dd>{party.streetAddress}, {party.postalCode} {party.city}, {party.country}</dd></div>
          <div><dt>E-mail contractuel</dt><dd>{party.contractEmail}</dd></div>
          {party.siret ? <div><dt>SIRET</dt><dd>{party.siret}</dd></div> : null}
        </dl>
        <div className="rights-confirm-actions">
          <Link className="form-button" href={`/compte/commandes/${encodeURIComponent(request.orderNumber)}/droits/${request.type === "PUBLICATION_LICENSE" ? "licence" : "partenariat"}`}>MODIFIER MES INFORMATIONS</Link>
          <RightsContactConfirmation requestNumber={request.requestNumber} />
        </div>
        <RightsRequestCloseActions requestNumber={request.requestNumber} orderNumber={request.orderNumber} draft />
        <p className="rights-form__warning">La confirmation produit un projet de préautorisation filigrané. Elle n’active aucun droit et ne déclenche aucun paiement.</p>
      </Container>
    </section>
  );
}
