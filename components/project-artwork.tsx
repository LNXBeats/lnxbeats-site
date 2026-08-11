import Image from "next/image";
import type { Project } from "@/data/discography";

type ProjectArtworkProps = {
  project: Project;
  priority?: boolean;
  sizes: string;
  className?: string;
};

export function ProjectArtwork({ project, priority = false, sizes, className = "" }: ProjectArtworkProps) {
  if (project.cover) {
    return (
      <div className={`project-artwork project-artwork--image ${className}`}>
        <Image
          src={project.cover}
          alt={project.coverAlt ?? `Pochette de ${project.title}`}
          fill
          priority={priority}
          sizes={sizes}
        />
      </div>
    );
  }

  return (
    <div
      className={`project-artwork project-artwork--${project.artworkTone} ${className}`}
      role="img"
      aria-label={`Visuel éditorial provisoire pour ${project.title} ; aucune pochette officielle disponible`}
    >
      <span className="project-artwork__brand" aria-hidden="true">LNX BEATS <i>visuel éditorial</i></span>
      <span className="project-artwork__title" aria-hidden="true">{project.title}</span>
      <span className="project-artwork__status" aria-hidden="true">Aucune pochette officielle</span>
    </div>
  );
}
