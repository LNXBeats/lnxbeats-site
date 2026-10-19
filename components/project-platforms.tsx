
import { T } from "@/components/site-language";
import type { ProjectPlatform } from "@/lib/catalog/types";
import { ExternalLinkIcon } from "@/components/link-icons";
import { OriginalName } from "@/components/original-name";

const platformGroups = [
  { scope: "release", label: "Liens directs de la sortie" },
  { scope: "artist", label: "Profils artiste officiels" },
  { scope: "store", label: "Boutiques officielles" },
] as const;

export function ProjectPlatforms({ platforms }: { platforms: readonly ProjectPlatform[] }) {
  if (platforms.length === 0) {
    return <p className="project-note"><T text="Aucun lien officiel propre à cette sortie n’est encore documenté."/></p>;
  }

  return (
    <div className="project-platforms">
      {platformGroups.map((group) => {
        const items = platforms.filter((item) => item.scope === group.scope);

        if (items.length === 0) return null;

        return (
          <section className="project-platforms__group" key={group.scope} aria-labelledby={`platforms-${group.scope}`}>
            <p className="project-platforms__label" id={`platforms-${group.scope}`}><T text={group.label}/></p>
            <ul className="album-platforms">
              {items.map((item) => (
                <li key={`${item.platform}-${item.scope}`}>
                  <a href={item.url} target="_blank" rel="noopener noreferrer">
                    <OriginalName>{item.label}</OriginalName>
                    <ExternalLinkIcon />
                    <span className="visually-hidden"> <T text="— nouvel onglet"/></span>
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
