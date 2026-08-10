import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/auth/login-form";
import { Container } from "@/components/container";
import { safeInternalPath } from "@/lib/auth/redirect";
import { getAuthSession } from "@/lib/auth/session";
import { isActiveStatus } from "@/lib/auth/roles";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Connexion",
  description: "Connexion sécurisée à l’espace membre LNX Beats.",
  robots: { index: false, follow: false },
};

type LoginPageProps = {
  searchParams: Promise<{ retour?: string | string[] }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const parameters = await searchParams;
  const requestedReturn = typeof parameters.retour === "string" ? parameters.retour : undefined;
  const returnTo = safeInternalPath(requestedReturn);
  const session = await getAuthSession();

  if (session && isActiveStatus(session.user.status)) {
    redirect(returnTo);
  }

  return (
    <section className="auth-shell">
      <Container className="auth-shell__inner">
        <div className="auth-intro">
          <p className="eyebrow">Espace membre</p>
          <h1>Accéder à votre espace.</h1>
          <p>Votre compte protège aujourd’hui votre profil et votre accès. Le suivi des créations et les livraisons y seront ajoutés seulement lorsqu’ils seront réellement disponibles.</p>
        </div>
        <div className="auth-panel">
          <p className="auth-panel__label">Connexion</p>
          <LoginForm returnTo={returnTo} />
          <div className="auth-panel__links">
            <Link href="/mot-de-passe-oublie">Mot de passe oublié</Link>
            <Link href="/renvoyer-verification">Renvoyer la confirmation</Link>
            <Link href="/inscription">Créer un espace membre</Link>
          </div>
        </div>
      </Container>
    </section>
  );
}
