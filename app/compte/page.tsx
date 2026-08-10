import type { Metadata } from "next";

import { LogoutButton } from "@/components/auth/logout-button";
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
          <p>La fondation est prête. Les espaces de projet arriveront dans une version ultérieure.</p>
        </div>
        <dl className="auth-profile">
          <div><dt>Email</dt><dd>{session.user.email}</dd></div>
          <div><dt>Rôle</dt><dd>{session.user.role}</dd></div>
          <div><dt>Statut</dt><dd>{session.user.status}</dd></div>
          <div className="auth-profile__action"><dt>Session</dt><dd><LogoutButton /></dd></div>
        </dl>
      </Container>
    </section>
  );
}
