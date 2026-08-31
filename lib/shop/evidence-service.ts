import "server-only";

import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

import type { PrismaClient } from "@/generated/prisma/client";
import { enqueueShopAfterSalesNotification } from "@/lib/notifications/service";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";
import { assertShopEvidenceCount, ShopEvidenceError, validateShopEvidenceUpload } from "@/lib/shop/evidence-domain";

type Actor = Readonly<{ id: string; role: "MEMBER" | "CUSTOMER" | "ADMIN"; status: string; emailVerified: boolean }>;
type EvidenceInput = Readonly<{ name: string; type: string; bytes: Uint8Array }>;
type StoredEvidence = ReturnType<typeof validateShopEvidenceUpload> & Readonly<{ storageKey: string }>;

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
  const root = path.resolve(options.root ?? shopSavPrivateRoot());
  const request = await client.shopReturnRequest.findFirst({
    where: actor.role === "ADMIN" ? { requestNumber } : { requestNumber, userId: actor.id },
    include: { evidence: { where: { status: "ACTIVE" }, select: { id: true } } },
  });
  if (!request) throw new ShopEvidenceError("ACCESS_DENIED");
  assertShopEvidenceCount(request.evidence.length, inputs.length);
  const validated = inputs.map((input) => ({ input, metadata: validateShopEvidenceUpload(input) }));
  const directory = path.join(root, "shop-return", request.id);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const written: string[] = [];
  try {
    const records: StoredEvidence[] = [];
    for (const entry of validated) {
      const filename = `${randomUUID()}${entry.metadata.extension}`;
      const temporary = path.join(directory, `.${filename}.tmp`);
      const destination = path.join(directory, filename);
      await writeFile(temporary, entry.input.bytes, { flag: "wx", mode: 0o600 });
      await rename(temporary, destination);
      written.push(destination);
      records.push({ ...entry.metadata, storageKey: path.relative(root, destination) });
    }
    return await client.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`shop-return-evidence:${request.id}`})) IS NULL AS locked`;
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
    await Promise.all(written.map((filename) => unlink(filename).catch(() => undefined)));
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
  const root = path.resolve(options.root ?? shopSavPrivateRoot());
  const absolute = path.resolve(root, evidence.storageKey);
  if (!absolute.startsWith(`${root}${path.sep}`)) throw new ShopEvidenceError("ACCESS_DENIED");
  return { evidence, absolute } as const;
}
