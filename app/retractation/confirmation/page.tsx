import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";

import { Container } from "@/components/container";
import { ContractLanguageNotice, T } from "@/components/site-language";
import { OriginalName } from "@/components/original-name";
import { getSiteLocale, serverDate, serverT } from "@/lib/i18n/server";
import { getWithdrawalReceipt } from "@/lib/legal/withdrawal";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Accusé de réception", robots: { index: false, follow: false }, referrer: "no-referrer" };

function maskEmail(value: string) {
  const [local = "", domain = ""] = value.split("@");
  return `${local.slice(0, 2)}${"•".repeat(Math.max(3, Math.min(8, local.length - 2)))}@${domain}`;
}

export default async function WithdrawalConfirmationPage() {
  const locale = await getSiteLocale();
  const t = (source: string) => serverT(locale, source);
  const token = (await cookies()).get("lnx-withdrawal-receipt")?.value;
  const receipt = await getWithdrawalReceipt(token).catch(() => null);
  return (
    <section className="withdrawal-page withdrawal-page--confirmation">
      <Container className="withdrawal-page__container">
        <p className="eyebrow"><T text="Accusé de réception"/></p>
        <h1>{t(receipt ? "Votre déclaration a été enregistrée." : "Accusé indisponible.")}</h1>
        <ContractLanguageNotice/>
        {receipt ? (
          <article className="withdrawal-receipt">
            <p><T text="Conservez ou imprimez cet accusé. Il atteste de la réception de votre déclaration, sans préjuger de son éligibilité ni d’un remboursement."/></p>
            <dl>
              <div><dt><T text="Référence"/></dt><dd translate="no">{receipt.requestNumber}</dd></div>
              <div><dt><T text="Reçue le"/></dt><dd>{serverDate(locale, receipt.receivedAt, { dateStyle: "long", timeStyle: "long" })}</dd></div>
              <div><dt><T text="Contrat déclaré"/></dt><dd>{t(receipt.contractType === "MUSIC_ORDER" ? "Création musicale" : receipt.contractType === "DIGITAL_ORDER" ? "Musique numérique" : "Boutique physique")}</dd></div>
              <div><dt><T text="Commande déclarée"/></dt><dd translate="no">{receipt.claimedOrderReference}</dd></div>
              <div><dt><T text="Demandeur"/></dt><dd><OriginalName>{receipt.claimantFirstName} {receipt.claimantLastName}</OriginalName></dd></div>
              <div><dt><T text="E-mail"/></dt><dd translate="no">{maskEmail(receipt.claimantEmail)}</dd></div>
              <div><dt><T text="Produit ou prestation"/></dt><dd translate="no">{receipt.productDescription}</dd></div>
              {receipt.quantity ? <div><dt><T text="Quantité"/></dt><dd>{receipt.quantity}</dd></div> : null}
              <div><dt><T text="Empreinte de preuve"/></dt><dd><code translate="no">{receipt.acknowledgementHashSha256.slice(0, 16)}…</code></dd></div>
            </dl>
            <blockquote lang="fr" translate="no">{receipt.declarationText}</blockquote>
            <a className="button" href="/retractation/confirmation/accuse"><T text="Télécharger mon accusé durable (.txt)"/></a>
            <p><T text="Le fichier contient votre déclaration et sa date et heure de réception. Il est disponible immédiatement, sans attendre l’examen de la demande."/></p>
            <p className="field__hint"><T text="L’accusé durable téléchargé et la déclaration originale restent en français ; la langue d’affichage ne modifie aucune preuve."/></p>
            {receipt.contractType === "DIGITAL_ORDER" ? <p><T text="E-mail"/> : {t(receipt.digitalAcknowledgements.some(n => n.status === "SENT" || n.status === "DELIVERED") ? "envoi enregistré par le transport" : receipt.digitalAcknowledgements.some(n => n.status === "CAPTURED_QA") ? "capturé en QA uniquement — aucun envoi ni remise réelle démontrés" : "accusé placé dans la file durable ; transport QA non délivrant")}. <T text="Le téléchargement ci-dessus reste disponible indépendamment de la file."/></p> : <p><T text="L’accusé est archivé dans le dossier. Son éventuel envoi e-mail est distinct de sa disponibilité immédiate ici."/></p>}
          </article>
        ) : <p><T text="Pour protéger les données de commande, aucun détail n’est affiché sans le cookie d’accusé opaque créé lors de l’envoi."/></p>}
        <Link className="button button--secondary" href="/retractation"><T text="Retour à l’information sur la rétractation"/></Link>
      </Container>
    </section>
  );
}
