import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { requireVerifiedUser } from "@/lib/auth/session";
import { listMemberPremieres } from "@/lib/members/previews";
import { getSiteLocale, serverDate } from "@/lib/i18n/server";
import { OriginalName } from "@/components/original-name";
import { T } from "@/components/site-language";
import { Container } from "@/components/container";
import { PremiereVote } from "@/components/premiere-vote";
import { AddDigitalOffer, DigitalAlbumOffer } from "@/components/digital-catalog";
import { DigitalDemoBanner, DigitalCartNavigation } from "@/components/digital-navigation";
import { publicDigitalProject } from "@/lib/digital/catalog";
import { digitalRuntimeMode } from "@/lib/digital/runtime-policy";
import styles from "./premieres.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Avant-premières", robots: { index: false, follow: false } };
export default async function MemberPremieresPage() {
  const session = await requireVerifiedUser("/avant-premieres"), locale = await getSiteLocale();
  const premieres = await listMemberPremieres(session.user);
  const purchases = new Map(await Promise.all(premieres.map(async project => [project.id, await publicDigitalProject(project.slug, session.user.id)] as const)));
  return <Container className={styles.page}>
    <DigitalDemoBanner mode={digitalRuntimeMode() ?? "TEST"} /><DigitalCartNavigation />
    <p className="eyebrow"><T text="Le cercle LNX Beats" /></p>
    <h1><T text="Les avant-premières." /></h1>
    <p><T text="Des extraits réservés aux membres, publiés personnellement par LNX Beats." /></p>
    <nav className={styles.links}><Link href="/compte"><T text="Mon espace" /></Link><Link href="/compte#mes-alertes"><T text="Choisir mes alertes e-mail" /></Link><Link href="/discographie"><T text="Écouter la discographie" /></Link></nav>
    {!premieres.length ? <section className={styles.empty}><h2><T text="La prochaine écoute se prépare." /></h2><p><T text="Aucune avant-première n’est publiée pour le moment. Vous pouvez choisir vos alertes sans obligation." /></p></section> :
      <div className={styles.list}>{premieres.map(project => <article id={project.slug} className={styles.release} key={project.id}>
        <header><Image src={project.coverUrl} alt={project.title} width={160} height={160} unoptimized /><div><p className="eyebrow"><T text="Avant-première membres" /></p><h2><OriginalName>{project.title}</OriginalName></h2><p><T text="Sortie prévue sur les plateformes :" /> <time dateTime={project.releaseDate}>{serverDate(locale, new Date(`${project.releaseDate}T12:00:00Z`), { dateStyle: "long" })}</time></p></div></header>
        {purchases.get(project.id)?.album ? <DigitalAlbumOffer album={purchases.get(project.id)!.album} /> : null}
        <ol className={styles.tracks}>{project.tracks.map(track => {
          const purchase = purchases.get(project.id)?.tracks.find(item => item.id === track.id);
          return <li key={track.id}><strong><OriginalName>{track.title}</OriginalName></strong><audio controls preload="none" src={track.previewUrl} aria-label={track.title} />
            {purchase?.offer ? <AddDigitalOffer {...purchase.offer} title={track.title} owned={purchase.owned} /> : null}</li>;
        })}</ol>
        {purchases.get(project.id) ? <p><T text="Disponible ici avant la sortie sur les plateformes : paiement et téléchargement immédiats après confirmation du paiement." /></p> : null}
        <p className={styles.notice}><T text="Extraits de 60 secondes maximum. Aucun achat n’est nécessaire pour cette écoute." /></p>
        <PremiereVote projectId={project.id} binding={project.binding} />
      </article>)}</div>}
  </Container>;
}
