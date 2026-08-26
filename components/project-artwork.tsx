"use client";

import Image from "next/image";
import { useState } from "react";
import { resolveCatalogCoverAlt } from "@/lib/catalog/cover-alt";
import type { Project } from "@/lib/catalog/types";

type ArtworkProject = Pick<Project, "artworkTone" | "cover" | "coverAlt" | "title">;

type ProjectArtworkProps = {
  project: ArtworkProject;
  priority?: boolean;
  sizes: string;
  className?: string;
};

export function ProjectArtwork({ project, priority = false, sizes, className = "" }: ProjectArtworkProps) {
  const [failedCover, setFailedCover] = useState<string | null>(null);
  const cover = project.cover;
  const coverUnavailable = Boolean(cover && failedCover === cover);

  if (cover && !coverUnavailable) {
    return (
      <div className={`project-artwork project-artwork--image ${className}`} data-artwork-state="available">
        <Image
          src={cover}
          alt={resolveCatalogCoverAlt(project.title, project.coverAlt)}
          fill
          priority={priority}
          sizes={sizes}
          onError={() => setFailedCover(cover)}
        />
      </div>
    );
  }

  const unavailableLabel = `Pochette de « ${project.title} » temporairement indisponible`;

  return (
    <div
      className={`project-artwork project-artwork--${project.artworkTone} ${className}`}
      role="img"
      aria-label={coverUnavailable
        ? unavailableLabel
        : `Visuel éditorial provisoire pour ${project.title} ; aucune pochette officielle disponible`}
      data-artwork-state={coverUnavailable ? "unavailable" : "missing"}
    >
      <span className="project-artwork__brand" aria-hidden="true">LNX BEATS <i>{coverUnavailable ? "média indisponible" : "visuel éditorial"}</i></span>
      <span className="project-artwork__title" aria-hidden="true">{project.title}</span>
      <span className="project-artwork__status" aria-hidden="true">{coverUnavailable ? "Visuel temporairement indisponible" : "Aucune pochette officielle"}</span>
    </div>
  );
}
