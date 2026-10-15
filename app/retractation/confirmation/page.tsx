import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";

import { Container } from "@/components/container";
import { getWithdrawalReceipt } from "@/lib/legal/withdrawal";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Accusé de réception", robots: { index: false, follow: false }, referrer: "no-referrer" };

function maskEmail(value: string) {
  const [local = "", domain = ""] = value.split("@");
  return `${local.slice(0, 2)}${"•".repeat(Math.max(3, Math.min(8, local.length - 2)))}@${domain}`;
}

export default async function WithdrawalConfirmationPage() {
  const token = (await cookies()).get("lnx-withdrawal-receipt")?.value;
  const receipt = await getWithdrawalReceipt(token).catch(() => null);
  return (
    <section className="withdrawal-page withdrawal-page--confirmation">
      <Container className="withdrawal-page__container">
        <p className="eyebrow">Accusé de réception</p>
        <h1>{receipt ? "Votre déclaration a été enregistrée." : "Accusé indisponible."}</h1>
        {receipt ? (
          <article className="withdrawal-receipt">
            <p>Conservez ou imprimez cet accusé. Il atteste de la réception de votre déclaration, sans préjuger de son éligibilité ni d’un remboursement.</p>
            <dl>
              <div><dt>Référence</dt><dd>{receipt.requestNumber}</dd></div>
              <div><dt>Reçue le</dt><dd>{new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "long", timeZone: "Europe/Paris" }).format(receipt.receivedAt)}</dd></div>
              <div><dt>Contrat déclaré</dt><dd>{receipt.contractType === "MUSIC_ORDER" ? "Création musicale" : receipt.contractType === "DIGITAL_ORDER" ? "Musique numérique" : "Boutique physique"}</dd></div>
              <div><dt>Commande déclarée</dt><dd>{receipt.claimedOrderReference}</dd></div>
              <div><dt>Demandeur</dt><dd>{receipt.claimantFirstName} {receipt.claimantLastName}</dd></div>
              <div><dt>E-mail</dt><dd>{maskEmail(receipt.claimantEmail)}</dd></div>
              <div><dt>Produit ou prestation</dt><dd>{receipt.productDescription}</dd></div>
              {receipt.quantity ? <div><dt>Quantité</dt><dd>{receipt.quantity}</dd></div> : null}
              <div><dt>Empreinte de preuve</dt><dd><code>{receipt.acknowledgementHashSha256.slice(0, 16)}…</code></dd></div>
            </dl>
            <blockquote>{receipt.declarationText}</blockquote>
            <a className="button" href="/retractation/confirmation/accuse">Télécharger mon accusé durable (.txt)</a>
            <p>Le fichier contient votre déclaration et sa date et heure de réception. Il est disponible immédiatement, sans attendre l’examen de la demande.</p>
            {receipt.contractType === "DIGITAL_ORDER" ? <p>E-mail : {receipt.digitalAcknowledgements.some(n => n.status === "SENT" || n.status === "DELIVERED") ? "envoi enregistré par le transport" : receipt.digitalAcknowledgements.some(n => n.status === "CAPTURED_QA") ? "capturé en QA uniquement — aucun envoi ni remise réelle démontrés" : "accusé placé dans la file durable ; transport QA non délivrant"}. Le téléchargement ci-dessus reste disponible indépendamment de la file.</p> : <p>L’accusé est archivé dans le dossier. Son éventuel envoi e-mail est distinct de sa disponibilité immédiate ici.</p>}
          </article>
        ) : <p>Pour protéger les données de commande, aucun détail n’est affiché sans le cookie d’accusé opaque créé lors de l’envoi.</p>}
        <Link className="button button--secondary" href="/retractation">Retour à l’information sur la rétractation</Link>
      </Container>
    </section>
  );
}
