import type { PublicProject } from "@/lib/catalog/types";

export type DiscographyFilter = "all" | "albums" | "singles" | "development";
export type DiscographySort = "editorial" | "newest" | "oldest";

type DiscographyProjectRecord = Pick<
  PublicProject,
  "catalogPosition" | "releaseDate" | "slug" | "status" | "type"
>;

export function jukeboxInitialIndex(
  projects: readonly Pick<PublicProject, "featured">[],
  minimumNeighborCount = 0,
) {
  const featured = projects.findIndex((project) => project.featured);
  const preferred = featured >= 0 ? featured : 0;
  if (projects.length <= minimumNeighborCount * 2) return preferred;
  return Math.min(Math.max(preferred, minimumNeighborCount), projects.length - minimumNeighborCount - 1);
}

export function filterDiscographyProjects<ProjectRecord extends DiscographyProjectRecord>(
  projects: readonly ProjectRecord[],
  filter: DiscographyFilter,
) {
  if (filter === "albums") return projects.filter(({ type }) => type === "album");
  if (filter === "singles") return projects.filter(({ type }) => type === "single");
  if (filter === "development") return projects.filter(({ status }) => status === "in-development");
  return [...projects];
}

function releaseTimestamp(releaseDate: string | null) {
  if (!releaseDate) return null;
  const timestamp = Date.parse(`${releaseDate}T00:00:00.000Z`);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function sortDiscographyProjects<ProjectRecord extends DiscographyProjectRecord>(
  projects: readonly ProjectRecord[],
  sort: DiscographySort,
) {
  return [...projects].sort((left, right) => {
    if (sort !== "editorial") {
      const leftDate = releaseTimestamp(left.releaseDate);
      const rightDate = releaseTimestamp(right.releaseDate);

      if (leftDate === null && rightDate !== null) return 1;
      if (leftDate !== null && rightDate === null) return -1;
      if (leftDate !== null && rightDate !== null && leftDate !== rightDate) {
        return sort === "newest" ? rightDate - leftDate : leftDate - rightDate;
      }
    }

    return left.catalogPosition - right.catalogPosition || left.slug.localeCompare(right.slug, "fr");
  });
}

export function discographyFilterCounts(projects: readonly DiscographyProjectRecord[]) {
  return {
    all: projects.length,
    albums: filterDiscographyProjects(projects, "albums").length,
    singles: filterDiscographyProjects(projects, "singles").length,
    development: filterDiscographyProjects(projects, "development").length,
  } as const;
}
