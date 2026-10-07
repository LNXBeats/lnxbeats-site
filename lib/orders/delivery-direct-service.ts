import "server-only";
import { randomUUID } from "node:crypto";
import type { OrderDeliveryUploadSession } from "@/generated/prisma/client";
import { newSessionToken, parseSessionToken, sessionTokenHash, sessionTokenHashMatches } from "@/lib/creations/direct-upload-domain";
import { activeMediaStorage, activeMultipartMediaStorage } from "@/lib/media/storage/config";
import { MediaStorageError } from "@/lib/media/storage/types";
import { prisma } from "@/lib/prisma";
import { OrderDeliveryError, paidOrderForDelivery, withDeliveryOrderLock } from "@/lib/orders/delivery";
import { sanitizeOriginalFilename, type OrderActor } from "@/lib/orders/domain";
import { deliveryUploadMetadata, verifyDeliveryParts, DELIVERY_PART_BYTES, DELIVERY_URL_SECONDS, DELIVERY_SESSION_MS, type DeliveryUploadStatus } from "@/lib/orders/delivery-direct-contract";

export const ACTIVE_DELIVERY_UPLOAD_STATES = ["PREPARING", "UPLOADING", "COMPLETING", "QUARANTINE", "VALIDATING"];
export function deliveryMultipartIdentity(session: OrderDeliveryUploadSession) {
  if (!session.providerUploadId) throw new OrderDeliveryError("Le transfert n’est pas prêt. Réessayez.", 409, "UPLOAD_PREPARING");
  return { scope: "private" as const, key: session.storageKey, uploadId: session.providerUploadId };
}
export function deliveryR2Storage() {
  const storage = activeMediaStorage();
  if (storage.backend !== "OBJECT" || storage.provider !== "r2") throw new OrderDeliveryError("Le stockage privé est indisponible.", 503, "STORAGE_UNAVAILABLE");
  return storage;
}
async function authorized(actor: OrderActor, orderNumber: string, value: unknown) {
  if (actor.role !== "ADMIN") throw new OrderDeliveryError("Action réservée à l’administration.", 403, "ADMIN_REQUIRED");
  let token;
  try { token = parseSessionToken(value); }
  catch { throw new OrderDeliveryError("Session de transfert introuvable.", 404, "INVALID_SESSION"); }
  const session = await prisma.orderDeliveryUploadSession.findUnique({ where: { id: token.id }, include: { order: { select: { orderNumber: true } } } });
  if (!session || session.actorUserId !== actor.id || session.order.orderNumber !== orderNumber || !sessionTokenHashMatches(token.token, session.tokenHash)) {
    throw new OrderDeliveryError("Session de transfert introuvable.", 404, "INVALID_SESSION");
  }
  return { session, token: token.token };
}
async function ensureUnexpired(session: OrderDeliveryUploadSession) {
  if (["PREPARING", "UPLOADING"].includes(session.status) && session.expiresAt.getTime() <= Date.now()) {
    await prisma.orderDeliveryUploadSession.updateMany({ where: { id: session.id, status: { in: ["PREPARING", "UPLOADING"] } }, data: { status: "EXPIRED", lastErrorCode: "SESSION_EXPIRED" } });
    throw new OrderDeliveryError("La session d’envoi a expiré. Relancez le transfert.", 410, "SESSION_EXPIRED");
  }
}
export async function deliveryUploadStatus(actor: OrderActor, orderNumber: string, token: unknown): Promise<DeliveryUploadStatus> {
  const { session, token: parsed } = await authorized(actor, orderNumber, token);
  await ensureUnexpired(session);
  const parts = session.status === "UPLOADING" ? await activeMultipartMediaStorage().listMultipartParts(deliveryMultipartIdentity(session)) : [];
  return { sessionToken: parsed, status: session.status as DeliveryUploadStatus["status"], expiresAt: session.expiresAt.toISOString(),
    partSizeBytes: DELIVERY_PART_BYTES, partCount: Math.ceil(Number(session.declaredSizeBytes) / DELIVERY_PART_BYTES), completedParts: parts,
    error: session.status === "REJECTED" ? "Le livrable n’a pas pu être validé. Vérifiez son format et relancez le transfert."
      : session.status === "EXPIRED" ? "La session d’envoi a expiré. Relancez le transfert." : null,
    assetId: session.status === "READY" ? session.id : null };
}
export async function initializeDeliveryUpload(actor: OrderActor, orderNumber: string, value: unknown) {
  if (actor.role !== "ADMIN") throw new OrderDeliveryError("Action réservée à l’administration.", 403, "ADMIN_REQUIRED");
  let metadata;
  try { metadata = deliveryUploadMetadata(value); }
  catch (error) { throw new OrderDeliveryError(error instanceof Error ? error.message : "Métadonnées invalides.", 400, "INVALID_FILE"); }
  deliveryR2Storage();
  const multipart = activeMultipartMediaStorage();
  if (multipart.provider !== "r2") throw new OrderDeliveryError("Le stockage privé est indisponible.", 503, "STORAGE_UNAVAILABLE");
  const id = randomUUID(); const token = newSessionToken(id);
  // Reserve capacity under the SAME lock as legacy uploads and publication.
  // Provider calls are outside the database transaction.
  const session = await withDeliveryOrderLock(orderNumber, async (tx) => {
    const order = await paidOrderForDelivery(tx, orderNumber);
    const reserved = await tx.orderDeliveryUploadSession.count({ where: { orderId: order.id, status: { in: ACTIVE_DELIVERY_UPLOAD_STATES },
      OR: [{ expiresAt: { gt: new Date() } }, { status: { in: ["COMPLETING", "QUARANTINE", "VALIDATING"] } }] } });
    if (order.assets.length + reserved >= 8) throw new OrderDeliveryError("Cette commande contient déjà huit livrables ou transferts en cours.", 409, "DELIVERY_LIMIT_REACHED");
    return tx.orderDeliveryUploadSession.create({ data: { id, tokenHash: sessionTokenHash(token), actorUserId: actor.id, orderId: order.id,
      originalFilename: sanitizeOriginalFilename(metadata.filename), declaredMimeType: metadata.mimeType, declaredSizeBytes: BigInt(metadata.sizeBytes),
      storageKey: `orders/${order.id}/deliveries/${id}.${metadata.filename.split(".").pop()!.toLowerCase().replace(/^jpeg$/, "jpg")}`, expiresAt: new Date(Date.now() + DELIVERY_SESSION_MS) } });
  });
  let uploadId: string | null = null;
  try {
    ({ uploadId } = await multipart.createMultipartUpload({ scope: "private", key: session.storageKey, contentType: session.declaredMimeType,
      metadata: { "lnx-session-id": id, "lnx-order-id": session.orderId, "lnx-declared-size": String(session.declaredSizeBytes) } }));
    const changed = await prisma.orderDeliveryUploadSession.updateMany({ where: { id, status: "PREPARING" }, data: { status: "UPLOADING", providerUploadId: uploadId } });
    if (changed.count !== 1) throw new Error("reservation changed");
    return await deliveryUploadStatus(actor, orderNumber, token);
  } catch {
    if (uploadId) await multipart.abortMultipartUpload({ scope: "private", key: session.storageKey, uploadId }).catch(() => undefined);
    await prisma.orderDeliveryUploadSession.updateMany({ where: { id, status: "PREPARING" }, data: { status: "REJECTED", lastErrorCode: "INITIALIZATION_FAILED" } });
    throw new OrderDeliveryError("Le stockage privé est momentanément indisponible. Relancez le transfert.", 503, "STORAGE_UNAVAILABLE");
  }
}
export async function deliveryPartUrl(actor: OrderActor, orderNumber: string, token: unknown, partNumber: unknown) {
  const { session } = await authorized(actor, orderNumber, token);
  await ensureUnexpired(session);
  const count = Math.ceil(Number(session.declaredSizeBytes) / DELIVERY_PART_BYTES);
  if (session.expiresAt.getTime() - Date.now() < 30_000) throw new OrderDeliveryError("La session d’envoi a expiré. Relancez le transfert.", 410, "SESSION_EXPIRED");
  if (session.status !== "UPLOADING" || !Number.isSafeInteger(partNumber) || Number(partNumber) < 1 || Number(partNumber) > count) {
    throw new OrderDeliveryError("La partie demandée n’est pas disponible.", 409, "INVALID_PART");
  }
  return { url: await activeMultipartMediaStorage().createMultipartPartSignedUrl({ ...deliveryMultipartIdentity(session),
    partNumber: Number(partNumber), expiresInSeconds: Math.max(1, Math.min(DELIVERY_URL_SECONDS, Math.floor((session.expiresAt.getTime() - Date.now()) / 1000))) }) };
}
export async function verifyCompletedDeliveryObject(session: OrderDeliveryUploadSession) {
  const metadata = await deliveryR2Storage().head({ scope: "private", key: session.storageKey });
  if (metadata.contentLength !== Number(session.declaredSizeBytes) || metadata.contentType !== session.declaredMimeType
    || metadata.customMetadata?.["lnx-session-id"] !== session.id || metadata.customMetadata?.["lnx-order-id"] !== session.orderId
    || metadata.customMetadata?.["lnx-declared-size"] !== String(session.declaredSizeBytes)) {
    throw new OrderDeliveryError("La taille ou l’identité du fichier reçu ne correspond pas au transfert attendu.", 409, "STORAGE_INTEGRITY");
  }
}
export async function recoverDeliveryCompletion(session: OrderDeliveryUploadSession) {
  try { await verifyCompletedDeliveryObject(session); }
  catch (error) {
    if (!(error instanceof MediaStorageError) || error.code !== "NOT_FOUND") throw error;
    const storage = activeMultipartMediaStorage();
    let parts;
    try { parts = verifyDeliveryParts(Number(session.declaredSizeBytes), await storage.listMultipartParts(deliveryMultipartIdentity(session))); }
    catch { throw new OrderDeliveryError("Le transfert est incomplet. Réessayez les parties manquantes.", 409, "INCOMPLETE_UPLOAD"); }
    await storage.completeMultipartUpload({ ...deliveryMultipartIdentity(session), parts: parts.map(({ partNumber, etag }) => ({ partNumber, etag })) });
    await verifyCompletedDeliveryObject(session);
  }
  await prisma.orderDeliveryUploadSession.updateMany({ where: { id: session.id, status: "COMPLETING" }, data: { status: "QUARANTINE", leaseExpiresAt: null } });
}
export async function completeDeliveryUpload(actor: OrderActor, orderNumber: string, token: unknown) {
  const { session } = await authorized(actor, orderNumber, token);
  await ensureUnexpired(session);
  if (session.status === "UPLOADING") {
    // Validate the authoritative provider part list, not browser ETags.
    try { verifyDeliveryParts(Number(session.declaredSizeBytes), await activeMultipartMediaStorage().listMultipartParts(deliveryMultipartIdentity(session))); }
    catch { throw new OrderDeliveryError("Le transfert est incomplet. Réessayez les parties manquantes.", 409, "INCOMPLETE_UPLOAD"); }
    const claimed = await withDeliveryOrderLock(orderNumber, async (tx) => {
      await paidOrderForDelivery(tx, orderNumber);
      return tx.orderDeliveryUploadSession.updateMany({ where: { id: session.id, status: "UPLOADING", expiresAt: { gt: new Date() } },
        data: { status: "COMPLETING", leaseExpiresAt: new Date(Date.now() + 60_000) } });
    });
    if (claimed.count === 1) {
      // A lost provider response stays durable COMPLETING; the worker recovers
      // using HEAD before retrying completion. No Web source download occurs.
      await recoverDeliveryCompletion(session).catch(() => undefined);
    }
  } else if (!["COMPLETING", "QUARANTINE", "VALIDATING", "READY"].includes(session.status)) {
    throw new OrderDeliveryError("Cette session ne peut plus être finalisée. Relancez le transfert.", 409, "INVALID_STATE");
  }
  return deliveryUploadStatus(actor, orderNumber, token);
}
export async function abortDeliveryUpload(actor: OrderActor, orderNumber: string, token: unknown) {
  const { session } = await authorized(actor, orderNumber, token);
  if (session.status === "COMPLETING") throw new OrderDeliveryError("La finalisation est engagée. Attendez sa vérification avant de retirer le livrable.", 409, "COMPLETION_IN_PROGRESS");
  await withDeliveryOrderLock(orderNumber, (tx) => tx.orderDeliveryUploadSession.updateMany({ where: { id: session.id, status: { in: ["PREPARING", "UPLOADING", "QUARANTINE", "VALIDATING"] } }, data: { status: "ABORTED" } }));
  return deliveryUploadStatus(actor, orderNumber, token);
}
