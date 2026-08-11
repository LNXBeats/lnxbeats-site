import type { Metadata } from "next";
import Link from "next/link";

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
    <section className="auth-shell auth-shell--entry">
      <Container className="auth-shell__inner">
        <div className="auth-intro">
          <p className="eyebrow">Espace membre</p>
          <h1>Une adresse. Un code. Votre espace.</h1>
          <p>La création commence par la preuve que cette adresse vous appartient. Votre mot de passe ne sera demandé qu’ensuite ; aucune commande ni aucun paiement ne sera créé ici.</p>
        </div>
        <div className="auth-panel">
          <p className="auth-panel__label">Inscription</p>
          <RegistrationForm />
          <p className="auth-panel__note">Déjà membre&nbsp;? <Link href="/connexion">Revenir à la connexion</Link>.</p>
        </div>
      </Container>
    </section>
  );
}
