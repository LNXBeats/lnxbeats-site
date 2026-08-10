import type { ProjectPlatform } from "@/data/discography";

const platformGroups = [
  { scope: "release", label: "Liens directs de la sortie" },
  { scope: "artist", label: "Profils artiste officiels" },
  { scope: "store", label: "Boutiques officielles" },
] as const;

export function ProjectPlatforms({ platforms }: { platforms: readonly ProjectPlatform[] }) {
  if (platforms.length === 0) {
    return <p className="project-note">Aucun lien officiel propre à cette sortie n’est documenté dans les sources locales.</p>;
  }

  return (
    <div className="project-platforms">
      {platformGroups.map((group) => {
        const items = platforms.filter((item) => item.scope === group.scope);

        if (items.length === 0) return null;

        return (
          <section className="project-platforms__group" key={group.scope} aria-labelledby={`platforms-${group.scope}`}>
            <p className="project-platforms__label" id={`platforms-${group.scope}`}>{group.label}</p>
            <ul className="album-platforms">
              {items.map((item) => (
                <li key={`${item.platform}-${item.scope}`}>
                  <a href={item.url} target="_blank" rel="noopener noreferrer">
                    <span>{item.label}</span>
                    <span aria-hidden="true">↗</span>
                    <span className="visually-hidden"> — nouvel onglet</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
