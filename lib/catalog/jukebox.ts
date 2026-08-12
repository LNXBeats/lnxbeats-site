import type { PublicProject } from "@/lib/catalog/types";

export function jukeboxInitialIndex(projects: readonly Pick<PublicProject, "featured">[]) {
  const featured = projects.findIndex((project) => project.featured);
  return featured >= 0 ? featured : 0;
}
