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
      aria-label={`Emplacement éditorial, pochette officielle de ${project.title} à venir`}
    >
      <span className="project-artwork__brand" aria-hidden="true">LNX BEATS</span>
      <span className="project-artwork__title" aria-hidden="true">{project.title}</span>
      <span className="project-artwork__status" aria-hidden="true">Pochette officielle à venir</span>
    </div>
  );
}
