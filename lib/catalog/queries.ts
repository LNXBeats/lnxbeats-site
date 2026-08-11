import "server-only";

import type { Prisma } from "@/generated/prisma/client";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";
import { mapDatabaseProject } from "@/lib/catalog/mapper";

const publicStatuses = ["PUBLISHED", "IN_DEVELOPMENT"] as const;

const detailInclude = {
  tracks: { orderBy: [{ position: "asc" as const }, { id: "asc" as const }] },
  platformLinks: { where: { scope: { in: ["RELEASE" as const, "STORE" as const] } }, orderBy: [{ position: "asc" as const }, { id: "asc" as const }] },
  credits: { orderBy: [{ position: "asc" as const }, { id: "asc" as const }] },
  confidenceAnnotations: true,
  assets: {
    where: { role: "COVER" as const },
    orderBy: [{ position: "asc" as const }, { createdAt: "desc" as const }],
    take: 1,
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
    where: { status: { in: [...publicStatuses] } },
    orderBy: [{ catalogPosition: "asc" }, { id: "asc" }],
    include: listInclude,
  });
  return rows.map(mapDatabaseProject);
}

export async function listDiscographyProjects() {
  const projects = await listPublicProjects();
  const publishedProjects = projects.filter(({ status }) => status === "published");
  const projectsInDevelopment = projects.filter(({ status }) => status === "in-development");
  const featuredProjects = publishedProjects.filter(({ featured }) => featured);
  return { projects, publishedProjects, projectsInDevelopment, featuredProjects };
}

export async function getPublicProjectBySlug(slug: string) {
  assertDatabaseConfigured();
  const row = await prisma.project.findFirst({
    where: { slug, status: { in: [...publicStatuses] } },
    include: detailInclude,
  });
  return row ? mapDatabaseProject(row) : null;
}

export async function getFeaturedProject() {
  assertDatabaseConfigured();
  const row = await prisma.project.findFirst({
    where: { featured: true, status: "PUBLISHED" },
    include: listInclude,
  });
  return row ? mapDatabaseProject(row) : null;
}

export async function getHomepageProjects() {
  assertDatabaseConfigured();
  const [lead, supportingRows] = await Promise.all([
    getFeaturedProject(),
    prisma.project.findMany({
      where: { highlighted: true, status: "PUBLISHED", featured: false },
      orderBy: [{ catalogPosition: "asc" }, { id: "asc" }],
      take: 2,
      include: listInclude,
    }),
  ]);
  return { lead, supporting: supportingRows.map(mapDatabaseProject) };
}

export async function listSitemapProjects() {
  assertDatabaseConfigured();
  return prisma.project.findMany({
    where: { status: { in: [...publicStatuses] } },
    orderBy: [{ catalogPosition: "asc" }, { id: "asc" }],
    select: { slug: true, status: true, featured: true, updatedAt: true },
  });
}
