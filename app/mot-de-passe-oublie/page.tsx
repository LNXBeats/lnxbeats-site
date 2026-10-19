
import { T } from "@/components/site-language";
import Link from "next/link";
import type { Metadata } from "next";

import { EmailRequestForm } from "@/components/auth/email-request-form";
import { Container } from "@/components/container";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Mot de passe oublié",
  description: "Demande sécurisée de réinitialisation du mot de passe.",
  robots: { index: false, follow: false },
};

export default function ForgotPasswordPage() {
  return (
    <section className="auth-shell auth-shell--entry">
      <Container className="auth-shell__inner">
        <div className="auth-intro">
          <p className="eyebrow"><T text="Accès perdu"/></p>
          <h1><T text="Réinitialiser votre mot de passe."/></h1>
          <p><T text="Indiquez votre adresse email. Pour protéger les comptes, la réponse restera identique qu’une adresse soit inscrite ou non."/></p>
        </div>
        <div className="auth-panel">
          <p className="auth-panel__label"><T text="Réinitialisation"/></p>
          <EmailRequestForm kind="password-reset" />
          <p className="auth-panel__note"><Link href="/connexion"><T text="Revenir à la connexion"/></Link>.</p>
        </div>
      </Container>
    </section>
  );
}
