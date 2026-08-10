import type { Metadata } from "next";

import { RegistrationForm } from "@/components/auth/registration-form";
import { Container } from "@/components/container";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Créer un espace membre",
  description: "Création d’un espace membre privé LNX Studio.",
  robots: { index: false, follow: false },
};

export default function RegistrationPage() {
  return (
    <section className="auth-shell">
      <Container className="auth-shell__inner">
        <div className="auth-intro">
          <p className="eyebrow">Espace membre</p>
          <h1>Ouvrir un nouveau chapitre.</h1>
          <p>Quelques lignes suffisent. Votre adresse devra ensuite être confirmée avant la première connexion.</p>
        </div>
        <div className="auth-panel">
          <p className="auth-panel__label">Inscription</p>
          <RegistrationForm />
        </div>
      </Container>
    </section>
  );
}
