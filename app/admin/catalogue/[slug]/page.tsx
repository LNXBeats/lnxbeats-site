import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { CatalogEditGuard, CatalogSubmitButton } from "@/components/catalog-edit-guard";
import { CatalogAudioForm } from "@/components/catalog-audio-form";
import { CatalogCoverForm } from "@/components/catalog-cover-form";
import { CatalogPlatformLinkFields } from "@/components/catalog-platform-link-fields";
import { requireAdmin } from "@/lib/auth/session";
import { catalogCoverAltOverride, resolveCatalogCoverAlt } from "@/lib/catalog/cover-alt";
import { deriveCatalogConfidence, projectCompletenessLabel } from "@/lib/catalog/confidence";
import { platformLabelOverride, platformName, resolvePlatformLabel } from "@/lib/catalog/platform-label";
import { catalogSeoMode, effectiveCatalogSeoDescription, effectiveCatalogSeoTitle } from "@/lib/catalog/seo";
import { getAdminCatalogProject } from "@/lib/catalog/service";
import type { DataConfidence, PlatformId, ProjectDataConfidence } from "@/lib/catalog/types";
import {
  addCatalogCreditAction, addCatalogLinkAction, addCatalogTrackAction, deleteCatalogCoverAction, deleteCatalogCreditAction, deleteCatalogLinkAction, deleteCatalogTrackAction,
  moveCatalogTrackAction, saveCatalogLinkAction,
  saveCatalogCreditAction, saveCatalogProjectAction, saveCatalogTrackAction,
} from "@/app/admin/catalogue/actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Modifier le catalogue" };

const feedback: Record<string, string> = {
  "projet-enregistre": "Les informations du projet sont enregistrées.", "projet-refuse": "Enregistrement refusé. Rechargez la fiche et vérifiez les valeurs.",
  "piste-ajoutee": "La piste est ajoutée.", "piste-enregistree": "La piste est enregistrée.", "piste-supprimee": "La piste est supprimée.", "piste-refusee": "La piste n’a pas été modifiée.",
  "ordre-enregistre": "L’ordre des pistes est enregistré.", "ordre-refuse": "Le déplacement n’a pas été appliqué.",
  "credit-ajoute": "Le crédit est ajouté.", "credit-enregistre": "Le crédit est enregistré.", "credit-supprime": "Le crédit est supprimé.", "credit-refuse": "Le crédit n’a pas été modifié.",
  "lien-ajoute": "Le lien est ajouté.", "lien-enregistre": "Le lien est enregistré.", "lien-supprime": "Le lien est supprimé.", "lien-refuse": "Le lien n’a pas été modifié.",
  "cover-enregistree": "Cover enregistrée.",
  "cover-trop-lourde": "Le fichier dépasse la limite de 10 Mo.",
  "cover-format": "Format non pris en charge. Utilisez un JPEG, PNG ou WebP authentique.",
  "cover-illisible": "Cette image n’a pas pu être lue.",
  "cover-dimensions": "Cette image dépasse la limite de 40 millions de pixels.",
  "cover-vide": "Sélectionnez une image avant de continuer.",
  "cover-droits": "Confirmez les droits de publication avant de continuer.",
  "cover-conflit": "La cover a été modifiée depuis l’ouverture de cette fiche.",
  "cover-invalide": "La demande d’envoi est invalide. Sélectionnez de nouveau l’image.",
  "cover-erreur": "Impossible d’enregistrer la cover. Réessayez.",
  "cover-supprimee": "La cover est supprimée. Le visuel de repli public est de nouveau utilisé.",
  "cover-suppression-refusee": "La cover n’a pas été supprimée. Rechargez la fiche pour vérifier son état actuel.",
  "suppression-refusee": "La suppression n’a pas été appliquée.",
};
const confidenceFromDb: Record<string, DataConfidence> = { CONFIRMED: "confirmed", PARTIAL: "partial", PLACEHOLDER: "placeholder", UNKNOWN: "unknown" };
const confidenceLabels: Record<DataConfidence, string> = { confirmed: "Confirmé", partial: "À compléter", placeholder: "À compléter", unknown: "À compléter" };
const platformFromDb: Record<string, PlatformId> = { SPOTIFY: "spotify", APPLE_MUSIC: "appleMusic", DEEZER: "deezer", YOUTUBE: "youtube", AMAZON_MUSIC: "amazonMusic", DISTROKID: "distroKid", OTHER: "other" };
const trackStatuses = [["RELEASED", "released", "Publié"], ["ANNOUNCED", "announced", "Annoncé"], ["UNLISTED", "unlisted", "Non listé"]] as const;
const creditRoles = [["ARTIST", "artist", "Interprétation / artiste"], ["WRITER", "writer", "Paroles / auteur"], ["COMPOSER", "composer", "Composition"], ["PRODUCER", "producer", "Production"], ["FEATURING", "featuring", "Collaboration / featuring"], ["ENGINEER", "engineer", "Ingénierie son"], ["OTHER", "other", "Autre crédit"]] as const;

function Identity({ project }: { project: { id: string; slug: string } }) {
  return <><input type="hidden" name="projectId" value={project.id} /><input type="hidden" name="slug" value={project.slug} /></>;
}
function SectionFeedback({ state, accepted }: { state?: string; accepted: readonly string[] }) {
  return state && accepted.includes(state) && feedback[state] ? <p className="admin-feedback" role="status">{feedback[state]}</p> : null;
}

export default async function AdminCatalogueEditPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ etat?: string }> }) {
  await requireAdmin();
  const { slug } = await params;
  const project = await getAdminCatalogProject(slug);
  if (!project) notFound();
  const { etat } = await searchParams;
  const annotations = new Map(project.confidenceAnnotations.map((item) => [item.domain.toLowerCase(), item.level]));
  const cover = project.assets.find(({ role }) => role === "COVER")?.asset;
  const audio = project.assets.find(({ role }) => role === "AUDIO_PREVIEW")?.asset;
  const legacyConfidence = Object.fromEntries([...annotations].map(([domain, level]) => [domain, confidenceFromDb[level] ?? "unknown"])) as Partial<ProjectDataConfidence>;
  const confidence = deriveCatalogConfidence({
    ...project,
    assets: project.assets.filter(({ role }) => role === "COVER"),
    legacy: { ...legacyConfidence, overall: confidenceFromDb[project.confidence] ?? "unknown" },
  });
  const coverAlt = cover ? resolveCatalogCoverAlt(project.title, cover.alt) : resolveCatalogCoverAlt(project.title, null);
  const coverAltOverride = cover ? catalogCoverAltOverride(cover.alt, project.title) : null;
  const projectCredits = project.credits.filter(({ trackId }) => trackId === null);
  const seoMode = catalogSeoMode(project);
  const seoStateLabel = seoMode === "custom" ? "✓ Personnalisé" : seoMode === "mixed" ? "✓ Effectif · mixte" : "✓ Automatique";

  return <div className="admin-main admin-catalogue-editor">
    <Link className="admin-back-link" href="/admin/catalogue"><span aria-hidden="true">←</span> Retour au catalogue</Link>
    <header className="admin-page-heading"><div><p className="admin-kicker">Fiche catalogue</p><h1>{project.title}</h1></div><p>Le slug reste immuable. Chaque bloc possède sa propre validation explicite.</p></header>
    <div className="admin-editor-actions"><Link className="admin-row-action" href={`/album/${project.slug}`} target="_blank" rel="noreferrer">Voir la fiche publique <span aria-hidden="true">↗</span></Link></div>
    <section className="admin-catalogue-summary" aria-label="État actuel des données">
      <div><span>Publication</span><strong>{project.status === "PUBLISHED" ? "Publié" : project.status === "IN_DEVELOPMENT" ? "En développement" : "Archivé"}</strong></div>
      <div><span>Cover</span><strong>{cover ? "Renseignée" : "Manquante"}</strong></div>
      <div><span>Extrait audio</span><strong>{audio?.durationMs ? `${Math.round(audio.durationMs / 1_000)} s` : "Facultatif"}</strong></div>
      <div><span>Date</span><strong>{project.releaseDate ? project.releaseDate.toLocaleDateString("fr-FR", { timeZone: "UTC" }) : "À compléter"}</strong></div>
      <div><span>Liens directs</span><strong>{project.platformLinks.length}</strong></div>
      <div><span>Tracklist</span><strong>{project.tracks.length ? `${project.tracks.length} nommée${project.tracks.length === 1 ? "" : "s"}` : project.trackCount ? `${project.trackCount} annoncées` : "À compléter"}</strong></div>
    </section>

    <section className="admin-detail-window">
      <p className="admin-section-label">Identité, publication et SEO</p>
      <SectionFeedback state={etat} accepted={["projet-enregistre", "projet-refuse"]} />
      <CatalogEditGuard action={saveCatalogProjectAction}>
        <Identity project={project} /><input type="hidden" name="updatedAt" value={project.updatedAt.toISOString()} />
        <div className="admin-form-grid">
          <label><span>Slug (non modifiable)</span><input value={project.slug} readOnly /></label>
          <label><span>Titre</span><input name="title" defaultValue={project.title} maxLength={240} required autoFocus={etat === "projet-refuse"} /></label>
          <label><span>Sous-titre</span><input name="subtitle" defaultValue={project.subtitle ?? ""} maxLength={240} /></label>
          <label><span>Type</span><select name="type" defaultValue={project.type.toLowerCase()}><option value="album">Album</option><option value="single">Single</option><option value="project">Projet</option></select></label>
          <label><span>Statut éditorial</span><select name="status" defaultValue={project.status === "IN_DEVELOPMENT" ? "in-development" : project.status.toLowerCase()}><option value="published">Publié</option><option value="in-development">En développement</option><option value="draft">Brouillon</option><option value="archive">Archivé</option></select></label>
          <label><span>Date de parution</span><input name="releaseDate" type="date" defaultValue={project.releaseDate?.toISOString().slice(0, 10) ?? ""} /></label>
          <label><span>Nombre de pistes annoncé</span><input name="trackCount" type="number" min="0" max="999" defaultValue={project.trackCount ?? ""} /></label>
          <label className="admin-checkbox"><input name="publicVisible" type="checkbox" defaultChecked={project.publicVisible} /><span>Visible sur le site</span></label>
          <label className="admin-checkbox"><input name="featured" type="checkbox" defaultChecked={project.featured} /><span>Mettre en avant sur l’accueil</span></label>
          <label><span>Placement dans les jukebox</span><select name="jukeboxPlacement" defaultValue={project.jukeboxPlacement === "PUBLISHED" ? "published" : project.jukeboxPlacement === "DEVELOPMENT" ? "development" : "none"}><option value="none">Aucun jukebox</option><option value="published">Jukebox publié</option><option value="development">Jukebox développement</option></select></label>
          <label><span>Position dans le jukebox</span><input name="jukeboxPosition" type="number" min="1" max="999" defaultValue={project.jukeboxPosition ?? ""} /><small>Facultatif : sans position, l’ordre du catalogue sert de repli.</small></label>
          <label className="admin-form-wide"><span>Description courte</span><textarea name="shortDescription" rows={3} maxLength={1000} defaultValue={project.shortDescription ?? ""} /></label>
          <label className="admin-form-wide"><span>Récit / présentation du projet</span><textarea name="description" rows={7} maxLength={10000} defaultValue={project.description ?? ""} /><small>Ce texte alimente le récit de la fiche publique. Laissez vide plutôt que d’ajouter une information incertaine.</small></label>
          <details className="admin-form-wide admin-secondary-fields"><summary>Référencement</summary><div><label><span>Titre SEO personnalisé</span><input name="seoTitle" maxLength={240} defaultValue={project.seoTitle ?? ""} placeholder={effectiveCatalogSeoTitle(project)} /><small>Effectif : {effectiveCatalogSeoTitle(project)}</small></label><label><span>Description SEO personnalisée</span><textarea name="seoDescription" rows={3} maxLength={1000} defaultValue={project.seoDescription ?? ""} placeholder={effectiveCatalogSeoDescription(project)} /><small>Une description éditoriale existante sert automatiquement de fallback.</small></label></div></details>
        </div>
        <CatalogSubmitButton>Enregistrer le projet</CatalogSubmitButton>
      </CatalogEditGuard>
    </section>

    <section className="admin-detail-window">
      <p className="admin-section-label">État du projet</p>
      <div className="admin-project-state-heading"><h2>{projectCompletenessLabel(confidence)}</h2><p>Ces indications évoluent automatiquement avec les données renseignées.</p></div>
      <dl className="admin-project-state-grid">
        <div><dt>Cover</dt><dd>{cover ? "✓ Renseignée" : "— À compléter"}</dd></div>
        <div><dt>Preview audio</dt><dd>{audio?.durationMs ? `✓ ${Math.round(audio.durationMs / 1_000)} secondes` : "— Facultative"}</dd></div>
        <div><dt>Date de sortie</dt><dd>{project.releaseDate ? `✓ ${project.releaseDate.toLocaleDateString("fr-FR", { timeZone: "UTC" })}` : "— À compléter"}</dd></div>
        <div><dt>Tracklist</dt><dd>{confidence.tracklist === "confirmed" ? "✓ Complète" : project.tracks.length || project.trackCount ? "Partielle" : "— À compléter"}</dd></div>
        <div><dt>Plateformes</dt><dd>{project.platformLinks.length ? `${project.platformLinks.length} lien${project.platformLinks.length === 1 ? "" : "s"} renseigné${project.platformLinks.length === 1 ? "" : "s"}` : "— À compléter"}</dd></div>
        <div><dt>SEO</dt><dd>{seoStateLabel}</dd></div>
        <div><dt>Crédits</dt><dd>{projectCredits.length ? `✓ ${projectCredits.length} renseigné${projectCredits.length === 1 ? "" : "s"}` : "— Facultatifs"}</dd></div>
      </dl>
      <details className="admin-state-details"><summary>Voir les détails</summary><dl><div><dt>Identité</dt><dd>{confidenceLabels[confidence.identity]}</dd></div><div><dt>Éditorial</dt><dd>{confidenceLabels[confidence.editorial]}</dd></div><div><dt>Genres</dt><dd>{confidenceLabels[confidence.genres]}</dd></div></dl></details>
    </section>

    <section className="admin-detail-window">
      <p className="admin-section-label">Crédits musicaux</p>
      <SectionFeedback state={etat} accepted={["credit-ajoute", "credit-enregistre", "credit-supprime", "credit-refuse", "suppression-refusee"]} />
      <p className="admin-muted">Seuls les crédits réellement renseignés apparaissent sur la fiche publique.</p>
      {projectCredits.length ? <ul className="admin-link-editor">{projectCredits.map((credit) => <li key={credit.id}>
        <div className="admin-link-summary"><strong>{creditRoles.find(([db]) => db === credit.role)?.[2] ?? "Autre crédit"}</strong><span>{credit.name}</span>{credit.note ? <small>{credit.note}</small> : null}</div>
        <div className="admin-inline-actions"><details><summary>Modifier</summary><form className="admin-catalogue-form" action={saveCatalogCreditAction}><Identity project={project} /><input type="hidden" name="creditId" value={credit.id} /><div className="admin-form-grid"><label><span>Rôle</span><select name="role" defaultValue={creditRoles.find(([db]) => db === credit.role)?.[1] ?? "other"}>{creditRoles.map(([, value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span>Nom crédité</span><input name="name" defaultValue={credit.name} maxLength={180} required /></label><label className="admin-form-wide"><span>Précision facultative</span><input name="note" defaultValue={credit.note ?? ""} maxLength={1000} placeholder="Artwork, mix, rôle précis…" /></label></div><CatalogSubmitButton>Enregistrer le crédit</CatalogSubmitButton></form></details><details><summary>Supprimer</summary><p>Le crédit disparaîtra de la fiche publique.</p><form action={deleteCatalogCreditAction}><Identity project={project} /><input type="hidden" name="creditId" value={credit.id} /><button>Confirmer la suppression</button></form></details></div>
      </li>)}</ul> : <p className="admin-muted">Aucun crédit renseigné : aucun bloc vide ne sera affiché publiquement.</p>}
      <details className="admin-add-panel"><summary>Ajouter un crédit</summary><form className="admin-catalogue-form" action={addCatalogCreditAction}><Identity project={project} /><div className="admin-form-grid"><label><span>Rôle</span><select name="role" defaultValue="artist">{creditRoles.map(([, value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span>Nom crédité</span><input name="name" maxLength={180} required /></label><label className="admin-form-wide"><span>Précision facultative</span><input name="note" maxLength={1000} placeholder="Artwork, mix, rôle précis…" /></label></div><CatalogSubmitButton>Ajouter le crédit</CatalogSubmitButton></form></details>
    </section>

    <section className="admin-detail-window">
      <p className="admin-section-label">Cover officielle</p>
      {cover ? <div className="admin-cover-preview"><Image src={`/media/catalog/${cover.id}`} alt={coverAlt} width={320} height={320} /><div><p>Cover officielle actuelle</p><Link className="admin-row-action" href={`/album/${project.slug}`} target="_blank" rel="noreferrer">Voir sur le site <span aria-hidden="true">↗</span></Link></div></div> : <p className="admin-muted">Aucune cover officielle. L’espace graphique de repli reste visible publiquement.</p>}
      <CatalogCoverForm projectId={project.id} slug={project.slug} currentCoverAssetId={cover?.id ?? null} alt={coverAltOverride ?? ""} altPlaceholder={coverAlt} hasCover={Boolean(cover)} initialState={etat?.startsWith("cover-") ? etat : undefined} />
      {cover ? <details className="admin-add-panel"><summary>Supprimer la cover actuelle</summary><p>La fiche publique utilisera son visuel de repli. Cette action ne concerne aucun fichier client privé.</p><form action={deleteCatalogCoverAction}><Identity project={project} /><input type="hidden" name="expectedCoverAssetId" value={cover.id} /><button className="admin-danger-action">Confirmer la suppression de la cover</button></form></details> : null}
    </section>

    <section className="admin-detail-window">
      <p className="admin-section-label">Preview audio</p>
      <CatalogAudioForm
        projectId={project.id}
        slug={project.slug}
        title={project.title}
        currentAudioAssetId={audio?.id ?? null}
        durationMs={audio?.durationMs ?? null}
        updatedAt={audio?.updatedAt.toISOString() ?? null}
        initialState={etat?.startsWith("audio-") ? etat : undefined}
      />
    </section>

    <section className="admin-detail-window">
      <p className="admin-section-label">Tracklist</p>
      <SectionFeedback state={etat} accepted={["piste-ajoutee", "piste-enregistree", "piste-supprimee", "piste-refusee", "ordre-enregistre", "ordre-refuse", "suppression-refusee"]} />
      {project.tracks.length ? <ol className="admin-track-editor">{project.tracks.map((track, index) => <li key={track.id}>
        <form action={saveCatalogTrackAction}><Identity project={project} /><input type="hidden" name="trackId" value={track.id} /><label><span>Titre {index + 1}</span><input name="title" defaultValue={track.title} maxLength={240} required /></label><label><span>Durée réelle (secondes)</span><input name="durationSeconds" type="number" min="0" max="86400" defaultValue={track.durationSeconds ?? ""} /><small>Laisser vide si elle est inconnue.</small></label><label><span>Statut</span><select name="status" defaultValue={trackStatuses.find(([db]) => db === track.status)?.[1]}>{trackStatuses.map(([, value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><CatalogSubmitButton>Enregistrer</CatalogSubmitButton></form>
        <div className="admin-inline-actions"><form action={moveCatalogTrackAction}><Identity project={project} /><input type="hidden" name="trackId" value={track.id} /><button name="direction" value="up" disabled={index === 0}>Monter</button><button name="direction" value="down" disabled={index === project.tracks.length - 1}>Descendre</button></form><details><summary>Supprimer</summary><p>Cette piste sera retirée du projet.</p><form action={deleteCatalogTrackAction}><Identity project={project} /><input type="hidden" name="trackId" value={track.id} /><button>Confirmer la suppression</button></form></details></div>
      </li>)}</ol> : <p className="admin-muted">Aucune piste nommée. Le nombre annoncé reste indépendant.</p>}
      <details className="admin-add-panel"><summary>Ajouter une piste</summary><form className="admin-catalogue-form" action={addCatalogTrackAction}><Identity project={project} /><div className="admin-form-grid"><label><span>Titre</span><input name="title" maxLength={240} required /></label><label><span>Durée réelle (secondes)</span><input name="durationSeconds" type="number" min="0" max="86400" /><small>Laisser vide si elle est inconnue.</small></label><label><span>Statut</span><select name="status" defaultValue="announced">{trackStatuses.map(([, value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div><CatalogSubmitButton>Ajouter la piste</CatalogSubmitButton></form></details>
    </section>

    <section className="admin-detail-window">
      <p className="admin-section-label">Liens de sortie</p>
      <SectionFeedback state={etat} accepted={["lien-ajoute", "lien-enregistre", "lien-supprime", "lien-refuse", "suppression-refusee"]} />
      <p className="admin-muted">Les profils artiste globaux restent gérés séparément et ne sont pas dupliqués ici.</p>
      {project.platformLinks.length ? <ul className="admin-link-editor">{project.platformLinks.map((link) => { const platform = platformFromDb[link.platform] ?? "other"; const scope = link.scope === "STORE" ? "store" as const : "release" as const; const override = platformLabelOverride(link.label, platform, scope); return <li key={link.id}><div className="admin-link-summary"><strong>{platformName(platform)}</strong><span>{resolvePlatformLabel(link.label, platform, scope)}</span><small>{link.url}</small></div><div className="admin-inline-actions"><details><summary>Modifier</summary><form className="admin-catalogue-form" action={saveCatalogLinkAction}><Identity project={project} /><input type="hidden" name="linkId" value={link.id} /><CatalogPlatformLinkFields initialPlatform={platform} initialScope={scope} initialUrl={link.url} initialOverride={override ?? ""} /><CatalogSubmitButton>Enregistrer</CatalogSubmitButton></form></details><details><summary>Supprimer</summary><form action={deleteCatalogLinkAction}><Identity project={project} /><input type="hidden" name="linkId" value={link.id} /><button>Confirmer la suppression</button></form></details></div></li>; })}</ul> : <p className="admin-muted">Aucun lien de sortie documenté.</p>}
      <details className="admin-add-panel"><summary>Ajouter un lien de sortie</summary><form className="admin-catalogue-form" action={addCatalogLinkAction}><Identity project={project} /><CatalogPlatformLinkFields /><CatalogSubmitButton>Ajouter le lien</CatalogSubmitButton></form></details>
    </section>
  </div>;
}
