import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { requireDigitalEnvironment } from "@/lib/digital/domain";
import { digitalAdminExcerptReady, digitalSalesReadiness } from "@/lib/digital/admin";
import { digitalCommercialAudioReady } from "@/lib/digital/formats";
import { DigitalOfferForm, DigitalBatchUpload, DigitalTrackEditor, DigitalAdminPreview } from "@/components/digital-admin";
import { DigitalRightsReview } from "@/components/digital-rights-review";
import { DigitalMasterEquivalences } from "@/components/digital-master-equivalences";
import { loadDigitalRightsReviews, loadProjectDigitalRightsHistory } from "@/lib/digital/rights-review-service";
import styles from "@/components/digital.module.css";
import admin from "@/components/digital-admin.module.css";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Offres et pistes numériques", robots: { index: false, follow: false } };
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  try { requireDigitalEnvironment(); } catch { notFound(); }
  await requireAdmin(); const { slug } = await params;
  const p = await prisma.project.findUnique({ where: { slug }, include: { digitalOffers: true,
    credits: { orderBy: [{ position: "asc" }, { id: "asc" }] },
    assets: { where: { role: "COVER" }, orderBy: [{ position: "asc" }, { createdAt: "desc" }], take: 1, include: { asset: true } },
    tracks: { orderBy: [{ position: "asc" }, { id: "asc" }], include: { digitalMasters: { where: { status: "READY", previewAssetId: { not: null } }, orderBy: { version: "desc" }, take: 1, include: { masterAsset: true, mp3Asset: true, previewAsset: true } } } } } });
  if (!p) notFound();
  const currentMasters = p.tracks.flatMap(track=>track.digitalMasters);
  const rightsReviews = await loadDigitalRightsReviews(prisma,currentMasters);
  const rightsHistory = await loadProjectDigitalRightsHistory(prisma,p.id);
  const tracks = p.tracks.map(t => {
    const m = t.digitalMasters[0];
    return { id: t.id, title: t.title, position: t.position, publication: t.status, durationSeconds: t.durationSeconds, version: m?.version ?? 0, previewStartMs: m?.previewStartMs ?? 0, previewDurationMs: m?.previewDurationMs ?? null,
      previewUrl: m?.previewAsset && digitalAdminExcerptReady(m) ? `/api/admin/digital/previews/${m.previewAsset.id}` : null,
      mp3Ready:!!m?.mp3Asset&&m.mp3Asset.visibility==="PRIVATE"&&m.mp3Asset.mimeType==="audio/mpeg",mp3BitrateKbps:m?.mp3BitrateKbps??null,
      masterReady: !!m && digitalCommercialAudioReady(m), mediaCleared: !!m && rightsReviews.find(review=>review.masterId===m.id)?.status==="APPROVED" && m?.masterAsset.rightsStatus === "CLEARED" && m?.mp3Asset?.rightsStatus==="CLEARED"&&m?.previewAsset?.visibility === "PUBLIC" && m.previewAsset.rightsStatus === "CLEARED",
      offer: p.digitalOffers.find(o => o.trackId === t.id) ?? null };
  });
  const albumOffer = p.digitalOffers.find(o => o.scope === "ALBUM") ?? null;
  const readiness = digitalSalesReadiness(p, tracks, albumOffer);
  const money = (value: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(value / 100);
  const cover = p.assets[0]?.asset;
  const creditLabels: Record<string, string> = { ARTIST: "Artiste", WRITER: "Auteur", COMPOSER: "Composition", PRODUCER: "Production", FEATURING: "Collaboration", ENGINEER: "Ingénierie son", OTHER: "Autre crédit" };
  return <div className={`admin-main ${admin.workflow}`}><Link className="admin-row-action" href="/admin/musique">Retour musique numérique</Link>
    <header className="admin-page-heading"><div><p className="admin-kicker">DCN‑1.2 · TEST</p><h1>{p.title}</h1></div><div className={admin.toolbar}><Link className="admin-row-action" href={`/admin/catalogue/${slug}`}>Identité, cover et publication Catalogue</Link><a className="admin-row-action" href="#edition-preview">Prévisualiser avant publication</a>{p.publicVisible && p.status === "PUBLISHED" ? <Link className="admin-row-action" href={`/album/${slug}`} target="_blank" rel="noreferrer">Voir la fiche publique</Link> : <span>Fiche publique masquée</span>}</div></header>
    <p className={admin.banner}>Préparation locale / TEST — aucun paiement réel, aucune ouverture LIVE. Aucun prix de fixture ne vaut tarif approuvé. Les versions et compositions déjà acquises restent inchangées.</p>
    <section id="edition-preview" className={styles.panel} aria-labelledby="edition-preview-heading"><h2 id="edition-preview-heading">Prévisualisation privée de l’édition</h2><p className={styles.muted}>Accessible aux administrateurs, même en brouillon ou sans approbation des droits. Cette lecture ne publie rien, n’approuve aucun droit et n’active aucune offre. Les extraits ci-dessous passent par une route authentifiée sans cache partagé.</p>
      <div className={admin.fields}><div>{cover ? <Image unoptimized src={`/api/admin/digital/covers/${cover.id}`} alt={cover.alt || `Pochette de ${p.title}`} width={240} height={240} style={{ maxWidth: "100%", height: "auto" }} /> : <p>Cover à ajouter dans le Catalogue.</p>}</div><div><h3>{p.title}</h3>{p.subtitle ? <p>{p.subtitle}</p> : null}<p>{p.type === "ALBUM" ? "Album" : p.type === "SINGLE" ? "Single" : "Projet"} · {p.releaseDate ? p.releaseDate.toLocaleDateString("fr-FR", { timeZone: "UTC" }) : "Date non renseignée"}</p><p>{p.shortDescription || p.description || "Description à compléter dans le Catalogue."}</p><p>Crédits : {p.credits.length ? p.credits.map(credit => `${credit.name} (${creditLabels[credit.role] || credit.role})`).join(" · ") : "à compléter dans le Catalogue"}</p><p>Offre album : {albumOffer?.priceCents ? money(albumOffer.priceCents) : "prix non fixé"} · {albumOffer?.active ? "active en TEST, sous réserve des contrôles" : "inactive"} · {!albumOffer ? "distribution à renseigner" : albumOffer.distribution === "DISTRIBUTED" ? "distribué sur plateformes" : "inédit / non distribué"}</p><p>Livraison prévue après achat autorisé : WAV original + MP3 privé par piste ; ZIP WAV et ZIP MP3 distincts pour l’album. Cette prévisualisation ne fournit aucun fichier complet.</p></div></div>
      <ol>{tracks.map(track => <li key={track.id} className={admin.track}><h3>{track.position}. {track.title}</h3><p>{track.publication === "RELEASED" ? "Incluse dans la composition prévue si le projet est public" : "Exclue de l’album vendu — annoncée ou non listée"} · Master : {track.version ? `V${track.version}` : "à importer"} · Prix piste : {track.offer?.priceCents ? money(track.offer.priceCents) : "non fixé"} · Offre {track.offer?.active ? "active TEST" : "inactive"}</p><p>Début d’extrait : {(track.previewStartMs / 1000).toFixed(3)} s · Durée : {track.previewDurationMs ? `${(track.previewDurationMs / 1000).toFixed(2)} s` : "à préparer"} · Droits de cette version utilisables pour la vente : {track.mediaCleared ? "prêts" : "à compléter"}</p>{track.previewUrl ? <DigitalAdminPreview src={track.previewUrl} title={track.title} /> : <p>Extrait borné non disponible.</p>}</li>)}</ol>
    </section>
    <section className={styles.panel} aria-labelledby="readiness"><h2 id="readiness">Préparation à la vente</h2><div className={admin.summary}><div><span>Publication projet</span><strong>{p.status === "PUBLISHED" && p.publicVisible ? "Publié et visible" : "Non public"}</strong></div><div><span>Pistes publiées / nommées</span><strong>{readiness.releasedTrackCount} / {tracks.length}</strong></div><div><span>Masters + extraits prêts</span><strong>{readiness.preparedTrackCount} / {readiness.releasedTrackCount}</strong></div><div><span>Offre album vendable TEST</span><strong>{readiness.albumReady ? `${readiness.includedTrackCount} pistes incluses` : "À compléter"}</strong></div></div>
      <p className={styles.muted}>L’offre album contient exactement les pistes publiées disposant des médias requis et validés intégralement. Une piste annoncée ou non listée n’augmente pas le contenu vendu. La distribution sur Spotify ou Apple Music n’est pas une condition de vente. Une ancienne version non qualifiée pour de nouvelles ventes reste conservée pour ses acquisitions existantes ; ne modifiez pas sa preuve pour l’activer.</p>
      {readiness.albumMoreExpensive ? <p className={admin.advisory} role="status">Attention : l’album ({money(albumOffer!.priceCents!)}) dépasse la somme des mêmes pistes vendables séparément ({money(readiness.individualTotalCents!)}). Le prix reste indépendant : aucune remise automatique et aucune interdiction.</p> : null}
    </section>
    <DigitalBatchUpload tracks={tracks} />
    <DigitalRightsReview projectId={p.id} tracks={p.tracks.flatMap(track=>track.digitalMasters.map(master=>({masterId:master.id,title:track.title,version:master.version,strictReady:digitalCommercialAudioReady(master),
      review:rightsReviews.find(review=>review.masterId===master.id)!})))} />
    <DigitalMasterEquivalences tracks={p.tracks.map(track => ({ id: track.id, title: track.title }))} />
    <details className={`${styles.panel} ${admin.details}`}><summary>Historique des revues de droits — {rightsHistory.entries.length} décision(s) affichée(s)</summary>
      <p>Décisions enregistrées, distinctes de l’état courant de chaque version. Les preuves et correspondances restent privées. {rightsHistory.truncated?"50 dernières décisions ; l’historique complet reste conservé dans le journal.":"Historique disponible pour ce projet."}</p>
      {!rightsHistory.entries.length?<p>Aucune revue enregistrée.</p>:<ol>{rightsHistory.entries.map(entry=><li key={entry.reviewId}><p>{new Date(entry.createdAt).toLocaleString("fr-FR")} · V{entry.masterVersion??"?"} · {entry.status}</p><p>Réviseur : {entry.reviewerId??"indisponible"}<br/>Revue : {entry.reviewId}</p></li>)}</ol>}
    </details>
    <div className={styles.panel}><DigitalOfferForm key={albumOffer?.version ?? 0} projectId={p.id} trackId={null} offer={albumOffer} label="Offre album indépendante" /></div>
    <section className={styles.panel} aria-labelledby="tracks"><h2 id="tracks">Pistes, extraits et offres individuelles</h2><p className={styles.muted}>Importez puis vérifiez chaque piste. Les pistes non publiées et les offres incomplètes ne deviennent pas achetables.</p>
      {tracks.map(t => { const diagnostic = readiness.items.find(i => i.id === t.id)!; return <article className={admin.track} key={t.id}><div className={admin.trackHeader}><h2>{t.position}. {t.title}</h2><span>{diagnostic.ready ? "Prête à la vente TEST" : "À compléter"}</span></div><p>Master : {t.version ? `version ${t.version} privée` : "à importer"} · MP3 privé : {t.mp3Ready?`${t.mp3BitrateKbps} kbit/s prêt`:"à préparer via un nouveau master WAV"} · Début d’extrait : {(t.previewStartMs / 1000).toFixed(1)} s · Extrait : {t.previewDurationMs ? `${(t.previewDurationMs / 1000).toFixed(2)} s` : "indisponible"}</p>
        {!diagnostic.ready ? <p className={styles.note}>{diagnostic.blockers.join(" · ")}</p> : null}
        {t.previewUrl ? <DigitalAdminPreview src={t.previewUrl} title={t.title} /> : null}
        <details className={admin.details}><summary>Modifier titre, publication ou ordre</summary><DigitalTrackEditor projectId={p.id} track={t} /></details>
        <DigitalOfferForm key={t.offer?.version ?? 0} projectId={p.id} trackId={t.id} offer={t.offer} label="Offre de cette piste" />
      </article>; })}
    </section>
  </div>;
}
