import { ButtonLink } from "@/components/button";
import { Container } from "@/components/container";

export default function NotFound() {
  return (
    <section className="page-hero">
      <Container className="legal-shell not-found-window">
        <p className="eyebrow">Erreur 404</p>
        <h1>Cette histoire s’arrête ici.</h1>
        <p className="page-hero__intro">Il n’y a rien au bout de ce lien. Peut-être une adresse déplacée, peut-être une histoire qui n’a pas encore commencé.</p>
        <div className="not-found-window__action"><ButtonLink href="/">Retour à l’accueil</ButtonLink></div>
      </Container>
    </section>
  );
}
