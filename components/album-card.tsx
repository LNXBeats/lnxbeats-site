import Link from "next/link";
import type { Project } from "@/data/discography";
import { getProjectKindLabel, getProjectStatusLabel } from "@/data/discography";
import { ProjectArtwork } from "@/components/project-artwork";

type AlbumCardProps = {
  project: Project;
  priority?: boolean;
};

export function AlbumCard({ project, priority = false }: AlbumCardProps) {
  const detail = project.year ? `${getProjectKindLabel(project.type)} · ${project.year}` : getProjectKindLabel(project.type);

  return (
    <article className="release-card">
      <Link href={`/album/${project.slug}`} aria-label={`Découvrir ${project.title}`}>
        <ProjectArtwork project={project} priority={priority} sizes="(max-width: 767px) 100vw, (max-width: 1199px) 50vw, 33vw" />
        <div className="release-card__body">
          <div>
            <p className="release-card__meta">
              {detail}
              {project.status !== "published" ? ` · ${getProjectStatusLabel(project.status)}` : ""}
            </p>
            <h3>{project.title}</h3>
            <p className="release-card__description">{project.shortDescription}</p>
          </div>
          <span className="release-card__action" aria-hidden="true">→</span>
        </div>
      </Link>
    </article>
  );
}
