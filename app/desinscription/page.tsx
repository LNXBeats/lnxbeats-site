import type { Metadata } from "next";
import { Container } from "@/components/container";
import { ReleaseUnsubscribeForm } from "@/components/release-unsubscribe-form";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Désinscription des nouveautés", robots: { index: false, follow: false }, referrer: "no-referrer" };
export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const query = await searchParams;
  return <section className="auth-shell"><Container className="auth-shell__inner"><ReleaseUnsubscribeForm token={typeof query.token === "string" && query.token.length <= 100 ? query.token : ""} /></Container></section>;
}
