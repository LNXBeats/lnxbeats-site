import type { Metadata } from "next";

import { ChangePasswordForm } from "@/components/auth/change-password-form";
import { LogoutButton } from "@/components/auth/logout-button";
import { ProfileForm } from "@/components/auth/profile-form";
import { Container } from "@/components/container";
import { requireUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Mon espace",
  description: "Espace privé LNX Studio.",
  robots: { index: false, follow: false },
};

export default async function AccountPage() {
  const session = await requireUser("/compte");

  return (
    <section className="auth-shell">
      <Container className="auth-shell__inner auth-shell__inner--account">
        <div className="auth-intro">
          <p className="eyebrow">Votre espace</p>
          <h1>Bonjour, {session.user.name}.</h1>
          <p>Votre profil reste volontairement simple. Ici, vous gardez la main sur votre nom et la sécurité de votre accès.</p>
        </div>
        <div className="auth-account-stack">
          <dl className="auth-profile">
            <div><dt>Email</dt><dd>{session.user.email}</dd></div>
            <div><dt>Vérification</dt><dd>{session.user.emailVerified ? "Adresse confirmée" : "Adresse non confirmée"}</dd></div>
            <div><dt>Rôle</dt><dd>{session.user.role}</dd></div>
            <div><dt>Statut</dt><dd>{session.user.status}</dd></div>
            <div className="auth-profile__action"><dt>Session</dt><dd><LogoutButton /></dd></div>
          </dl>
          <section className="auth-panel" aria-labelledby="profile-title">
            <h2 className="auth-panel__label" id="profile-title">Profil</h2>
            <ProfileForm initialName={session.user.name} />
          </section>
          <section className="auth-panel" aria-labelledby="security-title">
            <h2 className="auth-panel__label" id="security-title">Sécurité</h2>
            <ChangePasswordForm />
          </section>
        </div>
      </Container>
    </section>
  );
}
