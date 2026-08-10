import type { Metadata } from "next";

import { ChangePasswordForm } from "@/components/auth/change-password-form";
import { LogoutButton } from "@/components/auth/logout-button";
import { ProfileForm } from "@/components/auth/profile-form";
import { Container } from "@/components/container";
import { requireUser } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Mon espace",
  description: "Profil et sécurité de l’espace membre LNX Beats.",
  robots: { index: false, follow: false },
};

const roleLabels = { ADMIN: "Administrateur", CUSTOMER: "Client", MEMBER: "Membre" } as const;
const statusLabels = { ACTIVE: "Actif", DEACTIVATED: "Désactivé", PENDING: "En attente", SUSPENDED: "Suspendu" } as const;

export default async function AccountPage() {
  const session = await requireUser("/compte");
  const roleLabel = roleLabels[session.user.role];
  const statusLabel = statusLabels[session.user.status];

  return (
    <section className="auth-shell">
      <Container className="auth-shell__inner auth-shell__inner--account">
        <div className="auth-intro">
          <p className="eyebrow">Votre espace</p>
          <h1>Bonjour, {session.user.name}.</h1>
          <p>Vous gardez ici la main sur votre profil et la sécurité de votre accès. Les fonctions liées aux créations seront ajoutées seulement lorsqu’elles seront opérationnelles.</p>
        </div>
        <div className="auth-account-stack">
          <dl className="auth-profile">
            <div><dt>Email</dt><dd>{session.user.email}</dd></div>
            <div><dt>Vérification</dt><dd>{session.user.emailVerified ? "Adresse confirmée" : "Adresse non confirmée"}</dd></div>
            <div><dt>Type de compte</dt><dd>{roleLabel}</dd></div>
            <div><dt>Accès</dt><dd>{statusLabel}</dd></div>
            <div className="auth-profile__action"><dt>Session</dt><dd><LogoutButton /></dd></div>
          </dl>
          <section className="account-outlook" aria-labelledby="account-outlook-title">
            <p className="auth-panel__label">Ce que cet espace accueillera</p>
            <h2 id="account-outlook-title">Un seul endroit pour suivre ce qui vous concerne.</h2>
            <ul>
              <li><strong>Suivi des créations</strong><span>Prévu — indisponible dans cette version</span></li>
              <li><strong>Livraisons et fichiers</strong><span>Prévu — aucun téléchargement actif</span></li>
              <li><strong>Favoris et alertes choisies</strong><span>À venir — aucune notification envoyée</span></li>
            </ul>
          </section>
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
