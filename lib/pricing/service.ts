import "server-only";

import { Prisma } from "@/generated/prisma/client";
import {
  MUSIC_PRICING_CONFIGURATION_KEY,
  MUSIC_PRICING_CURRENCY,
  nextMusicPricingVersionLabel,
  parseExpectedMusicPricingRevision,
  validateMusicPricingDraft,
  type MusicPricingDraftInput,
} from "@/lib/pricing/domain";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";

type Transaction = Prisma.TransactionClient;

export type MusicPricingActivationDependencies = {
  assertConfigured?(): void;
  transaction<T>(operation: (transaction: Transaction) => Promise<T>): Promise<T>;
};

const databaseActivationDependencies: MusicPricingActivationDependencies = {
  assertConfigured: assertDatabaseConfigured,
  transaction: (operation) => prisma.$transaction(
    operation,
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  ),
};

export type MusicPricingServiceErrorCode =
  | "NOT_CONFIGURED"
  | "CONFIGURATION_INVALID"
  | "REVISION_CONFLICT"
  | "UNCHANGED";

export class MusicPricingServiceError extends Error {
  constructor(readonly code: MusicPricingServiceErrorCode, message: string) {
    super(message);
    this.name = "MusicPricingServiceError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object";
}

function isMusicPricingConcurrencyError(error: unknown) {
  if (!isRecord(error)) return false;
  if (error.code === "P2034") return true;
  if (error.code !== "P2039" || !isRecord(error.meta)) return false;

  const adapterError = error.meta.driverAdapterError;
  if (!isRecord(adapterError) || !isRecord(adapterError.cause)) return false;

  // @prisma/adapter-pg may wrap a concurrent interactive-transaction startup
  // as P2039/SQLSTATE 25001 instead of P2034. It is still a fail-before-write
  // concurrency outcome; never retry it automatically from this Admin action.
  return adapterError.cause.originalCode === "25001"
    && adapterError.cause.originalMessage === "SET TRANSACTION ISOLATION LEVEL must be called before any query";
}

function assertStoredVersionIsValid(version: {
  status: string;
  currency: string;
  basePriceCents: number;
  coverPriceCents: number;
  priorityPriceCents: number;
}) {
  if (
    version.status !== "ACTIVE"
    || version.currency !== MUSIC_PRICING_CURRENCY
    || !Number.isSafeInteger(version.basePriceCents)
    || version.basePriceCents <= 0
    || !Number.isSafeInteger(version.coverPriceCents)
    || version.coverPriceCents < 0
    || !Number.isSafeInteger(version.priorityPriceCents)
    || version.priorityPriceCents < 0
  ) {
    throw new MusicPricingServiceError(
      "CONFIGURATION_INVALID",
      "La configuration tarifaire active est invalide.",
    );
  }
}

export async function getAdminMusicPricingOverview() {
  assertDatabaseConfigured();
  const configuration = await prisma.musicPricingConfiguration.findUnique({
    where: { key: MUSIC_PRICING_CONFIGURATION_KEY },
    include: { activeVersion: true },
  });
  if (!configuration) return null;

  assertStoredVersionIsValid(configuration.activeVersion);
  const [versions, activations] = await Promise.all([
    prisma.musicPricingVersion.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      include: {
        createdByAdmin: { select: { id: true, displayName: true } },
      },
    }),
    prisma.musicPricingActivation.findMany({
      orderBy: [{ occurredAt: "desc" }, { id: "desc" }],
      include: {
        previousVersion: { select: { version: true } },
        activatedVersion: { select: { version: true } },
        actorAdmin: { select: { id: true, displayName: true } },
      },
    }),
  ]);

  return { configuration, versions, activations };
}

function pricingIsUnchanged(
  active: {
    currency: string;
    basePriceCents: number;
    coverPriceCents: number;
    priorityPriceCents: number;
  },
  next: ReturnType<typeof validateMusicPricingDraft>,
) {
  return active.currency === next.currency
    && active.basePriceCents === next.basePriceCents
    && active.coverPriceCents === next.coverPriceCents
    && active.priorityPriceCents === next.priorityPriceCents;
}

async function activateInTransaction(
  transaction: Transaction,
  input: {
    expectedRevision: number;
    actorAdminId: string;
    pricing: ReturnType<typeof validateMusicPricingDraft>;
  },
) {
  await transaction.$queryRaw`
    SELECT pg_advisory_xact_lock(hashtext(${"music-pricing:MUSIC_ORDER"})) IS NULL AS locked
  `;

  const configuration = await transaction.musicPricingConfiguration.findUnique({
    where: { key: MUSIC_PRICING_CONFIGURATION_KEY },
    include: { activeVersion: true },
  });
  if (!configuration) {
    throw new MusicPricingServiceError(
      "NOT_CONFIGURED",
      "La tarification initiale n’est pas configurée.",
    );
  }

  assertStoredVersionIsValid(configuration.activeVersion);
  if (configuration.revision !== input.expectedRevision) {
    throw new MusicPricingServiceError(
      "REVISION_CONFLICT",
      "Une nouvelle version tarifaire a été activée depuis l’ouverture de cette page.",
    );
  }
  if (pricingIsUnchanged(configuration.activeVersion, input.pricing)) {
    throw new MusicPricingServiceError("UNCHANGED", "Aucun tarif n’a changé.");
  }

  const nextRevision = configuration.revision + 1;
  if (!Number.isSafeInteger(nextRevision) || nextRevision > 999_999_999) {
    throw new MusicPricingServiceError("CONFIGURATION_INVALID", "La révision tarifaire est invalide.");
  }
  const version = nextMusicPricingVersionLabel(configuration.activeVersion.version, nextRevision);
  const occurredAt = new Date();

  const retired = await transaction.musicPricingVersion.updateMany({
    where: { id: configuration.activeVersion.id, status: "ACTIVE" },
    data: { status: "RETIRED", retiredAt: occurredAt },
  });
  if (retired.count !== 1) {
    throw new MusicPricingServiceError(
      "REVISION_CONFLICT",
      "La version tarifaire active a changé. Rechargez la page.",
    );
  }

  const activatedVersion = await transaction.musicPricingVersion.create({
    data: {
      version,
      status: "ACTIVE",
      currency: input.pricing.currency,
      basePriceCents: input.pricing.basePriceCents,
      coverPriceCents: input.pricing.coverPriceCents,
      priorityPriceCents: input.pricing.priorityPriceCents,
      source: "ADMIN",
      createdByAdminId: input.actorAdminId,
      activatedAt: occurredAt,
    },
  });

  const updated = await transaction.musicPricingConfiguration.updateMany({
    where: {
      key: MUSIC_PRICING_CONFIGURATION_KEY,
      revision: input.expectedRevision,
      activeVersionId: configuration.activeVersion.id,
    },
    data: {
      activeVersionId: activatedVersion.id,
      revision: nextRevision,
      updatedByAdminId: input.actorAdminId,
    },
  });
  if (updated.count !== 1) {
    throw new MusicPricingServiceError(
      "REVISION_CONFLICT",
      "Une nouvelle version tarifaire a été activée. Rechargez la page.",
    );
  }

  await transaction.musicPricingActivation.create({
    data: {
      previousVersionId: configuration.activeVersion.id,
      activatedVersionId: activatedVersion.id,
      actorAdminId: input.actorAdminId,
      source: "ADMIN",
      configurationRevision: nextRevision,
      occurredAt,
    },
  });

  return { version: activatedVersion, revision: nextRevision };
}

export async function createAndActivateMusicPricingVersion(input: {
  expectedRevision: unknown;
  actorAdminId: string;
  pricing: MusicPricingDraftInput;
}, dependencies: MusicPricingActivationDependencies = databaseActivationDependencies) {
  dependencies.assertConfigured?.();
  if (!/^[0-9a-f-]{36}$/i.test(input.actorAdminId)) {
    throw new MusicPricingServiceError("CONFIGURATION_INVALID", "L’administrateur est invalide.");
  }

  const expectedRevision = parseExpectedMusicPricingRevision(input.expectedRevision);
  const pricing = validateMusicPricingDraft(input.pricing);

  try {
    return await dependencies.transaction(
      (transaction) => activateInTransaction(transaction, {
        expectedRevision,
        actorAdminId: input.actorAdminId,
        pricing,
      }),
    );
  } catch (error) {
    if (isMusicPricingConcurrencyError(error)) {
      throw new MusicPricingServiceError(
        "REVISION_CONFLICT",
        "Une activation tarifaire concurrente a été détectée. Rechargez la page.",
      );
    }
    throw error;
  }
}
