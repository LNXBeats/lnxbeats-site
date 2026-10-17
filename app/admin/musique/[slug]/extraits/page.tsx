import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { requireDigitalEnvironment } from "@/lib/digital/domain";
import { digitalAdminExcerptReady } from "@/lib/digital/admin";
import { digitalCommercialAudioReady } from "@/lib/digital/formats";
import { loadDigitalExcerptSelection, digitalRecoveryExcerptsReviewOnly, RECOVERY_EXCERPT_PROJECT_ID } from "@/lib/digital/excerpt-service";
import { DigitalExcerptReview } from "@/components/digital-excerpt-review";
import styles from "@/components/digital-excerpt-review.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Choisir les extraits — Admin", robots: { index: false, follow: false } };

export default async function Page({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<{ courants?: string }> }) {
  let mode; try { mode=requireDigitalEnvironment(); } catch { notFound(); }
  const session = await requireAdmin();
  if (session.user.emailVerified !== true) notFound();
  const { slug } = await params;
  const project = await prisma.project.findUnique({ where: { slug }, select: { id: true, title: true, slug: true,
    tracks: { orderBy: [{ position: "asc" }, { id: "asc" }], include: { digitalMasters: {
      orderBy: { version: "desc" }, take: 1, include: { masterAsset: true, mp3Asset: true, previewAsset: true },
    } } },
  } });
  if (!project) notFound();
  const recoveryOnly = digitalRecoveryExcerptsReviewOnly(), currentOnly = !recoveryOnly && (await searchParams).courants === "1", existingOnly=recoveryOnly||mode==="LIVE"||currentOnly;
  if (recoveryOnly && (project.id !== RECOVERY_EXCERPT_PROJECT_ID || process.env.DCN_MODE !== "TEST" || process.env.DCN_STORAGE_MODE !== "LOCAL")) notFound();
  const tracks = await Promise.all(project.tracks.map(async track => {
    const master = track.digitalMasters[0];
    if (!master || !digitalCommercialAudioReady(master)) return null;
    return { masterId: master.id, trackId: track.id, title: track.title, position: track.position,
      durationMs: master.masterAsset.durationMs!, provisionalStartMs: master.previewStartMs,
      provisionalDurationMs: master.previewDurationMs!,
      provisionalUrl: master.previewAsset && digitalAdminExcerptReady(master) ? `/api/admin/digital/previews/${master.previewAsset.id}` : null,
      selection: await loadDigitalExcerptSelection(prisma, master),
    };
  }));
  const available = tracks.filter((track): track is NonNullable<typeof track> => track !== null);
  return <div className={`admin-main ${styles.shell}`}>
    <Link className="admin-row-action" href={currentOnly ? `/admin/musique/express?projet=${project.id}` : `/admin/musique/${project.slug}`}>Retour à la préparation de la musique</Link>
    <header className="admin-page-heading"><div><p className="admin-kicker">{mode==="LIVE"?"Écoute privée · Administration":"Écoute privée · QA locale"}</p><h1>{existingOnly ? "Écouter et valider les extraits" : "Choisir les extraits"}</h1><p className={styles.subtitle}>{project.title}</p></div></header>
    <p className={styles.notice}>{mode==="LIVE"||currentOnly?"Écoutez puis validez le fichier exact de chaque version. Le début de l’extrait est choisi lors de l’import du master ; un autre passage nécessite une nouvelle version préparée avec ce début. La validation artistique ne valide pas les droits et n’active aucune offre. Les fichiers déjà acquis sont conservés.":existingOnly ? "Écoutez les 12 extraits conservés, puis validez personnellement chaque fichier. Aucun début ne peut être modifié et aucun fichier ne sera régénéré. Les accords historiques restent des preuves distinctes. Aucune validation ne publie un extrait, n’approuve un droit ou n’ouvre une vente." : "Écoutez les masters privés et choisissez vos passages, à votre rythme. Enregistrer un brouillon ou valider un extrait ne publie rien, n’approuve aucun droit et n’ouvre aucune vente. Les extraits provisoires et les versions déjà acquises sont conservés."}</p>
    {available.length !== project.tracks.length ? <p className={styles.notice} role="status">{project.tracks.length - available.length} piste(s) ne disposent pas encore d’une version audio strictement validée. Leur sélection d’extrait reste bloquée.</p> : null}
    {available.length ? <DigitalExcerptReview tracks={available} existingOnly={existingOnly} live={mode==="LIVE"} prepared={currentOnly && mode==="TEST"} /> : <p>Aucune piste prête pour cette écoute privée.</p>}
  </div>;
}
