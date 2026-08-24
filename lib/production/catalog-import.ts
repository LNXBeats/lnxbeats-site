import "server-only";

import type {
  Asset,
  ConfidenceAnnotation,
  Credit,
  PlatformLink,
  PrismaClient,
  Project,
  ProjectAsset,
  Track,
} from "@/generated/prisma/client";
import * as legacy from "@/lib/catalog/legacy";
import { runSequentialDatabaseQueries } from "@/lib/database/sequential-queries";
import {
  CATALOG_PRODUCTION_CONFIRMATION,
  ProductionBootstrapError,
  assertProductionApply,
  assertProductionDatabaseEnvironment,
} from "@/lib/production/bootstrap-environment";

type Environment = Record<string, string | undefined>;

type CatalogDatabase = Pick<PrismaClient, "project" | "track" | "platformLink" | "credit" | "confidenceAnnotation" | "projectAsset">;
type IncludedProject = Project & {
  tracks: Track[];
  platformLinks: PlatformLink[];
  credits: Credit[];
  confidenceAnnotations: ConfidenceAnnotation[];
  assets: Array<ProjectAsset & { asset: Asset }>;
};

export type CatalogImportPlan = {
  sourceVersion: string;
  sourceProjects: number;
  sourceTracks: number;
  sourceCredits: number;
  sourcePlatformLinks: number;
  existingProjects: number;
  creates: string[];
  skips: string[];
  conflicts: string[];
  unexpectedExisting: string[];
};

function same(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function existingMatchesRecord(
  existing: IncludedProject,
  record: ReturnType<typeof legacy.legacyProjectRecord>,
) {
  return existing.slug === record.slug
    && existing.title === record.title
    && existing.subtitle === record.subtitle
    && existing.type === record.type
    && existing.status === record.status
    && existing.publicVisible === true
    && existing.catalogPosition === record.catalogPosition
    && existing.highlighted === record.highlighted
    && existing.featured === record.featured
    && existing.shortDescription === record.shortDescription
    && existing.description === record.description
    && existing.releaseDate?.toISOString().slice(0, 10) === record.releaseDate?.toISOString().slice(0, 10)
    && existing.trackCount === record.trackCount
    && existing.artworkTone === record.artworkTone
    && existing.seoTitle === record.seoTitle
    && existing.seoDescription === record.seoDescription
    && existing.legacySourceVersion === record.legacySourceVersion
    && existing.confidence === record.confidence
    && same(existing.tracks.map(({ position, title, durationSeconds, status, confidence }) => ({ position, title, durationSeconds, status, confidence })), record.tracks)
    && same(existing.platformLinks.map(({ platform, scope, url, label, position, confidence }) => ({ platform, scope, url, label, position, confidence })), record.platformLinks)
    && same(existing.credits.map(({ name, role, note, position, confidence }) => ({ name, role, note, position, confidence })), record.credits)
    && same(
      existing.confidenceAnnotations.map(({ domain, level, source }) => ({ domain, level, source })).sort((left, right) => left.domain.localeCompare(right.domain)),
      [...record.confidenceAnnotations].sort((left, right) => left.domain.localeCompare(right.domain)),
    );
}

export function canonicalCatalogRecords() {
  const projects = legacy.getLegacyCatalogue();
  const serialized = JSON.stringify(projects);
  if (/(?:example\.invalid|localhost|127\.0\.0\.1|\bstaging\b|\bqa[-_:])/i.test(serialized)) {
    throw new ProductionBootstrapError("The canonical catalogue contains a staging, QA or local marker.");
  }
  return projects.map((project, index) => ({ project, record: legacy.legacyProjectRecord(project, index) }));
}

async function findCatalogProject(database: CatalogDatabase, slug: string): Promise<IncludedProject | null> {
  const project = await database.project.findUnique({ where: { slug } });
  if (!project) return null;
  const [tracks, platformLinks, credits, confidenceAnnotations, assets] = await runSequentialDatabaseQueries(
    () => database.track.findMany({ where: { projectId: project.id }, orderBy: [{ position: "asc" }, { id: "asc" }] }),
    () => database.platformLink.findMany({
      where: { projectId: project.id, scope: { in: ["RELEASE", "STORE"] } },
      orderBy: [{ position: "asc" }, { id: "asc" }],
    }),
    () => database.credit.findMany({ where: { projectId: project.id }, orderBy: [{ position: "asc" }, { id: "asc" }] }),
    () => database.confidenceAnnotation.findMany({ where: { projectId: project.id } }),
    () => database.projectAsset.findMany({
      where: { projectId: project.id, role: "COVER" },
      take: 1,
      include: { asset: true },
    }),
  );
  return { ...project, tracks, platformLinks, credits, confidenceAnnotations, assets } as IncludedProject;
}

async function inspectCatalog(database: CatalogDatabase): Promise<CatalogImportPlan> {
  const source = canonicalCatalogRecords();
  const sourceSlugs = new Set(source.map(({ project }) => project.slug));
  const existingSlugs = await database.project.findMany({ orderBy: { slug: "asc" }, select: { slug: true } });
  const creates: string[] = [];
  const skips: string[] = [];
  const conflicts: string[] = [];

  for (const { project, record } of source) {
    const existing = await findCatalogProject(database, project.slug);
    if (!existing) {
      creates.push(project.slug);
      continue;
    }
    if (existingMatchesRecord(existing, record)) skips.push(project.slug);
    else conflicts.push(project.slug);
  }

  const unexpectedExisting = existingSlugs.map(({ slug }) => slug).filter((slug) => !sourceSlugs.has(slug));
  return {
    sourceVersion: legacy.CATALOG_SOURCE_VERSION,
    sourceProjects: source.length,
    sourceTracks: source.reduce((sum, { record }) => sum + record.tracks.length, 0),
    sourceCredits: source.reduce((sum, { record }) => sum + record.credits.length, 0),
    sourcePlatformLinks: source.reduce((sum, { record }) => sum + record.platformLinks.length, 0),
    existingProjects: existingSlugs.length,
    creates,
    skips,
    conflicts,
    unexpectedExisting,
  };
}

function assertPlanSafe(plan: CatalogImportPlan) {
  if (plan.conflicts.length || plan.unexpectedExisting.length) {
    throw new ProductionBootstrapError(
      `Catalogue import refused: ${plan.conflicts.length} conflict(s), ${plan.unexpectedExisting.length} unexpected existing project(s).`,
    );
  }
}

export async function planProductionCatalogImport(
  client: PrismaClient,
  environment: Environment = process.env,
) {
  assertProductionDatabaseEnvironment(environment);
  const plan = await inspectCatalog(client);
  assertPlanSafe(plan);
  return plan;
}

export async function applyProductionCatalogImport(
  client: PrismaClient,
  environment: Environment = process.env,
  hooks: { afterCreate?: (createdCount: number) => void | Promise<void> } = {},
) {
  assertProductionDatabaseEnvironment(environment);
  assertProductionApply(true, "CATALOG_PRODUCTION_CONFIRM", CATALOG_PRODUCTION_CONFIRMATION, environment);
  return client.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('lnx-production-catalog-import')) IS NULL AS locked`;
    const plan = await inspectCatalog(transaction as unknown as CatalogDatabase);
    assertPlanSafe(plan);
    let created = 0;
    for (const { record } of canonicalCatalogRecords()) {
      if (!plan.creates.includes(record.slug)) continue;
      await transaction.project.create({
        data: {
          slug: record.slug,
          title: record.title,
          subtitle: record.subtitle,
          type: record.type,
          status: record.status,
          publicVisible: true,
          catalogPosition: record.catalogPosition,
          highlighted: record.highlighted,
          featured: record.featured,
          shortDescription: record.shortDescription,
          description: record.description,
          releaseDate: record.releaseDate,
          trackCount: record.trackCount,
          artworkTone: record.artworkTone,
          seoTitle: record.seoTitle,
          seoDescription: record.seoDescription,
          legacySourceVersion: record.legacySourceVersion,
          confidence: record.confidence,
          tracks: { create: record.tracks },
          platformLinks: { create: record.platformLinks },
          credits: { create: record.credits },
          confidenceAnnotations: { create: record.confidenceAnnotations as never },
        },
      });
      created += 1;
      await hooks.afterCreate?.(created);
    }
    return { created, skipped: plan.skips.length, sourceProjects: plan.sourceProjects };
  });
}
