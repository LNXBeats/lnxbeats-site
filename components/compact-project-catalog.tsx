import { AlbumCard } from "@/components/album-card";
import type { Project } from "@/lib/catalog/types";

const initialProjectCount = 12;

export function CompactProjectCatalog({ projects }: { projects: readonly Project[] }) {
  const initialProjects = projects.slice(0, initialProjectCount);
  const remainingProjects = projects.slice(initialProjectCount);

  return <>
    <div className="release-grid release-grid--compact motion-reveal motion-reveal--soft">
      {initialProjects.map((project) => <AlbumCard compact key={project.slug} project={project} />)}
    </div>
    {remainingProjects.length ? <details className="catalog-expansion">
      <summary><span>Voir tous les projets</span><span>Réduire le catalogue</span><strong>{remainingProjects.length} autres</strong></summary>
      <div className="release-grid release-grid--compact">
        {remainingProjects.map((project) => <AlbumCard compact key={project.slug} project={project} />)}
      </div>
    </details> : null}
  </>;
}
