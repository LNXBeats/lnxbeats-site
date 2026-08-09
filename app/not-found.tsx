import { ButtonLink } from "@/components/button";
import { Container } from "@/components/container";

export default function NotFound() {
  return (
    <section className="page-hero">
      <Container className="legal-shell">
        <p className="eyebrow">Erreur 404</p>
        <h1>Cette piste n’existe pas.</h1>
        <p className="page-hero__intro">La page demandée a peut-être changé d’adresse ou n’est pas encore disponible.</p>
        <div style={{ marginTop: "2rem" }}><ButtonLink href="/">Revenir à l’accueil</ButtonLink></div>
      </Container>
    </section>
  );
}
