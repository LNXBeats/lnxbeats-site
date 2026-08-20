import { notFound } from "next/navigation";

import { Container } from "@/components/container";
import { RightsRequestForm } from "@/components/rights-request-form";
import { requireVerifiedUser } from "@/lib/auth/session";
import type { OrderActor } from "@/lib/orders/domain";
import { getOrderForActor } from "@/lib/orders/service";

export const dynamic = "force-dynamic";
export const metadata = { title: "Licence de publication", robots: { index: false, follow: false } };

export default async function PublicationLicensePage({ params }: { params: Promise<{ orderNumber: string }> }) {
  const { orderNumber } = await params;
  const session = await requireVerifiedUser(`/compte/commandes/${orderNumber}/droits/licence`);
  const actor: OrderActor = { id: session.user.id, email: session.user.email, name: session.user.name, role: session.user.role, status: "ACTIVE", emailVerified: true };
  const order = await getOrderForActor(actor, orderNumber);
  if (!order || order.status !== "DELIVERED" || !order.delivery) notFound();
  const [firstName = "", ...lastNameParts] = session.user.name.trim().split(/\s+/);
  return <section className="auth-shell rights-shell"><Container><RightsRequestForm type="PUBLICATION_LICENSE" orderNumber={order.orderNumber} orderTitle={order.title || order.recipient || "Création LNX"} account={{ firstName, lastName: lastNameParts.join(" "), artistName: session.user.name, email: session.user.email }} /></Container></section>;
}
