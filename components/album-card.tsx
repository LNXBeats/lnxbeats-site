import Link from "next/link";
import type { Project } from "@/lib/catalog/types";
import { getProjectKindLabel, getProjectStatusLabel } from "@/lib/catalog/types";
import { ProjectArtwork } from "@/components/project-artwork";

type AlbumCardProps = {
  project: Project;
  priority?: boolean;
};

export function AlbumCard({ project, priority = false }: AlbumCardProps) {
  const detail = project.year ? `${getProjectKindLabel(project.type)} · ${project.year}` : getProjectKindLabel(project.type);

  return (
    <article className="release-card" data-project-type={project.type}>
      <Link href={`/album/${project.slug}`} aria-label={`Voir la fiche de ${project.title}`}>
        <ProjectArtwork project={project} priority={priority} sizes="(max-width: 767px) 100vw, (max-width: 1199px) 50vw, 33vw" />
        <div className="release-card__body">
          <div>
            <p className="release-card__meta">
              {detail}
              {project.status !== "published" ? ` · ${getProjectStatusLabel(project.status)}` : ""}
            </p>
            <h3>{project.title}</h3>
          </div>
          <span className="release-card__action" aria-hidden="true"><small>Entrer</small> →</span>
        </div>
      </Link>
    </article>
  );
}
