import "server-only";

import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { enqueueShopAfterSalesNotification } from "@/lib/notifications/service";
import {
  activeStorageMetadata,
  deleteMediaObject,
  getMediaObject,
  putMediaObject,
  type MediaStorageReference,
} from "@/lib/media/storage";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";
import { assertShopEvidenceCount, ShopEvidenceError, validateShopEvidenceUpload } from "@/lib/shop/evidence-domain";
import { isStrictShopProductionEnvironment } from "@/lib/shop/production-environment";

type Actor = Readonly<{ id: string; role: "MEMBER" | "CUSTOMER" | "ADMIN"; status: string; emailVerified: boolean }>;
type EvidenceInput = Readonly<{ name: string; type: string; bytes: Uint8Array }>;
type StoredEvidence = ReturnType<typeof validateShopEvidenceUpload> & Readonly<{ storageKey: string }>;

function productionStorageReference(storageKey: string): MediaStorageReference {
  const storage = activeStorageMetadata();
  if (storage.storageBackend !== "OBJECT" || storage.storageProvider !== "r2") {
    throw new ShopEvidenceError("STORAGE_DISABLED");
  }
  return { storageKey, storageBackend: storage.storageBackend, storageProvider: storage.storageProvider, visibility: "PRIVATE" };
}

export function shopSavUsesPrivateObjectStorage(environment: NodeJS.ProcessEnv = process.env) {
  return isStrictShopProductionEnvironment(environment);
}

export async function deleteShopReturnEvidenceObject(
  storageKey: string,
  options: Readonly<{ root?: string; environment?: NodeJS.ProcessEnv }> = {},
) {
  const environment = options.environment ?? process.env;
  if (shopSavUsesPrivateObjectStorage(environment)) {
    await deleteMediaObject(productionStorageReference(storageKey));
    return;
  }
  const root = path.resolve(options.root ?? shopSavPrivateRoot(environment));
  const absolute = path.resolve(root, storageKey);
  if (!absolute.startsWith(`${root}${path.sep}`)) throw new ShopEvidenceError("ACCESS_DENIED");
  await unlink(absolute).catch((error: unknown) => {
    if (!(error && typeof error === "object" && "code" in error && error.code === "ENOENT")) throw error;
  });
}

export function shopSavPrivateRoot(environment: NodeJS.ProcessEnv = process.env) {
  const configured = environment.SHOP_SAV_PRIVATE_STORAGE_ROOT?.trim();
  if (!configured) throw new ShopEvidenceError("STORAGE_DISABLED");
  const resolved = path.resolve(configured);
  if (
    environment.NODE_ENV === "production"
    || environment.RAILWAY_ENVIRONMENT
    || environment.RAILWAY_ENVIRONMENT_NAME
    || environment.SHOP_PRODUCTION_READINESS_QA !== "true"
    || !resolved.startsWith("/private/tmp/lnxbeats-v110-phase5e-")
  ) throw new ShopEvidenceError("STORAGE_DISABLED");
  return resolved;
}

function assertActor(actor: Actor) {
  if (!actor.id || actor.status !== "ACTIVE" || !actor.emailVerified || !["MEMBER", "CUSTOMER", "ADMIN"].includes(actor.role)) {
    throw new ShopEvidenceError("ACCESS_DENIED");
  }
}

export async function addShopReturnEvidence(
  actor: Actor,
  requestNumber: string,
  inputs: readonly EvidenceInput[],
  options: Readonly<{ client?: PrismaClient; root?: string }> = {},
) {
  assertActor(actor);
  if (!options.client) assertDatabaseConfigured();
  const client = options.client ?? prisma;
  const objectStorage = !options.root && shopSavUsesPrivateObjectStorage();
  const root = objectStorage ? null : path.resolve(options.root ?? shopSavPrivateRoot());
  const request = await client.shopReturnRequest.findFirst({
    where: actor.role === "ADMIN" ? { requestNumber } : { requestNumber, userId: actor.id },
    include: { evidence: { where: { status: "ACTIVE" }, select: { id: true } } },
  });
  if (!request) throw new ShopEvidenceError("ACCESS_DENIED");
  if (request.closedAt) throw new ShopEvidenceError("ACCESS_DENIED");
  assertShopEvidenceCount(request.evidence.length, inputs.length);
  const validated = inputs.map((input) => ({ input, metadata: validateShopEvidenceUpload(input) }));
  const directory = root ? path.join(root, "shop-return", request.id) : null;
  if (directory) await mkdir(directory, { recursive: true, mode: 0o700 });
  const written: Array<{ storageKey: string; absolute?: string }> = [];
  try {
    const records: StoredEvidence[] = [];
    for (const entry of validated) {
      const filename = `${randomUUID()}${entry.metadata.extension}`;
      const storageKey = `shop-returns/${request.id}/${filename}`;
      if (objectStorage) {
        await putMediaObject({
          scope: "private",
          key: storageKey,
          body: entry.input.bytes,
          contentLength: entry.metadata.byteSize,
          contentType: entry.metadata.mimeType,
          checksumSha256: entry.metadata.sha256,
          contentDisposition: `inline; filename="evidence-${filename}"`,
        });
        written.push({ storageKey });
      } else {
        const temporary = path.join(directory!, `.${filename}.tmp`);
        const destination = path.join(directory!, filename);
        await writeFile(temporary, entry.input.bytes, { flag: "wx", mode: 0o600 });
        await rename(temporary, destination);
        written.push({ storageKey: path.relative(root!, destination), absolute: destination });
      }
      records.push({ ...entry.metadata, storageKey: written.at(-1)!.storageKey });
    }
    return await client.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`shop-return-evidence:${request.id}`})) IS NULL AS locked`;
      const currentRequest = await transaction.shopReturnRequest.findUnique({
        where: { id: request.id },
        select: { closedAt: true },
      });
      if (!currentRequest || currentRequest.closedAt) throw new ShopEvidenceError("ACCESS_DENIED");
      const activeCount = await transaction.shopReturnEvidence.count({ where: { shopReturnRequestId: request.id, status: "ACTIVE" } });
      assertShopEvidenceCount(activeCount, records.length);
      const created = [];
      for (const record of records) {
        created.push(await transaction.shopReturnEvidence.create({ data: {
          shopReturnRequestId: request.id,
          uploaderUserId: actor.id,
          originalName: record.originalName,
          storageKey: record.storageKey,
          mimeType: record.mimeType,
          byteSize: record.byteSize,
          sha256: record.sha256,
        } }));
      }
      await transaction.shopReturnAuditEvent.create({ data: {
        shopReturnRequestId: request.id,
        actorUserId: actor.id,
        action: "EVIDENCE_ADDED",
        metadata: { count: created.length },
      } });
      await enqueueShopAfterSalesNotification(transaction, {
        shopOrderId: request.shopOrderId,
        requestId: request.id,
        requestNumber: request.requestNumber,
        kind: "OWNER_SHOP_SAV_EVIDENCE_ADDED",
      });
      return created;
    });
  } catch (error) {
    const cleanup = await Promise.allSettled(written.map((item) => item.absolute
      ? unlink(item.absolute)
      : deleteMediaObject(productionStorageReference(item.storageKey))));
    cleanup.forEach((result, index) => {
      if (result.status === "rejected") console.error(JSON.stringify({
        event: "shop.sav.evidence.compensation_failed",
        storageKeySha256: createHash("sha256").update(written[index]!.storageKey).digest("hex"),
      }));
    });
    throw error;
  }
}

export async function getAuthorizedShopReturnEvidence(
  actor: Actor,
  evidenceId: string,
  options: Readonly<{ client?: PrismaClient; root?: string }> = {},
) {
  assertActor(actor);
  const client = options.client ?? prisma;
  const evidence = await client.shopReturnEvidence.findFirst({
    where: {
      id: evidenceId,
      status: "ACTIVE",
      ...(actor.role === "ADMIN" ? {} : { request: { userId: actor.id } }),
    },
  });
  if (!evidence) throw new ShopEvidenceError("ACCESS_DENIED");
  if (!options.root && shopSavUsesPrivateObjectStorage()) {
    const object = await getMediaObject(productionStorageReference(evidence.storageKey));
    return { source: "OBJECT" as const, evidence, body: object.body };
  }
  const root = path.resolve(options.root ?? shopSavPrivateRoot());
  const absolute = path.resolve(root, evidence.storageKey);
  if (!absolute.startsWith(`${root}${path.sep}`)) throw new ShopEvidenceError("ACCESS_DENIED");
  return { source: "LOCAL" as const, evidence, absolute };
}
