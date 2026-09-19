import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";
import { assertCreationPublishable } from "@/lib/creations/domain";
import {
  CreationValidationError,
  parseCreationCollaboratorInput,
  parseCreationCollaboratorLinkInput,
  parseCreationEditorInput,
  parseCreationExternalLinkInput,
} from "@/lib/creations/validation";

type Transaction = Prisma.TransactionClient;

export class CreationServiceError extends Error {
  constructor(
    message: string,
    readonly code:
      | "NOT_FOUND"
      | "CONFLICT"
      | "SLUG_TAKEN"
      | "SLUG_IMMUTABLE"
      | "ARCHIVED"
      | "MUST_UNPUBLISH"
      | "LINK_NOT_FOUND"
      | "LINK_TAKEN"
      | "COLLABORATOR_NOT_FOUND"
      | "COLLABORATOR_LINK_NOT_FOUND"
      | "COLLABORATOR_LINK_TAKEN",
  ) {
    super(message);
    this.name = "CreationServiceError";
  }
}

async function withCreationLock<T>(creationId: string, operation: (transaction: Transaction) => Promise<T>) {
  assertDatabaseConfigured();
  return prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`creation:${creationId}`})) IS NULL AS locked`;
    return operation(transaction);
  });
}

function normalizeStatus(value: string) {
  return value === "DRAFT" || value === "PUBLISHED" || value === "ARCHIVED" ? value : null;
}

export async function listAdminCreations(query = "", status = "all", requestedPage = 1, pageSize = 18) {
  assertDatabaseConfigured();
  const normalizedQuery = query.trim().slice(0, 120);
  const normalizedStatus = normalizeStatus(status);
  const where: Prisma.CreationWhereInput = {
    ...(normalizedStatus ? { status: normalizedStatus } : {}),
    ...(normalizedQuery ? {
      OR: [
        { title: { contains: normalizedQuery, mode: "insensitive" } },
        { slug: { contains: normalizedQuery, mode: "insensitive" } },
        { collaborator: { contains: normalizedQuery, mode: "insensitive" } },
        { collaborators: { some: { displayName: { contains: normalizedQuery, mode: "insensitive" } } } },
      ],
    } : {}),
  };
  const total = await prisma.creation.count({ where });
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, Math.trunc(requestedPage) || 1), pageCount);
  const [creations, groupedStatuses] = await Promise.all([
    prisma.creation.findMany({
      where,
      include: { _count: { select: { assets: true, externalLinks: true, collaborators: true } } },
      orderBy: [{ position: "asc" }, { createdAt: "desc" }, { id: "asc" }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    prisma.creation.groupBy({ by: ["status"], _count: { _all: true } }),
  ]);
  const counts = { DRAFT: 0, PUBLISHED: 0, ARCHIVED: 0 };
  for (const entry of groupedStatuses) counts[entry.status] = entry._count._all;
  return { creations, total, page, pageCount, counts };
}

export async function getAdminCreation(slug: string) {
  assertDatabaseConfigured();
  return prisma.creation.findUnique({
    where: { slug },
    include: {
      assets: { include: { asset: true }, orderBy: { role: "asc" } },
      externalLinks: { orderBy: [{ position: "asc" }, { id: "asc" }] },
      collaborators: {
        orderBy: [{ position: "asc" }, { id: "asc" }],
        include: { links: { orderBy: [{ position: "asc" }, { id: "asc" }] } },
      },
    },
  });
}

export async function getAdminCreationSlugById(creationId: string) {
  assertDatabaseConfigured();
  return prisma.creation.findUnique({ where: { id: creationId }, select: { slug: true } });
}

export async function createAdminCreation(input: Record<string, unknown>) {
  assertDatabaseConfigured();
  const values = parseCreationEditorInput(input);
  try {
    return await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('creation-record-creation')) IS NULL AS locked`;
      if (await transaction.creation.findUnique({ where: { slug: values.slug }, select: { id: true } })) {
        throw new CreationServiceError("Ce slug est déjà utilisé.", "SLUG_TAKEN");
      }
      return transaction.creation.create({
        data: {
          ...values,
          status: "DRAFT",
          publishedAt: null,
          lockVersion: 1,
        },
      });
    });
  } catch (error) {
    if (error instanceof CreationServiceError || error instanceof CreationValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new CreationServiceError("Ce slug est déjà utilisé.", "SLUG_TAKEN");
    }
    throw error;
  }
}

function assertEditableCreation(current: { status: string; lockVersion: number }, expectedLockVersion: number) {
  if (current.status === "ARCHIVED") {
    throw new CreationServiceError("Une création archivée est en lecture seule.", "ARCHIVED");
  }
  if (current.lockVersion !== expectedLockVersion) {
    throw new CreationServiceError("La fiche a changé. Rechargez la page.", "CONFLICT");
  }
}

async function bumpLockVersion(transaction: Transaction, creationId: string, expectedLockVersion: number) {
  const update = await transaction.creation.updateMany({
    where: { id: creationId, lockVersion: expectedLockVersion, status: { not: "ARCHIVED" } },
    data: { lockVersion: { increment: 1 } },
  });
  if (update.count !== 1) {
    throw new CreationServiceError("La fiche a changé. Rechargez la page.", "CONFLICT");
  }
}

export async function updateAdminCreation(
  creationId: string,
  expectedLockVersion: number,
  input: Record<string, unknown>,
) {
  const values = parseCreationEditorInput(input);
  try {
    return await withCreationLock(creationId, async (transaction) => {
      const current = await transaction.creation.findUnique({
        where: { id: creationId },
        include: {
          assets: {
            include: {
              asset: {
                select: { visibility: true, type: true, mimeType: true, rightsStatus: true },
              },
            },
          },
        },
      });
      if (!current) throw new CreationServiceError("Création introuvable.", "NOT_FOUND");
      assertEditableCreation(current, expectedLockVersion);
      if (values.slug !== current.slug) {
        throw new CreationServiceError("Le slug d’une création existante est immuable.", "SLUG_IMMUTABLE");
      }
      // A published row must stay publishable after every editorial update.
      // Lifecycle fields remain service-owned, while this check prevents an
      // Admin edit from silently exposing an incomplete or incoherent record.
      if (current.status === "PUBLISHED") {
        assertCreationPublishable({
          title: values.title,
          summary: values.summary,
          primaryMedia: values.primaryMedia,
          assets: current.assets,
        });
      }
      const update = await transaction.creation.updateMany({
        where: { id: creationId, lockVersion: expectedLockVersion, status: { not: "ARCHIVED" } },
        data: { ...values, lockVersion: { increment: 1 } },
      });
      if (update.count !== 1) throw new CreationServiceError("La fiche a changé. Rechargez la page.", "CONFLICT");
      return transaction.creation.findUniqueOrThrow({ where: { id: creationId } });
    });
  } catch (error) {
    if (error instanceof CreationServiceError || error instanceof CreationValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new CreationServiceError("Ce slug est déjà utilisé.", "SLUG_TAKEN");
    }
    throw error;
  }
}

export async function publishAdminCreation(creationId: string, expectedLockVersion: number) {
  return withCreationLock(creationId, async (transaction) => {
    const current = await transaction.creation.findUnique({
      where: { id: creationId },
      include: {
        assets: {
          include: {
            asset: {
              select: { visibility: true, type: true, mimeType: true, rightsStatus: true },
            },
          },
        },
      },
    });
    if (!current) throw new CreationServiceError("Création introuvable.", "NOT_FOUND");
    assertEditableCreation(current, expectedLockVersion);
    assertCreationPublishable(current);
    if (current.status === "PUBLISHED") return current;
    const update = await transaction.creation.updateMany({
      where: { id: creationId, lockVersion: expectedLockVersion, status: "DRAFT" },
      data: { status: "PUBLISHED", publishedAt: new Date(), lockVersion: { increment: 1 } },
    });
    if (update.count !== 1) throw new CreationServiceError("La publication est entrée en conflit.", "CONFLICT");
    return transaction.creation.findUniqueOrThrow({ where: { id: creationId } });
  });
}

export async function unpublishAdminCreation(creationId: string, expectedLockVersion: number) {
  return withCreationLock(creationId, async (transaction) => {
    const current = await transaction.creation.findUnique({ where: { id: creationId } });
    if (!current) throw new CreationServiceError("Création introuvable.", "NOT_FOUND");
    assertEditableCreation(current, expectedLockVersion);
    if (current.status === "DRAFT") return current;
    const update = await transaction.creation.updateMany({
      where: { id: creationId, lockVersion: expectedLockVersion, status: "PUBLISHED" },
      data: { status: "DRAFT", publishedAt: null, lockVersion: { increment: 1 } },
    });
    if (update.count !== 1) throw new CreationServiceError("La dépublication est entrée en conflit.", "CONFLICT");
    return transaction.creation.findUniqueOrThrow({ where: { id: creationId } });
  });
}

export async function archiveAdminCreation(creationId: string, expectedLockVersion: number) {
  return withCreationLock(creationId, async (transaction) => {
    const current = await transaction.creation.findUnique({ where: { id: creationId } });
    if (!current) throw new CreationServiceError("Création introuvable.", "NOT_FOUND");
    if (current.lockVersion !== expectedLockVersion) {
      throw new CreationServiceError("La fiche a changé. Rechargez la page.", "CONFLICT");
    }
    if (current.status === "ARCHIVED") return current;
    if (current.status === "PUBLISHED") {
      throw new CreationServiceError("Dépubliez la création avant de l’archiver.", "MUST_UNPUBLISH");
    }
    const update = await transaction.creation.updateMany({
      where: { id: creationId, lockVersion: expectedLockVersion, status: "DRAFT" },
      data: { status: "ARCHIVED", publishedAt: null, lockVersion: { increment: 1 } },
    });
    if (update.count !== 1) throw new CreationServiceError("L’archivage est entré en conflit.", "CONFLICT");
    return transaction.creation.findUniqueOrThrow({ where: { id: creationId } });
  });
}

export async function createAdminCreationExternalLink(
  creationId: string,
  expectedLockVersion: number,
  input: Record<string, unknown>,
) {
  const values = parseCreationExternalLinkInput(input);
  try {
    return await withCreationLock(creationId, async (transaction) => {
      const current = await transaction.creation.findUnique({ where: { id: creationId } });
      if (!current) throw new CreationServiceError("Création introuvable.", "NOT_FOUND");
      assertEditableCreation(current, expectedLockVersion);
      const link = await transaction.creationExternalLink.create({ data: { creationId, ...values } });
      await bumpLockVersion(transaction, creationId, expectedLockVersion);
      return link;
    });
  } catch (error) {
    if (error instanceof CreationServiceError || error instanceof CreationValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new CreationServiceError("Ce lien est déjà associé à la création.", "LINK_TAKEN");
    }
    throw error;
  }
}

export async function updateAdminCreationExternalLink(
  creationId: string,
  linkId: string,
  expectedLockVersion: number,
  input: Record<string, unknown>,
) {
  const values = parseCreationExternalLinkInput(input);
  try {
    return await withCreationLock(creationId, async (transaction) => {
      const current = await transaction.creation.findUnique({ where: { id: creationId } });
      if (!current) throw new CreationServiceError("Création introuvable.", "NOT_FOUND");
      assertEditableCreation(current, expectedLockVersion);
      const link = await transaction.creationExternalLink.findFirst({ where: { id: linkId, creationId } });
      if (!link) throw new CreationServiceError("Lien externe introuvable.", "LINK_NOT_FOUND");
      await transaction.creationExternalLink.update({ where: { id: linkId }, data: values });
      await bumpLockVersion(transaction, creationId, expectedLockVersion);
      return transaction.creationExternalLink.findUniqueOrThrow({ where: { id: linkId } });
    });
  } catch (error) {
    if (error instanceof CreationServiceError || error instanceof CreationValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new CreationServiceError("Ce lien est déjà associé à la création.", "LINK_TAKEN");
    }
    throw error;
  }
}

export async function deleteAdminCreationExternalLink(
  creationId: string,
  linkId: string,
  expectedLockVersion: number,
) {
  return withCreationLock(creationId, async (transaction) => {
    const current = await transaction.creation.findUnique({ where: { id: creationId } });
    if (!current) throw new CreationServiceError("Création introuvable.", "NOT_FOUND");
    assertEditableCreation(current, expectedLockVersion);
    const deleted = await transaction.creationExternalLink.deleteMany({ where: { id: linkId, creationId } });
    if (deleted.count !== 1) throw new CreationServiceError("Lien externe introuvable.", "LINK_NOT_FOUND");
    await bumpLockVersion(transaction, creationId, expectedLockVersion);
  });
}

export async function createAdminCreationCollaborator(
  creationId: string,
  expectedLockVersion: number,
  input: Record<string, unknown>,
) {
  const values = parseCreationCollaboratorInput(input);
  return withCreationLock(creationId, async (transaction) => {
    const current = await transaction.creation.findUnique({ where: { id: creationId } });
    if (!current) throw new CreationServiceError("Création introuvable.", "NOT_FOUND");
    assertEditableCreation(current, expectedLockVersion);
    const collaborator = await transaction.creationCollaborator.create({ data: { creationId, ...values } });
    await bumpLockVersion(transaction, creationId, expectedLockVersion);
    return collaborator;
  });
}

export async function updateAdminCreationCollaborator(
  creationId: string,
  collaboratorId: string,
  expectedLockVersion: number,
  input: Record<string, unknown>,
) {
  const values = parseCreationCollaboratorInput(input);
  return withCreationLock(creationId, async (transaction) => {
    const current = await transaction.creation.findUnique({ where: { id: creationId } });
    if (!current) throw new CreationServiceError("Création introuvable.", "NOT_FOUND");
    assertEditableCreation(current, expectedLockVersion);
    const collaborator = await transaction.creationCollaborator.findFirst({ where: { id: collaboratorId, creationId } });
    if (!collaborator) throw new CreationServiceError("Collaborateur introuvable.", "COLLABORATOR_NOT_FOUND");
    await transaction.creationCollaborator.update({ where: { id: collaboratorId }, data: values });
    await bumpLockVersion(transaction, creationId, expectedLockVersion);
    return transaction.creationCollaborator.findUniqueOrThrow({ where: { id: collaboratorId } });
  });
}

export async function deleteAdminCreationCollaborator(
  creationId: string,
  collaboratorId: string,
  expectedLockVersion: number,
) {
  return withCreationLock(creationId, async (transaction) => {
    const current = await transaction.creation.findUnique({ where: { id: creationId } });
    if (!current) throw new CreationServiceError("Création introuvable.", "NOT_FOUND");
    assertEditableCreation(current, expectedLockVersion);
    const collaborator = await transaction.creationCollaborator.findFirst({ where: { id: collaboratorId, creationId } });
    if (!collaborator) throw new CreationServiceError("Collaborateur introuvable.", "COLLABORATOR_NOT_FOUND");
    await transaction.creationCollaboratorLink.deleteMany({ where: { collaboratorId } });
    await transaction.creationCollaborator.delete({ where: { id: collaboratorId } });
    await bumpLockVersion(transaction, creationId, expectedLockVersion);
  });
}

async function collaboratorForCreation(transaction: Transaction, creationId: string, collaboratorId: string) {
  const collaborator = await transaction.creationCollaborator.findFirst({ where: { id: collaboratorId, creationId } });
  if (!collaborator) throw new CreationServiceError("Collaborateur introuvable.", "COLLABORATOR_NOT_FOUND");
  return collaborator;
}

export async function createAdminCreationCollaboratorLink(
  creationId: string,
  collaboratorId: string,
  expectedLockVersion: number,
  input: Record<string, unknown>,
) {
  const values = parseCreationCollaboratorLinkInput(input);
  try {
    return await withCreationLock(creationId, async (transaction) => {
      const current = await transaction.creation.findUnique({ where: { id: creationId } });
      if (!current) throw new CreationServiceError("Création introuvable.", "NOT_FOUND");
      assertEditableCreation(current, expectedLockVersion);
      await collaboratorForCreation(transaction, creationId, collaboratorId);
      const link = await transaction.creationCollaboratorLink.create({ data: { collaboratorId, ...values } });
      await bumpLockVersion(transaction, creationId, expectedLockVersion);
      return link;
    });
  } catch (error) {
    if (error instanceof CreationServiceError || error instanceof CreationValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new CreationServiceError("Ce lien est déjà associé à ce collaborateur.", "COLLABORATOR_LINK_TAKEN");
    }
    throw error;
  }
}

export async function updateAdminCreationCollaboratorLink(
  creationId: string,
  collaboratorId: string,
  linkId: string,
  expectedLockVersion: number,
  input: Record<string, unknown>,
) {
  const values = parseCreationCollaboratorLinkInput(input);
  try {
    return await withCreationLock(creationId, async (transaction) => {
      const current = await transaction.creation.findUnique({ where: { id: creationId } });
      if (!current) throw new CreationServiceError("Création introuvable.", "NOT_FOUND");
      assertEditableCreation(current, expectedLockVersion);
      await collaboratorForCreation(transaction, creationId, collaboratorId);
      const link = await transaction.creationCollaboratorLink.findFirst({ where: { id: linkId, collaboratorId } });
      if (!link) throw new CreationServiceError("Lien du collaborateur introuvable.", "COLLABORATOR_LINK_NOT_FOUND");
      await transaction.creationCollaboratorLink.update({ where: { id: linkId }, data: values });
      await bumpLockVersion(transaction, creationId, expectedLockVersion);
      return transaction.creationCollaboratorLink.findUniqueOrThrow({ where: { id: linkId } });
    });
  } catch (error) {
    if (error instanceof CreationServiceError || error instanceof CreationValidationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new CreationServiceError("Ce lien est déjà associé à ce collaborateur.", "COLLABORATOR_LINK_TAKEN");
    }
    throw error;
  }
}

export async function deleteAdminCreationCollaboratorLink(
  creationId: string,
  collaboratorId: string,
  linkId: string,
  expectedLockVersion: number,
) {
  return withCreationLock(creationId, async (transaction) => {
    const current = await transaction.creation.findUnique({ where: { id: creationId } });
    if (!current) throw new CreationServiceError("Création introuvable.", "NOT_FOUND");
    assertEditableCreation(current, expectedLockVersion);
    await collaboratorForCreation(transaction, creationId, collaboratorId);
    const deleted = await transaction.creationCollaboratorLink.deleteMany({ where: { id: linkId, collaboratorId } });
    if (deleted.count !== 1) throw new CreationServiceError("Lien du collaborateur introuvable.", "COLLABORATOR_LINK_NOT_FOUND");
    await bumpLockVersion(transaction, creationId, expectedLockVersion);
  });
}
