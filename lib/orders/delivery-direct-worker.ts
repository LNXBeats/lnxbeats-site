import "server-only";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import { prisma } from "@/lib/prisma";
import { downloadPrivateMultipartToTemporary } from "@/lib/creations/direct-upload-worker";
import { inspectOrderDeliveryFile } from "@/lib/orders/audio-request";
import { OrderDeliveryError, paidOrderForDelivery, withDeliveryOrderLock } from "@/lib/orders/delivery";
import { OrderUploadError } from "@/lib/orders/upload";
import { deliveryMultipartIdentity, deliveryR2Storage, recoverDeliveryCompletion } from "@/lib/orders/delivery-direct-service";
import { activeMultipartMediaStorage } from "@/lib/media/storage/config";

const LEASE_MS = 10 * 60 * 1000;
export async function cleanupDeliveryUploadSessions() {
  await prisma.orderDeliveryUploadSession.updateMany({ where: { status: { in: ["PREPARING", "UPLOADING"] }, expiresAt: { lte: new Date() } }, data: { status: "EXPIRED" } });
  const rows = await prisma.orderDeliveryUploadSession.findMany({ where: { status: { in: ["ABORTED", "EXPIRED", "REJECTED"] }, OR: [{ lastErrorCode: null }, { lastErrorCode: { not: "CLEANED" } }] }, take: 10, orderBy: { updatedAt: "asc" } });
  for (const row of rows) {
    try {
      if (row.providerUploadId) await activeMultipartMediaStorage().abortMultipartUpload(deliveryMultipartIdentity(row));
      await deliveryR2Storage().delete({ scope: "private", key: row.storageKey });
      await prisma.orderDeliveryUploadSession.updateMany({ where: { id: row.id, status: row.status }, data: { lastErrorCode: "CLEANED" } });
    } catch { /* Durable terminal row is retried next poll; never delete READY. */ }
  }
}
export async function processNextDeliveryValidation(options: { signal?: AbortSignal } = {}) {
  const now = new Date();
  const completing = await prisma.orderDeliveryUploadSession.findFirst({ where: { status: "COMPLETING", leaseExpiresAt: { lte: now } }, orderBy: { createdAt: "asc" } });
  if (completing) {
    const claimed = await prisma.orderDeliveryUploadSession.updateMany({ where: { id: completing.id, status: "COMPLETING", leaseExpiresAt: { lte: now } }, data: { leaseExpiresAt: new Date(now.getTime() + 60_000), attempts: { increment: 1 } } });
    if (claimed.count) {
      try { await recoverDeliveryCompletion(completing); }
      catch {
        if (completing.attempts >= 2) await prisma.orderDeliveryUploadSession.updateMany({ where: { id: completing.id, status: "COMPLETING" }, data: { status: "REJECTED", lastErrorCode: "COMPLETION_FAILED" } });
      }
    }
  }
  const candidate = await prisma.orderDeliveryUploadSession.findFirst({ where: { OR: [{ status: "QUARANTINE" }, { status: "VALIDATING", leaseExpiresAt: { lte: now } }] }, orderBy: { createdAt: "asc" } });
  if (!candidate || options.signal?.aborted) return { processed: false };
  const leaseToken = randomUUID();
  const claim = await prisma.orderDeliveryUploadSession.updateMany({ where: { id: candidate.id,
    OR: [{ status: "QUARANTINE" }, { status: "VALIDATING", leaseExpiresAt: { lte: now } }] },
    data: { status: "VALIDATING", leaseToken, leaseExpiresAt: new Date(now.getTime() + LEASE_MS), attempts: { increment: 1 } } });
  if (!claim.count) return { processed: false };
  const timer = setInterval(() => {
    void prisma.orderDeliveryUploadSession.updateMany({ where: { id: candidate.id, status: "VALIDATING", leaseToken }, data: { leaseExpiresAt: new Date(Date.now() + LEASE_MS) } }).catch(() => undefined);
  }, 60_000); timer.unref();
  let temporary: Awaited<ReturnType<typeof downloadPrivateMultipartToTemporary>> | null = null;
  try {
    const signal = options.signal ? AbortSignal.any([options.signal, AbortSignal.timeout(5 * 60_000)]) : AbortSignal.timeout(5 * 60_000);
    temporary = await downloadPrivateMultipartToTemporary({ id: candidate.id, ownerId: candidate.orderId, ownerMetadataKey: "lnx-order-id", provider: "r2",
      quarantineKey: candidate.storageKey, declaredSizeBytes: candidate.declaredSizeBytes, declaredMimeType: candidate.declaredMimeType }, { signal });
    const source = await inspectOrderDeliveryFile(temporary.target, { filename: candidate.originalFilename, mimeType: candidate.declaredMimeType,
      sizeBytes: Number(candidate.declaredSizeBytes), checksumSha256: temporary.checksumSha256 });
    const order = await prisma.order.findUniqueOrThrow({ where: { id: candidate.orderId }, select: { orderNumber: true } });
    await withDeliveryOrderLock(order.orderNumber, async (tx) => {
      const owned = await tx.orderDeliveryUploadSession.findFirst({ where: { id: candidate.id, status: "VALIDATING", leaseToken, leaseExpiresAt: { gt: new Date() } } });
      if (!owned) throw new OrderDeliveryError("Transfert annulé.", 409, "LEASE_LOST");
      const actor = await tx.user.findUnique({ where: { id: candidate.actorUserId }, select: { role: true, status: true, emailVerified: true } });
      if (!actor || actor.role !== "ADMIN" || actor.status !== "ACTIVE" || !actor.emailVerified) throw new OrderDeliveryError("Administrateur indisponible.", 403, "ADMIN_REQUIRED");
      const paid = await paidOrderForDelivery(tx, order.orderNumber);
      const position = paid.assets.reduce((highest, link) => Math.max(highest, link.position), -1) + 1;
      await tx.asset.create({ data: { id: candidate.id, type: source.assetType, filename: source.originalFilename, mimeType: source.mimeType,
        storageKey: candidate.storageKey, storageBackend: "OBJECT", storageProvider: "r2", visibility: "PRIVATE", sizeBytes: candidate.declaredSizeBytes,
        durationMs: source.durationMs, width: source.width, height: source.height, checksumSha256: source.checksumSha256,
        rightsStatus: "CLEARED", rightsNote: "Livrable privé déposé par l’administration pour cette commande.", confidence: "CONFIRMED" } });
      await tx.orderAsset.create({ data: { orderId: candidate.orderId, assetId: candidate.id, role: "DELIVERY", position } });
      await tx.orderEvent.create({ data: { orderId: candidate.orderId, fromStatus: null, toStatus: paid.status, actorUserId: candidate.actorUserId,
        visibility: "INTERNAL", note: `Livrable privé ajouté par l’administration (${source.extension.toUpperCase()}).` } });
      await tx.orderDeliveryUploadSession.update({ where: { id: candidate.id }, data: { status: "READY", leaseToken: null, leaseExpiresAt: null, lastErrorCode: null } });
    });
    return { processed: true, ready: true };
  } catch (error) {
    const terminal = error instanceof OrderUploadError || error instanceof OrderDeliveryError || candidate.attempts >= 2;
    await prisma.orderDeliveryUploadSession.updateMany({ where: { id: candidate.id, status: "VALIDATING", leaseToken },
      data: { status: terminal ? "REJECTED" : "QUARANTINE", leaseToken: null, leaseExpiresAt: null, lastErrorCode: terminal ? "VALIDATION_FAILED" : "VALIDATION_RETRY" } });
    return { processed: true, ready: false };
  } finally {
    clearInterval(timer);
    if (temporary) await rm(temporary.directory, { recursive: true, force: true });
  }
}
