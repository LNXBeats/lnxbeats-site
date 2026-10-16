import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import type { OrderActor } from "@/lib/orders/domain";
import { assertDigitalUuid, DigitalError, requireDigitalEnvironment, type DigitalMode } from "@/lib/digital/domain";
import { assessDigitalWithdrawalEvidence } from "./withdrawal-policy";
import { billingSnapshotHash } from "@/lib/billing/domain";
import { assertDigitalDatabaseUtc } from "@/lib/digital/database-time-policy";

type Tx = Prisma.TransactionClient;
async function admin(tx: Tx, actor: Pick<OrderActor, "id">) {
  if (!await tx.user.findFirst({ where: { id: actor.id, role: "ADMIN", status: "ACTIVE", emailVerified: true }, select: { id: true } })) throw new DigitalError("ADMIN_REQUIRED", 403);
}
const digitalEvidence = {
  mode:true,userId: true, earlyDelivery: true, withdrawalAcknowledged: true, termsVersion: true, termsHash: true, contractSnapshot: true,
  fulfillment: true,
  documents: { where: { kind: "CONTRACT" }, select: { id: true, kind: true, status: true, snapshotHash: true, pdfHash: true } },
  events: { where: { kind: { in: ["DOCUMENT_TRANSFER_FINISHED", "CONTRACT_RECEIPT_ACKNOWLEDGED", "DOWNLOAD_STARTED"] } }, orderBy: { createdAt: "desc" }, take: 100, select: { kind: true, actorId: true, createdAt: true, details: true } },
} satisfies Prisma.DigitalOrderSelect;

function modeScope(mode:DigitalMode):Prisma.ConsumerWithdrawalRequestWhereInput{
  return{OR:[{digitalOrder:{mode}},{digitalOrderId:null,...(mode==="LIVE"
    ?{acknowledgementSnapshot:{path:["digitalMode"],equals:"LIVE"}}
    :{OR:[{acknowledgementSnapshot:{path:["digitalMode"],equals:"TEST"}},
      {acknowledgementSnapshot:{path:["digitalMode"],equals:Prisma.AnyNull}}]})}]};
}
function matchesMode(request:{digitalOrderId:string|null;digitalOrder?:{mode?:string}|null;acknowledgementSnapshot?:unknown},mode:DigitalMode){
  if(request.digitalOrderId)return(request.digitalOrder?.mode??"TEST")===mode;
  const snapshot=request.acknowledgementSnapshot as {digitalMode?:string}|null|undefined;
  return mode==="LIVE"?snapshot?.digitalMode==="LIVE":snapshot?.digitalMode===undefined||snapshot.digitalMode==="TEST";
}

export async function listDigitalConsumerRequests(actor: Pick<OrderActor, "id">) {
  const mode=requireDigitalEnvironment();
  return prisma.$transaction(async tx => {
    await assertDigitalDatabaseUtc(tx);
    await admin(tx, actor);
    const rows = await tx.consumerWithdrawalRequest.findMany({ where: { contractType: "DIGITAL_ORDER",...modeScope(mode) }, orderBy: [{ receivedAt: "desc" }, { id: "desc" }], take: 50,
      select: { id: true, requestNumber: true, requestKind: true, claimedOrderReference: true, digitalOrderId: true, identityMatch: true,
        claimantFirstName: true, claimantLastName: true, claimantEmail: true, productDescription: true, quantity: true, reason: true,
        receivedAt: true, status: true, eligibilityReview: true, reviewReason: true, reviewedAt: true, reviewedByUserId: true, updatedAt: true,
        acknowledgementStatus: true, acknowledgementHashSha256: true,acknowledgementSnapshot:true, digitalAcknowledgements: { select: { status: true, attempts: true, capturedAt: true, sentAt: true } },
        digitalOrder: { select: digitalEvidence } } });
    const requests=rows.filter(row=>matchesMode(row,mode));
    const history = requests.length ? await tx.digitalEvent.findMany({ where: { kind: "CONSUMER_REQUEST_REVIEWED", OR: requests.map(r => ({ details: { path: ["input", "requestId"], equals: r.id } })) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 100, select: { id: true, actorId: true, createdAt: true, details: true } }) : [];
    return requests.map(r => ({ ...r, digitalOrder: undefined,acknowledgementSnapshot:undefined, evidence: r.digitalOrder ? assessDigitalWithdrawalEvidence(r.digitalOrder) : null,
      history: history.filter(e => (e.details as { input?: { requestId?: string } }).input?.requestId === r.id).map(e => ({ id: e.id, actorId: e.actorId, createdAt: e.createdAt,
        decision: String((e.details as { input?: { decision?: unknown } }).input?.decision ?? "État à vérifier") })) }));
  });
}

export function parseDigitalConsumerReview(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DigitalError("INVALID_BODY");
  const v = value as Record<string, unknown>, keys = ["requestId", "idempotencyKey", "expectedUpdatedAt", "decision", "basis", "reason"];
  if (Object.keys(v).length !== keys.length || Object.keys(v).some(k => !keys.includes(k))) throw new DigitalError("INVALID_BODY");
  assertDigitalUuid(v.requestId); assertDigitalUuid(v.idempotencyKey);
  if (typeof v.expectedUpdatedAt !== "string" || Number.isNaN(Date.parse(v.expectedUpdatedAt)) || new Date(v.expectedUpdatedAt).toISOString() !== v.expectedUpdatedAt
    || !["UNDER_REVIEW", "ACCEPTED", "REJECTED"].includes(String(v.decision)) || !["HUMAN_REVIEW", "DIGITAL_EXCEPTION"].includes(String(v.basis))
    || typeof v.reason !== "string" || v.reason.trim().length < 20 || v.reason.length > 2000 || /[\u0000-\u001f\u007f]/.test(v.reason)) throw new DigitalError("INVALID_BODY");
  return { requestId: v.requestId, idempotencyKey: v.idempotencyKey, expectedUpdatedAt: v.expectedUpdatedAt,
    decision: v.decision as "UNDER_REVIEW" | "ACCEPTED" | "REJECTED", basis: v.basis as "HUMAN_REVIEW" | "DIGITAL_EXCEPTION", reason: v.reason.trim() };
}

/** Administrative decision only. This function intentionally imports NO financial operation. */
export async function reviewDigitalConsumerRequest(actor: OrderActor, body: unknown, now = new Date()) {
  const mode=requireDigitalEnvironment(); const input = parseDigitalConsumerReview(body);
  return prisma.$transaction(async tx => {
    await assertDigitalDatabaseUtc(tx);
    await admin(tx, actor);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`consumer-review:${input.requestId}`})) IS NULL AS locked`;
    const key = mode==="LIVE"?`consumer-review:LIVE:${input.idempotencyKey}`:`consumer-review:${input.idempotencyKey}`, previous = await tx.digitalEvent.findUnique({ where: { externalKey: key } });
    const details = { ...input };
    if (previous) {
      const p = previous.details as { input?: unknown };
      if (billingSnapshotHash(p.input) !== billingSnapshotHash(details) || previous.actorId !== actor.id) throw new DigitalError("IDEMPOTENCY_CONFLICT", 409);
      return { duplicate: true };
    }
    const request = await tx.consumerWithdrawalRequest.findFirst({ where: { id: input.requestId, contractType: "DIGITAL_ORDER",...modeScope(mode) }, include: { digitalOrder: { select: digitalEvidence } } });
    if (!request||!matchesMode(request,mode)) throw new DigitalError("NOT_FOUND", 404);
    if (["ACCEPTED", "REJECTED", "CANCELLED"].includes(request.status) || request.updatedAt.toISOString() !== input.expectedUpdatedAt) throw new DigitalError("REQUEST_CHANGED", 409);
    if (input.decision !== "UNDER_REVIEW" && (!request.digitalOrderId || request.identityMatch !== "MATCHED")) throw new DigitalError("IDENTITY_REVIEW_REQUIRED", 409);
    const assessment = request.digitalOrder ? assessDigitalWithdrawalEvidence(request.digitalOrder) : null;
    if (input.basis === "DIGITAL_EXCEPTION" && (input.decision !== "REJECTED" || request.requestKind !== "WITHDRAWAL" || !assessment?.exceptionCandidate)) throw new DigitalError("WITHDRAWAL_EXCEPTION_UNPROVEN", 409);
    const final = input.decision !== "UNDER_REVIEW";
    const reviewedAt = new Date(Math.max(now.getTime(), request.updatedAt.getTime() + 1));
    const changed = await tx.consumerWithdrawalRequest.updateMany({ where: { id: request.id, updatedAt: request.updatedAt, status: request.status }, data: {
      status: input.decision, eligibilityReview: final ? input.decision === "ACCEPTED" ? "ELIGIBLE" : "INELIGIBLE" : "PENDING_REVIEW",
      reviewedAt: final ? reviewedAt : null, reviewedByUserId: actor.id, reviewReason: input.reason, updatedAt: reviewedAt,
      // refundStatus stays NOT_EVALUATED: an accepted request is not a refund instruction.
    } });
    if (!changed.count) throw new DigitalError("REQUEST_CHANGED", 409);
    await tx.digitalEvent.create({ data: { orderId: request.digitalOrderId, actorId: actor.id, externalKey: key, kind: "CONSUMER_REQUEST_REVIEWED",
      createdAt: reviewedAt, details: { input: details, requestNumber: request.requestNumber, requestKind: request.requestKind, previousStatus: request.status, assessment,...(mode==="LIVE"?{mode}:{}), financialMutation: false } as Prisma.InputJsonObject } });
    return { duplicate: false };
  });
}
