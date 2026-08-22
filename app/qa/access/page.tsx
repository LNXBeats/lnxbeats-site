import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { QaAccessPortal } from "@/components/auth/qa-access-portal";
import { Container } from "@/components/container";
import { qaAccessAvailable } from "@/lib/auth/qa-access";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Accès QA staging",
  robots: { index: false, follow: false, nocache: true },
};

export default function QaAccessPage() {
  if (!qaAccessAvailable()) notFound();

  return (
    <section className="auth-shell qa-access-shell">
      <Container className="qa-access-shell__inner">
        <header className="qa-access__header">
          <p className="eyebrow">Staging — accès QA uniquement</p>
          <h1>Choisir un profil de validation.</h1>
          <p>Ces comptes sont fictifs et réservés aux tests du staging. Ce portail ne crée aucune commande et ne déclenche aucun paiement, e-mail ou SMS.</p>
        </header>
        <QaAccessPortal />
      </Container>
    </section>
  );
}
