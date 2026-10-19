"use client";

import Image from "next/image";
import { useState } from "react";
import { resolveCatalogCoverAlt } from "@/lib/catalog/cover-alt";
import type { Project } from "@/lib/catalog/types";
import { OriginalName } from "@/components/original-name";
import { T, useSiteLanguage } from "@/components/site-language";

type ArtworkProject = Pick<Project, "artworkTone" | "cover" | "coverAlt" | "title">;

type ProjectArtworkProps = {
  project: ArtworkProject;
  priority?: boolean;
  sizes: string;
  className?: string;
};

export function ProjectArtwork({ project, priority = false, sizes, className = "" }: ProjectArtworkProps) {
  const { t } = useSiteLanguage();
  const [failedCover, setFailedCover] = useState<string | null>(null);
  const cover = project.cover;
  const coverUnavailable = Boolean(cover && failedCover === cover);

  if (cover && !coverUnavailable) {
    return (
      <div className={`project-artwork project-artwork--image ${className}`} data-artwork-state="available">
        <Image
          src={cover}
          alt={resolveCatalogCoverAlt(project.title, project.coverAlt) === resolveCatalogCoverAlt(project.title, null) ? t("Pochette de « {title} » — LNX Beats", { title: project.title }) : resolveCatalogCoverAlt(project.title, project.coverAlt)}
          fill
          priority={priority}
          sizes={sizes}
          onError={() => setFailedCover(cover)}
        />
      </div>
    );
  }

  const unavailableLabel = t("Pochette de « {title} » temporairement indisponible", { title: project.title });

  return (
    <div
      className={`project-artwork project-artwork--${project.artworkTone} ${className}`}
      role="img"
      aria-label={coverUnavailable
        ? unavailableLabel
        : t("Visuel éditorial provisoire pour {title} ; aucune pochette officielle disponible", { title: project.title })}
      data-artwork-state={coverUnavailable ? "unavailable" : "missing"}
    >
      <span className="project-artwork__brand" aria-hidden="true"><OriginalName>LNX BEATS</OriginalName> <i><T text={coverUnavailable ? "média indisponible" : "visuel éditorial"}/></i></span>
      <span className="project-artwork__title" aria-hidden="true" translate="no">{project.title}</span>
      <span className="project-artwork__status" aria-hidden="true"><T text={coverUnavailable ? "Visuel temporairement indisponible" : "Aucune pochette officielle"}/></span>
    </div>
  );
}
