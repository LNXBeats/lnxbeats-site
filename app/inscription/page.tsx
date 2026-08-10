import type { Metadata } from "next";

import { RegistrationForm } from "@/components/auth/registration-form";
import { Container } from "@/components/container";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Créer un espace membre",
  description: "Création d’un espace membre privé LNX Beats.",
  robots: { index: false, follow: false },
};

export default function RegistrationPage() {
  return (
    <section className="auth-shell">
      <Container className="auth-shell__inner">
        <div className="auth-intro">
          <p className="eyebrow">Espace membre</p>
          <h1>Créer votre espace LNX Beats.</h1>
          <p>Votre compte protège votre profil et votre accès. Votre adresse devra être confirmée avant la première connexion ; aucune commande ni aucun paiement ne sera créé ici.</p>
        </div>
        <div className="auth-panel">
          <p className="auth-panel__label">Inscription</p>
          <RegistrationForm />
        </div>
      </Container>
    </section>
  );
}
