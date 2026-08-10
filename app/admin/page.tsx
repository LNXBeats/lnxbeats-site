import type { Metadata } from "next";

import { Container } from "@/components/container";
import { requireAdmin } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Administration",
  description: "Accès privé à l’administration LNX Beats.",
  robots: { index: false, follow: false },
};

export default async function AdminPage() {
  const session = await requireAdmin();

  return (
    <section className="auth-shell">
      <Container className="auth-shell__inner auth-shell__inner--account">
        <div className="auth-intro">
          <p className="eyebrow">Administration</p>
          <h1>Administration LNX Beats.</h1>
          <p>Accès confirmé pour {session.user.name}. Aucun outil métier n’est actif dans cette version ; le catalogue, les commandes, les membres et les livraisons seront traités dans des étapes séparées.</p>
        </div>
        <div className="auth-panel auth-panel--minimal">
          <p className="auth-panel__label">Accès</p>
          <p>Rôle Administrateur vérifié côté serveur. Cette page confirme uniquement l’autorisation d’accès.</p>
        </div>
      </Container>
    </section>
  );
}
