import Link from "next/link";
import type { Metadata } from "next";

import { EmailRequestForm } from "@/components/auth/email-request-form";
import { Container } from "@/components/container";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Renvoyer la confirmation",
  description: "Renvoi protégé du message de vérification LNX Studio.",
  robots: { index: false, follow: false },
};

export default function ResendVerificationPage() {
  return (
    <section className="auth-shell auth-shell--entry">
      <Container className="auth-shell__inner">
        <div className="auth-intro">
          <p className="eyebrow">Adresse à confirmer</p>
          <h1>Recevoir un nouveau lien.</h1>
          <p>Demandez un nouvel email de vérification. Le résultat reste identique pour toutes les adresses afin de protéger l’existence des comptes.</p>
        </div>
        <div className="auth-panel">
          <p className="auth-panel__label">Nouvel envoi</p>
          <EmailRequestForm kind="verification" />
          <p className="auth-panel__note"><Link href="/connexion">Revenir à la connexion</Link>.</p>
        </div>
      </Container>
    </section>
  );
}
