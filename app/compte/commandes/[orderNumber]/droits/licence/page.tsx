import { getSiteLocale, serverMoney } from "@/lib/i18n/server";
import { OriginalName } from "@/components/original-name";
import { T } from "@/components/site-language";
import { notFound } from "next/navigation";

import { Container } from "@/components/container";
import { RightsRequestForm } from "@/components/rights-request-form";
import { requireVerifiedUser } from "@/lib/auth/session";
import { type OrderActor } from "@/lib/orders/domain";
import { getOrderForActor } from "@/lib/orders/service";
import { loadRightsCommerceReadiness } from "@/lib/rights/commerce";
import { publicationLicenseEligibility } from "@/lib/rights/domain";
import { publicationLicenseTerms, rightsOffers } from "@/data/rights-offer";
import { listRightsRequestsForOrderActor } from "@/lib/rights/service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Licence de publication", robots: { index: false, follow: false } };

export default async function PublicationLicensePage({ params }: { params: Promise<{ orderNumber: string }> }) {
  const locale = await getSiteLocale();
  const commerce = await loadRightsCommerceReadiness();
  if (!commerce.open) notFound();
  const { orderNumber } = await params;
  const session = await requireVerifiedUser(`/compte/commandes/${orderNumber}/droits/licence`);
  const actor: OrderActor = { id: session.user.id, email: session.user.email, name: session.user.name, role: session.user.role, status: "ACTIVE", emailVerified: true };
  const order = await getOrderForActor(actor, orderNumber);
  if (!order) notFound();
  const requests = await listRightsRequestsForOrderActor(actor, order.orderNumber);
  const eligibility = publicationLicenseEligibility({ ownerMatches: true, orderStatus: order.status, deliveredAt: order.deliveredAt, expectedAmountCents: order.totalCents, expectedCurrency: order.currency, payments: order.payments, deliveries: order.deliveries, workTitle: order.title || order.recipient, existingStatuses: requests.filter((request) => request.type === "PUBLICATION_LICENSE").map((request) => request.status) });
  if (!eligibility.eligible) notFound();
  const [firstName = "", ...lastNameParts] = session.user.name.trim().split(/\s+/);
  const workTitle = order.title || order.recipient || "Création LNX";
  return <section className="auth-shell rights-shell"><Container>
    <header className="rights-license-hero"><p className="eyebrow"><T text="Droits liés à votre création" /></p><h1>{<T text={rightsOffers.PUBLICATION_LICENSE.label} />}</h1><p>{<T text={publicationLicenseTerms.summary} />}</p><dl><div><dt><T text="Œuvre concernée" /></dt><dd>{<OriginalName>{workTitle}</OriginalName>}</dd></div><div><dt><T text="Commande source" /></dt><dd>{order.orderNumber}</dd></div><div><dt><T text="Prix unique" /></dt><dd>{serverMoney(locale,rightsOffers.PUBLICATION_LICENSE.priceCents)}</dd></div><div><dt><T text="Durée / territoire" /></dt><dd><T text={publicationLicenseTerms.duration} /> · <T text={publicationLicenseTerms.territory} /></dd></div></dl><ul>{publicationLicenseTerms.limits.map((limit) => <li key={limit}><T text={limit} /></li>)}</ul><p className="rights-license-hero__notice"><T text="Le contrat applicable doit être lu et accepté sans case précochée. La prise d’effet exige les conditions contractuelles et légales applicables ; aucun commencement anticipé n’est automatique." /></p></header>
    <RightsRequestForm type="PUBLICATION_LICENSE" orderNumber={order.orderNumber} orderTitle={workTitle} account={{ firstName, lastName: lastNameParts.join(" "), artistName: session.user.name, email: session.user.email }} />
  </Container></section>;
}
