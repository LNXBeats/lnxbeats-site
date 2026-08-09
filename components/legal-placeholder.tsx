import { Container } from "@/components/container";

export function LegalPlaceholder({ title, description }: { title: string; description: string }) {
  return (
    <section className="page-hero">
      <Container className="legal-shell">
        <p className="eyebrow">Document à finaliser</p>
        <h1>{title}</h1>
        <div className="legal-placeholder">
          <p>{description}</p>
          <p>Le contenu définitif sera rédigé et validé dans un prochain sprint avant toute ouverture commerciale.</p>
        </div>
      </Container>
    </section>
  );
}
