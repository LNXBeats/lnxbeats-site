import { ButtonLink } from "@/components/button";
import { Container } from "@/components/container";

export default function NotFound() {
  return (
    <section className="page-hero">
      <Container className="legal-shell">
        <p className="eyebrow">Erreur 404</p>
        <h1>Cette piste n’existe pas.</h1>
        <p className="page-hero__intro">Il n’y a rien au bout de ce lien. Peut-être une adresse déplacée, peut-être une histoire qui n’a pas encore commencé.</p>
        <div style={{ marginTop: "2rem" }}><ButtonLink href="/">Revenir à l’accueil</ButtonLink></div>
      </Container>
    </section>
  );
}
