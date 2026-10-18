import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { loadGroupReview } from "@/lib/digital/group-review-service";
import { MusicGroupReview } from "@/components/music-group-review";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Écoute et droits groupés — Admin", robots: { index: false, follow: false } };
export default async function Page({ searchParams }: { searchParams: Promise<{ projet?: string }> }) {
  const session = await requireAdmin(), { projet } = await searchParams;
  if (!projet || session.user.emailVerified !== true || process.env.DCN_GROUP_REVIEW_ENABLED !== "true") notFound();
  const view = await loadGroupReview({ id: session.user.id, email: session.user.email, name: session.user.name, role: "ADMIN", status: "ACTIVE", emailVerified: true }, projet);
  return <MusicGroupReview key={view.id} initial={view} />;
}
