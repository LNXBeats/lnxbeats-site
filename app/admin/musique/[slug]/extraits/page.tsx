import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { requireDigitalEnvironment } from "@/lib/digital/domain";
import { digitalAdminExcerptReady } from "@/lib/digital/admin";
import { digitalCommercialAudioReady } from "@/lib/digital/formats";
import { loadDigitalExcerptSelection } from "@/lib/digital/excerpt-service";
import { DigitalExcerptReview } from "@/components/digital-excerpt-review";
import styles from "@/components/digital-excerpt-review.module.css";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Choisir les extraits — Admin", robots: { index: false, follow: false } };

export default async function Page({ params }: { params: Promise<{ slug: string }> }) {
  try { requireDigitalEnvironment(); } catch { notFound(); }
  const session = await requireAdmin();
  if (session.user.emailVerified !== true) notFound();
  const { slug } = await params;
  const project = await prisma.project.findUnique({ where: { slug }, select: { id: true, title: true, slug: true,
    tracks: { orderBy: [{ position: "asc" }, { id: "asc" }], include: { digitalMasters: {
      orderBy: { version: "desc" }, take: 1, include: { masterAsset: true, mp3Asset: true, previewAsset: true },
    } } },
  } });
  if (!project) notFound();
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
    <Link className="admin-row-action" href={`/admin/musique/${project.slug}`}>Retour à la préparation de l’album</Link>
    <header className="admin-page-heading"><div><p className="admin-kicker">Écoute privée · QA locale</p><h1>Choisir les extraits</h1><p className={styles.subtitle}>{project.title}</p></div></header>
    <p className={styles.notice}>Écoutez les masters privés et choisissez vos passages, à votre rythme. Enregistrer un brouillon ou valider un extrait ne publie rien, n’approuve aucun droit et n’ouvre aucune vente. Les extraits provisoires et les versions déjà acquises sont conservés.</p>
    {available.length !== project.tracks.length ? <p className={styles.notice} role="status">{project.tracks.length - available.length} piste(s) ne disposent pas encore d’une version audio strictement validée. Leur sélection d’extrait reste bloquée.</p> : null}
    {available.length ? <DigitalExcerptReview tracks={available} /> : <p>Aucune piste prête pour cette écoute privée.</p>}
  </div>;
}
