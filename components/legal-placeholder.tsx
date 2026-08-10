import { Container } from "@/components/container";

type LegalItem = {
  status: "À FOURNIR" | "À VALIDER" | "DÉJÀ IDENTIFIÉ";
  text: string;
};

type LegalSection = {
  title: string;
  items: readonly LegalItem[];
};

export function LegalPlaceholder({
  title,
  description,
  sections,
}: {
  title: string;
  description: string;
  sections: readonly LegalSection[];
}) {
  return (
    <section className="page-hero">
      <Container className="legal-shell">
        <p className="eyebrow">Brouillon de préparation — non validé juridiquement</p>
        <h1>{title}</h1>
        <div className="legal-placeholder">
          <p className="legal-placeholder__intro">{description}</p>
          <p>Les éléments ci-dessous recensent ce qui est déjà identifié et ce qui exige encore une information humaine ou une validation professionnelle avant publication définitive.</p>
          <div className="legal-checklist">
            {sections.map((section) => (
              <section key={section.title}>
                <h2>{section.title}</h2>
                <ul>
                  {section.items.map((item) => (
                    <li key={`${item.status}-${item.text}`}>
                      <strong>{item.status}</strong>
                      <span>{item.text}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </div>
      </Container>
    </section>
  );
}
