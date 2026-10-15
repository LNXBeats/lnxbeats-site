import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { requireDigitalEnvironment } from "@/lib/digital/domain";
import { digitalSalesReadiness } from "@/lib/digital/admin";
import { digitalCommercialAudioReady } from "@/lib/digital/formats";
import { DigitalOfferForm, DigitalBatchUpload, DigitalTrackEditor, DigitalAdminPreview } from "@/components/digital-admin";
import styles from "@/components/digital.module.css";
import admin from "@/components/digital-admin.module.css";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Offres et pistes numériques", robots: { index: false, follow: false } };
export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  try { requireDigitalEnvironment(); } catch { notFound(); }
  await requireAdmin(); const { slug } = await params;
  const p = await prisma.project.findUnique({ where: { slug }, include: { digitalOffers: true, tracks: { orderBy: [{ position: "asc" }, { id: "asc" }], include: { digitalMasters: { where: { status: "READY", previewAssetId: { not: null } }, orderBy: { version: "desc" }, take: 1, include: { masterAsset: true, mp3Asset: true, previewAsset: true } } } } } });
  if (!p) notFound();
  const tracks = p.tracks.map(t => {
    const m = t.digitalMasters[0];
    return { id: t.id, title: t.title, position: t.position, publication: t.status, durationSeconds: t.durationSeconds, version: m?.version ?? 0, previewStartMs: m?.previewStartMs ?? 0, previewDurationMs: m?.previewDurationMs ?? null,
      previewUrl: t.status === "RELEASED" && m?.previewAsset?.visibility === "PUBLIC" && m.previewAsset.rightsStatus === "CLEARED" ? `/media/digital/previews/${m.previewAsset.id}` : null,
      mp3Ready:!!m?.mp3Asset&&m.mp3Asset.visibility==="PRIVATE"&&m.mp3Asset.mimeType==="audio/mpeg",mp3BitrateKbps:m?.mp3BitrateKbps??null,
      masterReady: !!m && digitalCommercialAudioReady(m), mediaCleared: m?.masterAsset.rightsStatus === "CLEARED" && m?.mp3Asset?.rightsStatus==="CLEARED"&&m?.previewAsset?.visibility === "PUBLIC" && m.previewAsset.rightsStatus === "CLEARED",
      offer: p.digitalOffers.find(o => o.trackId === t.id) ?? null };
  });
  const albumOffer = p.digitalOffers.find(o => o.scope === "ALBUM") ?? null;
  const readiness = digitalSalesReadiness(p, tracks, albumOffer);
  const money = (value: number) => new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(value / 100);
  return <div className={`admin-main ${admin.workflow}`}><Link className="admin-row-action" href="/admin/musique">Retour musique numérique</Link>
    <header className="admin-page-heading"><div><p className="admin-kicker">DCN‑1.2 · TEST</p><h1>{p.title}</h1></div><div className={admin.toolbar}><Link className="admin-row-action" href={`/admin/catalogue/${slug}`}>Identité, cover et publication Catalogue</Link>{p.publicVisible && p.status === "PUBLISHED" ? <Link className="admin-row-action" href={`/album/${slug}`} target="_blank" rel="noreferrer">Prévisualiser la fiche publique</Link> : <span>Fiche publique masquée</span>}</div></header>
    <p className={admin.banner}>Démonstration — aucun paiement réel. Prix fictifs, aucune ouverture LIVE. Les versions et compositions déjà acquises restent inchangées.</p>
    <section className={styles.panel} aria-labelledby="readiness"><h2 id="readiness">Préparation à la vente</h2><div className={admin.summary}><div><span>Publication projet</span><strong>{p.status === "PUBLISHED" && p.publicVisible ? "Publié et visible" : "Non public"}</strong></div><div><span>Pistes publiées / nommées</span><strong>{readiness.releasedTrackCount} / {tracks.length}</strong></div><div><span>Masters + extraits prêts</span><strong>{readiness.preparedTrackCount} / {readiness.releasedTrackCount}</strong></div><div><span>Offre album vendable TEST</span><strong>{readiness.albumReady ? `${readiness.includedTrackCount} pistes incluses` : "À compléter"}</strong></div></div>
      <p className={styles.muted}>L’offre album contient exactement les pistes publiées disposant des médias requis et validés intégralement. Une piste annoncée ou non listée n’augmente pas le contenu vendu. La distribution sur Spotify ou Apple Music n’est pas une condition de vente. Une ancienne version non qualifiée pour de nouvelles ventes reste conservée pour ses acquisitions existantes ; ne modifiez pas sa preuve pour l’activer.</p>
      {readiness.albumMoreExpensive ? <p className={admin.advisory} role="status">Attention : l’album ({money(albumOffer!.priceCents!)}) dépasse la somme des mêmes pistes vendables séparément ({money(readiness.individualTotalCents!)}). Le prix reste indépendant : aucune remise automatique et aucune interdiction.</p> : null}
    </section>
    <div className={styles.panel}><DigitalOfferForm key={albumOffer?.version ?? 0} projectId={p.id} trackId={null} offer={albumOffer} label="Offre album indépendante" /></div>
    <DigitalBatchUpload tracks={tracks} />
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
