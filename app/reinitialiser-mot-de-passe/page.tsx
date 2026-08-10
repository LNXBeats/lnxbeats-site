import type { Metadata } from "next";

import { ResetPasswordEntry } from "@/components/auth/reset-password-entry";
import { Container } from "@/components/container";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Réinitialiser le mot de passe",
  description: "Choix sécurisé d’un nouveau mot de passe.",
  robots: { index: false, follow: false },
};

type ResetPageProps = {
  searchParams: Promise<{ etat?: string | string[] }>;
};

export default async function ResetPasswordPage({ searchParams }: ResetPageProps) {
  const parameters = await searchParams;
  const confirmed = parameters.etat === "confirme";

  return (
    <section className="auth-shell">
      <Container className="auth-shell__inner">
        <div className="auth-intro">
          <p className="eyebrow">Sécurité</p>
          <h1>{confirmed ? "Mot de passe modifié." : "Choisir un nouveau mot de passe."}</h1>
          <p>{confirmed ? "Le mot de passe a été remplacé et toutes les anciennes sessions ont été révoquées." : "Choisissez une phrase secrète longue, personnelle et différente de vos autres accès."}</p>
        </div>
        <div className="auth-panel">
          <p className="auth-panel__label">Nouveau mot de passe</p>
          <ResetPasswordEntry confirmed={confirmed} />
        </div>
      </Container>
    </section>
  );
}
