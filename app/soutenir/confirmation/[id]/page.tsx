import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Container } from "@/components/container";
import { SupportConfirmation } from "@/components/support-confirmation";
import styles from "@/components/support.module.css";

export const metadata: Metadata = { title: "Confirmation de soutien", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
export default async function ConfirmationPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)) notFound();
  return <section className={styles.hero}><Container><div className={`${styles.panel} ${styles.confirmation}`}><p className="eyebrow">Soutenir LNX Beats</p><h1>Votre soutien.</h1><SupportConfirmation id={id} /><p><Link href="/contact">Une question ? Contacter LNX Beats</Link></p><Link href="/">Revenir à l’accueil</Link></div></Container></section>;
}
