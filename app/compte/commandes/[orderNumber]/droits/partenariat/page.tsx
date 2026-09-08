import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";
export const metadata = { title: "Partenariat d’exploitation", robots: { index: false, follow: false } };

export default async function ExploitationPartnershipPage({ params }: { params: Promise<{ orderNumber: string }> }) {
  await params;
  notFound();
}
