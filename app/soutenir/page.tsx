
import { T } from "@/components/site-language";
import { OriginalName } from "@/components/original-name";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container } from "@/components/container";
import { SupportForm } from "@/components/support-form";
import styles from "@/components/support.module.css";
import { isSupportEnabled, supportLimits, supportMode } from "@/lib/support/config";
import { createPublicPageMetadata } from "@/lib/seo/metadata";
import { supportProviderPresentation } from "./provider-presentation";

export const dynamic = "force-dynamic";
export function generateMetadata(): Metadata {
  if (!isSupportEnabled()) return { title: "Soutenir LNX Beats", robots: { index: false, follow: false } };
  return createPublicPageMetadata({ title: "Soutenir LNX Beats — Soutien libre à la création musicale", description: "Un soutien libre, volontaire et sans contrepartie au travail de LNX Beats. Aucun reçu fiscal ni réduction d’impôt.", pathname: "/soutenir" });
}

export default function SupportPage() {
  if (!isSupportEnabled()) notFound();
  return <section className={styles.hero}><Container>
    <div className={styles.layout}>
      <div className={styles.intro}>
        <p className="eyebrow"><T text="Prolonger l’histoire"/></p>
        <h1><T text="Soutenir" /><br /><OriginalName>LNX Beats.</OriginalName></h1>
        <p className={styles.subtitle}><T text="Un soutien libre, sans contrepartie."/></p>
        <p><T text="Si vous aimez le travail de LNX Beats et souhaitez contribuer à son développement, vous pouvez laisser un soutien du montant de votre choix." /></p>
        <p><T text="Ce soutien est volontaire. Il ne correspond à aucun achat ou prestation, n’accorde aucun avantage, aucune priorité ni aucun droit particulier." /></p>
        <p className={styles.legal}><strong><T text="Ce soutien n’ouvre droit à aucun reçu fiscal ni à aucune réduction d’impôt." /></strong><br /><T text="Il reste indépendant de toute commande musicale et de tout achat dans la Boutique." /></p>
      </div>
      <div className={styles.panel}>
        {supportMode() === "TEST" ? <span className={styles.test}><T text="Préversion · paiements de test uniquement" /></span> : null}
        <SupportForm {...supportLimits()} {...supportProviderPresentation()} mode={supportMode() ?? "TEST"} />
        <p className={styles.legal}><T text="Une question ou une demande de remboursement volontaire ?" /> <Link href="/contact"><T text="Contactez LNX Beats." /></Link> <T text="Aucune promesse de non-remboursement absolu." /></p>
      </div>
    </div>
    <div className={styles.notes}>
      <div><h2><T text="À votre initiative" /></h2><p><T text="Un geste ponctuel. Aucun abonnement, aucun objectif imposé, aucune relance marketing liée à votre soutien." /></p></div>
      <div><h2><T text="Sans contrepartie" /></h2><p><T text="Pas de réduction, de contenu exclusif, de droit artistique ou de priorité de traitement." /></p></div>
      <div><h2><T text="En toute discrétion" /></h2><p><T text="Aucun classement public des soutiens. Une confirmation de paiement distincte d’une facture de vente et d’un reçu fiscal." /></p></div>
    </div>
  </Container></section>;
}
