import Link from "next/link";
import Image from "next/image";
import { Container } from "@/components/container";
import { OriginalName } from "@/components/original-name";
import { T } from "@/components/site-language";
import { UiIcon } from "@/components/ui-icon";
import { PremiereCountdown } from "@/components/premiere-countdown";
import { PremiereStage } from "@/components/premiere-stage";
import { PremiereVote } from "@/components/premiere-vote";
import { ReleaseAlertPreferences } from "@/components/release-alert-preferences";
import { DigitalAlbumOffer, DigitalTracklist, type DigitalProjectView } from "@/components/digital-catalog";
import { DigitalCartNavigation, DigitalDemoBanner } from "@/components/digital-navigation";
import type { DigitalUiMode } from "@/components/digital-mode-copy";
import styles from "@/app/avant-premieres/premieres.module.css";

export type PremiereShowcaseProject = {
  id: string; slug: string; title: string; type: "ALBUM" | "SINGLE";
  releaseDate: string; coverUrl: string; description: string | null; trackCount: number;
  digital: DigitalProjectView | null;
  /** Present only after the existing exact member-publication gate. */
  voteBinding?: string;
};
export type PremiereExperienceProps = {
  projects: readonly PremiereShowcaseProject[];
  access: "member" | "verify-email" | "guest";
  initialNow: number;
  mode: DigitalUiMode;
};

export function PremiereExperience({ projects, access, initialNow, mode }: PremiereExperienceProps) {
  const featured = projects[0], member = access === "member";
  const accessHref = access === "verify-email" ? "/renvoyer-verification" : "/connexion?retour=%2Favant-premieres";
  const accessLabel = access === "verify-email" ? "Vérifier mon e-mail" : "Se connecter";
  return <PremiereStage className={styles.experience}>
    <div className={styles.ambient} aria-hidden="true"><span /><span /></div>
    <Container className={styles.page}>
      <DigitalDemoBanner mode={mode} />
      <header className={styles.hero}>
        <div className={styles.heroCopy}>
          <p className={styles.kicker}><span className={styles.liveDot} aria-hidden="true" /><T text="Le cercle LNX Beats" /></p>
          <h1><T text="Avant-premières" /><span className={styles.titleDot}>.</span></h1>
          <p className={styles.statement}><T text="Avant les plateformes." /><br /><span><T text="Au plus près de la musique." /></span></p>
          <p className={styles.intro}><T text="Écoutez les prochaines sorties, donnez votre avis et emportez vos titres préférés avant leur arrivée sur les plateformes." /></p>
          <div className={styles.heroActions}><Link className={styles.primaryAction} href={featured ? `#${featured.slug}` : "#les-sorties"}><UiIcon name="headphones" /><T text="Découvrir les avant-premières" /><UiIcon name="arrow-right" /></Link><Link className={styles.quietAction} href="#mes-alertes"><UiIcon name="mail" /><T text="Mes alertes nouveautés" /></Link></div>
          <p className={styles.accessNote}><UiIcon name="users" /><T text="Compte gratuit pour écouter et voter. Aucun achat obligatoire." /></p>
        </div>
        <div className={styles.heroArt}>
          <div className={styles.artGrid} aria-hidden="true" />
          {featured ? <><div className={styles.spotlightCover}><span className={styles.coverGlint} aria-hidden="true" /><Image src={featured.coverUrl} alt={featured.title} width={680} height={680} sizes="(max-width: 780px) 78vw, 42vw" unoptimized priority /><span className={styles.coverEdge} aria-hidden="true" /></div><div className={styles.artCaption}><span><T text="À découvrir maintenant" /></span><strong><OriginalName>{featured.title}</OriginalName></strong><span><OriginalName>LNX Beats Studio</OriginalName> · <T text={featured.type === "ALBUM" ? "Album" : "Single"} /></span></div></> : <div className={styles.emptyArt} aria-hidden="true"><UiIcon name="headphones" /><span>LNX BEATS</span></div>}
        </div>
      </header>
      <div className={styles.experienceStrip}><span><b>01</b><UiIcon name="headphones" /><T text="Écoutez en premier" /></span><span><b>02</b><UiIcon name="heart" /><T text="Faites entendre votre avis" /></span><span><b>03</b><UiIcon name="bag" /><T text="Téléchargez sans attendre" /></span></div>
      <section id="les-sorties" className={styles.releases} aria-labelledby="premiere-releases-title">
        <div className={styles.sectionHeading}><div><p className={styles.kicker}><T text="Le salon d’écoute" /></p><h2 id="premiere-releases-title"><T text="La suite s’écoute ici." /></h2></div><span className={styles.editionCount}><T text={projects.length === 1 ? "{count} avant-première" : "{count} avant-premières"} values={{ count: projects.length }} /></span></div>
        {!projects.length ? <div className={styles.empty}><UiIcon name="music" /><h3><T text="La prochaine écoute se prépare." /></h3><p><T text="Retrouvez les sorties disponibles dans la discographie et choisissez vos alertes pour la suite." /></p><Link className={styles.primaryAction} href="/discographie"><T text="Écouter la discographie" /><UiIcon name="arrow-right" /></Link></div> : projects.map(project => {
          const listeningAllowed = member && !!project.voteBinding;
          const hasPurchase = !!project.digital?.album || !!project.digital?.tracks.some(track => track.offer);
          return <article id={project.slug} className={styles.release} key={project.id}>
            <header className={styles.releaseHeader}><Image className={styles.releaseCover} src={project.coverUrl} alt={project.title} width={180} height={180} sizes="(max-width: 600px) 76px, 132px" unoptimized /><div className={styles.releaseIdentity}><p className={styles.kicker}><T text={project.type === "ALBUM" ? "Album en avant-première" : "Single en avant-première"} /></p><h3><OriginalName>{project.title}</OriginalName></h3><p><OriginalName>LNX Beats Studio</OriginalName><span aria-hidden="true"> / </span><T text={project.trackCount === 1 ? "{count} titre" : "{count} titres"} values={{ count: project.trackCount }} /></p></div><Link className={styles.projectLink} href={`/album/${project.slug}`}><T text="Voir la fiche" /><UiIcon name="arrow-up-right" /></Link></header>
            <div className={styles.releaseBody}>
              <div className={styles.listeningColumn}>
                {project.description ? <p className={styles.description}><OriginalName>{project.description}</OriginalName></p> : null}
                {!listeningAllowed ? <div className={styles.memberGate}><span className={styles.gateIcon}><UiIcon name="headphones" /></span><div><h4><T text="Votre place au premier rang." /></h4><p><T text="Connectez-vous pour écouter les extraits et voter sur les prochaines sorties." /></p><div className={styles.gateActions}><Link className={styles.primaryAction} href={accessHref}><T text={accessLabel} /><UiIcon name="arrow-right" /></Link>{access === "guest" ? <Link className={styles.quietAction} href="/inscription?retour=%2Favant-premieres"><T text="Créer mon compte gratuit" /></Link> : null}</div></div></div> : null}
                {project.digital ? <div className={styles.listeningRoom}><DigitalTracklist view={project.digital} mode={mode} headingId={`premiere-tracks-${project.slug}`} /></div> : <p className={styles.notice}><T text="Les offres sont proposées uniquement lorsqu’elles sont disponibles." /></p>}
                {listeningAllowed ? <div className={styles.voteRoom}><PremiereVote projectId={project.id} binding={project.voteBinding!} /></div> : <div className={styles.voteInvitation}><div><p className={styles.kicker}><T text="Votre avis compte" /></p><p><T text="Plutôt oui ou pas encore ? Écoutez, puis choisissez." /></p></div><div className={styles.voteIllustration} aria-hidden="true"><span>👍</span><span>👎</span></div></div>}
              </div>
              <aside className={styles.releaseAside}>
                <div className={styles.countdownPanel}><span className={styles.panelIndex}>01 / <T text="La sortie" /></span><PremiereCountdown releaseDate={project.releaseDate} initialNow={initialNow} /></div>
                {hasPurchase ? <div className={styles.purchasePanel}><span className={styles.panelIndex}>02 / <T text="Déjà pour vous" /></span><h4><T text="Pas besoin d’attendre." /></h4>{project.digital?.album ? <DigitalAlbumOffer album={project.digital.album} /> : <p><T text="Choisissez votre titre dans le lecteur." /></p>}<p className={styles.purchaseNote}><UiIcon name="bag" /><T text="Paiement et téléchargement immédiats. Les fichiers achetés sont complets, pas les extraits." /></p></div> : null}
                <p className={styles.notice}><T text="Extraits de 60 secondes maximum. Les formats disponibles sont précisés avant l’achat." /></p>
              </aside>
            </div>
          </article>;
        })}
      </section>
      <section id="mes-alertes" className={styles.alerts} aria-labelledby="premiere-alert-title"><div className={styles.alertCopy}><span className={styles.alertIcon}><UiIcon name="mail" /></span><p className={styles.kicker}><T text="Gardons le contact" /></p><h2 id="premiere-alert-title"><T text="La prochaine histoire." /><br /><span><T text="Dans votre boîte mail." /></span></h2><p><T text="Musique, Boutique ou actualités : choisissez ce qui vous intéresse. Vos préférences restent modifiables à tout moment." /></p></div><div className={styles.alertControls}>{member ? <ReleaseAlertPreferences /> : <><h3><T text="Vos alertes, votre choix." /></h3><p><T text="Connectez-vous pour choisir les nouveautés que vous souhaitez recevoir." /></p><Link className={styles.primaryAction} href={accessHref}><T text={accessLabel} /><UiIcon name="arrow-right" /></Link><p className={styles.notice}><T text="Aucun abonnement automatique. Désinscription possible dans chaque e-mail." /></p></>}</div></section>
      <div className={styles.bottomNav}><Link href="/discographie"><UiIcon name="disc" /><T text="Toute la discographie" /><UiIcon name="arrow-right" /></Link><DigitalCartNavigation /></div>
    </Container>
  </PremiereStage>;
}
