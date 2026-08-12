import type { PublicProject } from "@/lib/catalog/types";

export const publicProjectStatuses = ["PUBLISHED", "IN_DEVELOPMENT"] as const;

export type JukeboxPlacement = "published" | "development";

type JukeboxProjectRecord = Pick<
  PublicProject,
  "publicVisible" | "status" | "jukeboxPlacement" | "cover" | "jukeboxPosition" | "catalogPosition" | "slug"
>;

const jukeboxStatus = {
  published: "published",
  development: "in-development",
} as const;

export function isPublicProject(project: Pick<PublicProject, "publicVisible" | "status">) {
  return project.publicVisible && (project.status === "published" || project.status === "in-development");
}

export function selectJukeboxProjects<ProjectRecord extends JukeboxProjectRecord>(
  projects: readonly ProjectRecord[],
  placement: JukeboxPlacement,
) {
  return projects
    .filter((project) => (
      isPublicProject(project)
      && project.status === jukeboxStatus[placement]
      && project.jukeboxPlacement === placement
      && Boolean(project.cover)
    ))
    .toSorted((left, right) => (
      (left.jukeboxPosition ?? Number.MAX_SAFE_INTEGER) - (right.jukeboxPosition ?? Number.MAX_SAFE_INTEGER)
      || left.catalogPosition - right.catalogPosition
      || left.slug.localeCompare(right.slug, "fr")
    ));
}
