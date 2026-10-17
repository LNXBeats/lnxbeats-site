import type { Metadata } from "next";
import { requireAdmin } from "@/lib/auth/session";
import { requireDigitalEnvironment } from "@/lib/digital/domain";
import { loadExpressDefaults, loadExpressProject } from "@/lib/digital/express-service";
import { MusicExpress } from "@/components/music-express";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Ajouter une musique — Express", robots: { index: false, follow: false } };
export default async function Page({ searchParams }: { searchParams: Promise<{ projet?: string }> }) {
  const actor = await requireAdmin(), mode = requireDigitalEnvironment(), { projet } = await searchParams;
  return <MusicExpress key={projet ?? "nouveau"} ownerId={actor.user.id} mode={mode} defaults={await loadExpressDefaults()} initial={projet ? await loadExpressProject(projet) : null} />;
}
