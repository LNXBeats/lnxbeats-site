import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";
import { mapDatabaseProject } from "@/lib/catalog/mapper";
import { publicProjectStatuses, selectJukeboxProjects } from "@/lib/catalog/publication";
import { loadDiscographyPreparation } from "@/lib/digital/discography-preparation";
import { discographyPreparationEnabled } from "@/lib/digital/discography-preparation-policy";

async function preparationView<T extends { slug: string; type: string; assets?: Array<{ role: string }> }>(rows: T[]) {
  if (!discographyPreparationEnabled()) return rows;
  const preparation = new Map((await loadDiscographyPreparation()).map(p => [p.slug, p]));
  return rows.filter(row => row.type === "PROJECT" || preparation.get(row.slug)?.metadataPublicAllowed === true)
    .map(row => row.type === "PROJECT" ? row : { ...row, assets: row.assets?.filter(a => a.role !== "AUDIO_PREVIEW") });
}

const publicProjectWhere = {
  publicVisible: true,
  status: { in: [...publicProjectStatuses] },
} satisfies Prisma.ProjectWhereInput;

const publicPlatformLinkWhere = {
  scope: { in: ["RELEASE" as const, "STORE" as const] },
  platform: { not: "ETSY" as const },
} satisfies Prisma.PlatformLinkWhereInput;

const detailInclude = {
  tracks: { orderBy: [{ position: "asc" as const }, { id: "asc" as const }] },
  platformLinks: { where: publicPlatformLinkWhere, orderBy: [{ position: "asc" as const }, { id: "asc" as const }] },
  credits: { orderBy: [{ position: "asc" as const }, { id: "asc" as const }] },
  confidenceAnnotations: true,
  assets: {
    where: { role: { in: ["COVER" as const, "AUDIO_PREVIEW" as const] } },
    orderBy: [{ role: "asc" as const }, { position: "asc" as const }, { createdAt: "desc" as const }],
    include: { asset: true },
  },
} satisfies Prisma.ProjectInclude;

const listInclude = {
  tracks: false,
  platformLinks: false,
  credits: false,
  confidenceAnnotations: true,
  assets: detailInclude.assets,
} satisfies Prisma.ProjectInclude;

export async function listPublicProjects() {
  assertDatabaseConfigured();
  const rows = await prisma.project.findMany({
    where: publicProjectWhere,
    orderBy: [{ catalogPosition: "asc" }, { id: "asc" }],
    include: listInclude,
  });
  return (await preparationView(rows)).map(mapDatabaseProject);
}

export async function listDiscographyProjects() {
  const projects = await listPublicProjects();
  const publishedProjects = projects.filter(({ status }) => status === "published");
  const projectsInDevelopment = projects.filter(({ status }) => status === "in-development");
  const featuredProjects = publishedProjects.filter(({ featured }) => featured);
  const publishedJukeboxProjects = selectJukeboxProjects(projects, "published");
  const developmentJukeboxProjects = selectJukeboxProjects(projects, "development");
  return { projects, publishedProjects, projectsInDevelopment, featuredProjects, publishedJukeboxProjects, developmentJukeboxProjects };
}

export async function getPublicProjectBySlug(slug: string) {
  assertDatabaseConfigured();
  const row = await prisma.project.findFirst({
    where: { ...publicProjectWhere, slug },
    include: detailInclude,
  });
  return row ? (await preparationView([row])).map(mapDatabaseProject)[0] ?? null : null;
}

export async function getFeaturedProject() {
  assertDatabaseConfigured();
  const row = await prisma.project.findFirst({
    where: { featured: true, status: "PUBLISHED", publicVisible: true },
    include: listInclude,
  });
  return row ? (await preparationView([row])).map(mapDatabaseProject)[0] ?? null : null;
}

export async function getHomepageProjects() {
  assertDatabaseConfigured();
  const [lead, supportingRows] = await Promise.all([
    getFeaturedProject(),
    prisma.project.findMany({
      where: { highlighted: true, status: "PUBLISHED", publicVisible: true, featured: false },
      orderBy: [{ catalogPosition: "asc" }, { id: "asc" }],
      take: 2,
      include: listInclude,
    }),
  ]);
  return { lead, supporting: (await preparationView(supportingRows)).map(mapDatabaseProject) };
}

export async function listSitemapProjects() {
  assertDatabaseConfigured();
  const rows = await prisma.project.findMany({
    where: publicProjectWhere,
    orderBy: [{ catalogPosition: "asc" }, { id: "asc" }],
    select: { slug: true, type: true, status: true, featured: true, updatedAt: true },
  });
  return preparationView(rows);
}
