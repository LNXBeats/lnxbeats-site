import type { Metadata } from "next";

import { EmailVerificationResult } from "@/components/auth/email-verification-result";
import { Container } from "@/components/container";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Vérification de l’adresse email",
  description: "Résultat de la vérification de l’adresse email.",
  robots: { index: false, follow: false },
};

export default function VerificationPage() {
  return (
    <section className="auth-shell">
      <Container className="auth-shell__inner">
        <EmailVerificationResult />
      </Container>
    </section>
  );
}
