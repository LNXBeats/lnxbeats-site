import type { ProjectPlatform } from "@/data/discography";

export function ProjectPlatforms({ platforms }: { platforms: readonly ProjectPlatform[] }) {
  if (platforms.length === 0) {
    return <p className="project-note">Les portes d’écoute s’ouvriront avec l’annonce officielle.</p>;
  }

  return (
    <ul className="album-platforms" aria-label="Liens officiels">
      {platforms.map((item) => (
        <li key={`${item.platform}-${item.scope}`}>
          <a href={item.url} target="_blank" rel="noopener noreferrer">
            <span>{item.label}</span>
            <span aria-hidden="true">↗</span>
            <span className="visually-hidden"> — nouvel onglet</span>
          </a>
        </li>
      ))}
    </ul>
  );
}
