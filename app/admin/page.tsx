import type { Metadata } from "next";

import { Container } from "@/components/container";
import { requireAdmin } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Administration",
  description: "Accès privé à l’administration LNX Studio.",
  robots: { index: false, follow: false },
};

export default async function AdminPage() {
  const session = await requireAdmin();

  return (
    <section className="auth-shell">
      <Container className="auth-shell__inner auth-shell__inner--account">
        <div className="auth-intro">
          <p className="eyebrow">Administration</p>
          <h1>Le poste de contrôle.</h1>
          <p>Accès confirmé pour {session.user.name}. Les outils d’administration seront ajoutés séparément.</p>
        </div>
        <div className="auth-panel auth-panel--minimal">
          <p className="auth-panel__label">Accès</p>
          <p>Rôle ADMIN vérifié côté serveur.</p>
        </div>
      </Container>
    </section>
  );
}
