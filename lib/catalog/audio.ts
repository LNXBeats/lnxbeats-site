import "server-only";

import { randomUUID } from "node:crypto";
import { readFile, stat } from "node:fs/promises";

import type { Prisma } from "@/generated/prisma/client";
import { analyzeAudioSource, CatalogFfmpegError, generateCatalogMp3Preview } from "@/lib/catalog/ffmpeg";
import { createGeneratedPreviewTempPath, removeAudioTempFile } from "@/lib/catalog/audio-temp";
import { removeCatalogAudioPreview, writeCatalogAudioPreview } from "@/lib/catalog/media-storage";
import { prisma } from "@/lib/prisma";
import type { MediaStorageReference } from "@/lib/media/storage";

export const CATALOG_AUDIO_PREVIEW_MAXIMUM_DURATION_MS = 60_000;

export type CatalogAudioErrorCode =
  | "UNREADABLE_AUDIO"
  | "GENERATION_FAILED"
  | "INVALID_OFFSET"
  | "INVALID_DURATION"
  | "INVALID_VERSION"
  | "NO_AUDIO";

export class CatalogAudioError extends Error {
  constructor(readonly code: CatalogAudioErrorCode) {
    super(code);
    this.name = "CatalogAudioError";
  }
}

export class CatalogAudioConflictError extends Error {
  constructor(readonly currentAudioAssetId: string | null) {
    super("L’extrait audio a été modifié depuis l’ouverture de cette fiche.");
    this.name = "CatalogAudioConflictError";
  }
}

export function catalogAudioVersionMatches(expectedAudioAssetId: string | null, currentAudioAssetId: string | null) {
  return expectedAudioAssetId === currentAudioAssetId;
}

export function catalogAudioRightsConfirmed(value: unknown) {
  return value === "on";
}

export function catalogAudioIsPublicProjectStatus(status: string) {
  return status === "PUBLISHED";
}

function parseExpectedAudioAssetId(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^[0-9a-f-]{36}$/i.test(value)) throw new CatalogAudioError("INVALID_VERSION");
  return value;
}

function parseInteger(value: unknown, code: "INVALID_OFFSET" | "INVALID_DURATION") {
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new CatalogAudioError(code);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new CatalogAudioError(code);
  return parsed;
}

export function resolvedAudioExcerpt(sourceDurationMs: number, rawOffsetMs: unknown, rawRequestedDurationMs: unknown) {
  if (!Number.isSafeInteger(sourceDurationMs) || sourceDurationMs <= 0) throw new CatalogAudioError("UNREADABLE_AUDIO");
  const offsetMs = parseInteger(rawOffsetMs, "INVALID_OFFSET");
  const requestedDurationMs = parseInteger(rawRequestedDurationMs, "INVALID_DURATION");
  if (offsetMs < 0 || offsetMs >= sourceDurationMs) throw new CatalogAudioError("INVALID_OFFSET");
  if (requestedDurationMs <= 0 || requestedDurationMs > CATALOG_AUDIO_PREVIEW_MAXIMUM_DURATION_MS) {
    throw new CatalogAudioError("INVALID_DURATION");
  }
  const durationMs = Math.min(requestedDurationMs, sourceDurationMs - offsetMs, CATALOG_AUDIO_PREVIEW_MAXIMUM_DURATION_MS);
  if (durationMs <= 0) throw new CatalogAudioError("INVALID_DURATION");
  return { offsetMs, requestedDurationMs, durationMs, adjustedToSourceEnd: durationMs < requestedDurationMs };
}

async function lockedAudioState(transaction: Prisma.TransactionClient, projectId: string) {
  await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`catalog-audio:${projectId}`})) IS NULL AS locked`;
  const project = await transaction.project.findUnique({
    where: { id: projectId },
    select: {
      assets: {
        where: { role: "AUDIO_PREVIEW" },
        orderBy: [{ position: "asc" }, { createdAt: "desc" }],
        take: 2,
        select: { asset: { select: { id: true, storageKey: true, storageBackend: true, storageProvider: true, visibility: true } } },
      },
    },
  });
  if (!project || project.assets.length > 1) throw new CatalogAudioError("INVALID_VERSION");
  return {
    currentAudioAssetId: project.assets[0]?.asset.id ?? null,
    currentAudioReference: project.assets[0]?.asset ?? null,
  };
}

async function assertCurrentAudioVersion(projectId: string, expectedAudioAssetId: string | null) {
  return prisma.$transaction(async (transaction) => {
    const state = await lockedAudioState(transaction, projectId);
    if (!catalogAudioVersionMatches(expectedAudioAssetId, state.currentAudioAssetId)) {
      throw new CatalogAudioConflictError(state.currentAudioAssetId);
    }
    return state;
  });
}

export async function generateAndReplaceCatalogAudioPreview({
  projectId,
  rawExpectedAudioAssetId,
  sourcePath,
  rawOffsetMs,
  rawRequestedDurationMs,
}: {
  projectId: string;
  rawExpectedAudioAssetId: unknown;
  sourcePath: string;
  rawOffsetMs: unknown;
  rawRequestedDurationMs: unknown;
}) {
  const expectedAudioAssetId = parseExpectedAudioAssetId(rawExpectedAudioAssetId);
  let generatedPath: string | null = null;
  let generatedStorageKey: string | null = null;
  try {
    // Reject stale forms before spending CPU on analysis/transcoding. The same
    // identity is checked under the project lock again at activation time.
    await assertCurrentAudioVersion(projectId, expectedAudioAssetId);
    const analysis = await analyzeAudioSource(sourcePath);
    const excerpt = resolvedAudioExcerpt(analysis.durationMs, rawOffsetMs, rawRequestedDurationMs);
    generatedPath = await createGeneratedPreviewTempPath();
    const generation = await generateCatalogMp3Preview({ sourcePath, outputPath: generatedPath, offsetMs: excerpt.offsetMs, durationMs: excerpt.durationMs });
    const generatedMetadata = await stat(generatedPath);
    if (!generatedMetadata.isFile() || generatedMetadata.size <= 0 || generatedMetadata.size > 3 * 1024 * 1024) {
      throw new CatalogAudioError("GENERATION_FAILED");
    }
    const verified = await analyzeAudioSource(generatedPath);
    if (Math.abs(verified.durationMs - excerpt.durationMs) > 1_250) throw new CatalogAudioError("GENERATION_FAILED");
    const generatedBytes = await readFile(generatedPath);
    generatedStorageKey = `catalog/audio-previews/${randomUUID()}.mp3`;
    const stored = await writeCatalogAudioPreview(generatedStorageKey, generatedBytes);
    let oldReference: Pick<MediaStorageReference, "storageKey" | "storageBackend" | "storageProvider" | "visibility"> | null = null;
    try {
      const created = await prisma.$transaction(async (transaction) => {
        const state = await lockedAudioState(transaction, projectId);
        if (!catalogAudioVersionMatches(expectedAudioAssetId, state.currentAudioAssetId)) {
          throw new CatalogAudioConflictError(state.currentAudioAssetId);
        }
        oldReference = state.currentAudioReference;
        if (state.currentAudioAssetId) {
          await transaction.projectAsset.deleteMany({ where: { projectId, role: "AUDIO_PREVIEW", assetId: state.currentAudioAssetId } });
          await transaction.asset.delete({ where: { id: state.currentAudioAssetId } });
        }
        const asset = await transaction.asset.create({
          data: {
            type: "AUDIO_PREVIEW",
            storageKey: generatedStorageKey!,
            filename: "audio-preview.mp3",
            mimeType: "audio/mpeg",
            sizeBytes: BigInt(generatedBytes.length),
            durationMs: verified.durationMs,
            storageBackend: stored.storageBackend,
            storageProvider: stored.storageProvider,
            visibility: stored.visibility,
            checksumSha256: stored.checksumSha256,
            rightsStatus: "CLEARED",
            confidence: "CONFIRMED",
          },
        });
        await transaction.projectAsset.create({ data: { projectId, assetId: asset.id, role: "AUDIO_PREVIEW", position: 0 } });
        await transaction.project.update({ where: { id: projectId }, data: { legacySourceVersion: null } });
        return asset;
      });
      if (oldReference) {
        try { await removeCatalogAudioPreview(oldReference); }
        catch { console.error("An obsolete catalogue audio preview could not be removed after replacement."); }
      }
      return {
        asset: created,
        sourceDurationMs: analysis.durationMs,
        durationMs: verified.durationMs,
        offsetMs: excerpt.offsetMs,
        adjustedToSourceEnd: excerpt.adjustedToSourceEnd,
        analysisElapsedMs: analysis.elapsedMs,
        generationElapsedMs: generation.elapsedMs,
      };
    } catch (error) {
      await removeCatalogAudioPreview({
        storageKey: generatedStorageKey,
        storageBackend: stored.storageBackend,
        storageProvider: stored.storageProvider,
        visibility: stored.visibility,
      });
      throw error;
    }
  } catch (error) {
    if (error instanceof CatalogFfmpegError) {
      throw new CatalogAudioError(error.code === "ANALYSIS_FAILED" ? "UNREADABLE_AUDIO" : "GENERATION_FAILED");
    }
    throw error;
  } finally {
    await removeAudioTempFile(generatedPath).catch(() => undefined);
    await removeAudioTempFile(sourcePath).catch(() => undefined);
  }
}

export async function deleteCatalogAudioPreview(projectId: string, rawExpectedAudioAssetId: unknown) {
  const expectedAudioAssetId = parseExpectedAudioAssetId(rawExpectedAudioAssetId);
  let oldReference: Pick<MediaStorageReference, "storageKey" | "storageBackend" | "storageProvider" | "visibility"> | null = null;
  await prisma.$transaction(async (transaction) => {
    const state = await lockedAudioState(transaction, projectId);
    if (!catalogAudioVersionMatches(expectedAudioAssetId, state.currentAudioAssetId)) {
      throw new CatalogAudioConflictError(state.currentAudioAssetId);
    }
    if (!state.currentAudioAssetId || !state.currentAudioReference) throw new CatalogAudioError("NO_AUDIO");
    oldReference = state.currentAudioReference;
    await transaction.projectAsset.deleteMany({ where: { projectId, role: "AUDIO_PREVIEW", assetId: state.currentAudioAssetId } });
    await transaction.asset.delete({ where: { id: state.currentAudioAssetId } });
    await transaction.project.update({ where: { id: projectId }, data: { legacySourceVersion: null } });
  });
  if (oldReference) {
    try { await removeCatalogAudioPreview(oldReference); }
    catch { console.error("A removed catalogue audio preview file could not be deleted."); }
  }
}
