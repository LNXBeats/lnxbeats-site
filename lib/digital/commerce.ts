import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import type { OrderActor } from "@/lib/orders/domain";
import { prisma } from "@/lib/prisma";
import { ownedTrackIds, selections, selectionFingerprint } from "./catalog";
import { DigitalError, DIGITAL_TERMS_VERSION, assertDigitalUuid, assertPaymentEvidence, checkoutProviderUrl, normalizeDigitalCart, requireDigitalEnvironment, type DigitalPaymentEvidence, type DigitalSelection } from "./domain";
import { digitalGateway, type DigitalGateway, type DigitalProviderOrder } from "./providers";
import { digitalContractSnapshot } from "./fulfillment-policy";
import { enqueueDigitalEmail, prepareDigitalDocuments } from "./documents";
import { localDigitalReviewCheckoutAllowed } from "./local-review-policy";
import { assertDigitalPaypalDeclinedRecovery, digitalPaypalDeclinedReference, isDigitalPaypalDeclinedEvidence } from "./paypal-evidence";
import { applyDigitalCompletions, reserveDigitalCompletion, verifyDigitalCompletions, consumeDigitalCompletions, releaseDigitalCompletions,reviewDependentDigitalCompletions } from "./completion";
import { reserveDigitalJurisdiction, checkDigitalAcquiredJurisdiction, digitalLocalTerritoryFixtureAllowed, type DigitalCustomerTerritory } from "./checkout-jurisdiction";
import { calculateDigitalTax } from "./jurisdictions";
import { DIGITAL_MUSIC_TERMS_DRAFT_TEXT } from "./digital-legal";
import { verifyDigitalPinnedMedia } from "./pinned-media";
import {DIGITAL_RIGHTS_REVIEW_POLICY} from "./rights-review-policy";
import {checkDigitalAcquiredRightsReview} from "./rights-review-checkout";

function user(actor: OrderActor) { if (actor.status !== "ACTIVE" || !actor.emailVerified) throw new DigitalError("VERIFIED_ACCOUNT_REQUIRED", 403); }
async function lock(tx: Prisma.TransactionClient, id: string) { await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`digital-user:${id}`})) IS NULL AS locked`; }
function providerOrder(order: { id: string; totalCents: number; user: { email: string }; lines: Array<{ title: string; priceCents: number }> }): DigitalProviderOrder {
  return { id: order.id, totalCents: order.totalCents, userEmail: order.user.email, lines: order.lines.map(l => ({ title: l.title, priceCents: l.priceCents })) };
}
function presentOrder(order: { id: string; status: string; totalCents: number; mode: string }, attempt?: { status: string; checkoutUrl: string | null } | null) {
  return { orderId: order.id, status: order.status, totalCents: order.totalCents, mode: order.mode,
    checkoutUrl: order.status === "PENDING" && attempt?.status === "OPEN" ? attempt.checkoutUrl : null,
    needsReconciliation: order.status === "REQUIRES_REVIEW" || attempt?.status === "UNKNOWN" };
}
export async function createDigitalCheckout(actor: OrderActor, input: { idempotencyKey: string; revision: number; provider: string; termsVersion: string; earlyDelivery: boolean; withdrawalAcknowledged: boolean; jurisdiction?:DigitalCustomerTerritory }, suppliedGateway?: DigitalGateway, options?:{localReview?:true;localQaFixture?:true}) {
  user(actor); requireDigitalEnvironment();
  if (process.env.DCN_NEW_PAYMENTS_ENABLED !== "true" && !localDigitalReviewCheckoutAllowed(actor.email,suppliedGateway?.merchantId??"",options?.localReview===true)) throw new DigitalError("NEW_DIGITAL_PAYMENTS_CLOSED", 503);
  if(!suppliedGateway&&process.env.DCN_EXTERNAL_TEST_AUTHORIZED!=="true")throw new DigitalError("EXTERNAL_QA_AUTHORIZATION_REQUIRED",503);
  assertDigitalUuid(input.idempotencyKey);
  if (!Number.isSafeInteger(input.revision) || input.revision < 1 || !["STRIPE", "PAYPAL"].includes(input.provider)
    || input.termsVersion !== DIGITAL_TERMS_VERSION || input.earlyDelivery !== true || input.withdrawalAcknowledged !== true) throw new DigitalError("INVALID_CHECKOUT");
  // Resolve TEST-only provider configuration before creating a persistent order.
  const gateway = suppliedGateway ?? digitalGateway(input.provider);
  const localQa=!!suppliedGateway&&(options?.localReview===true||options?.localQaFixture===true)&&digitalLocalTerritoryFixtureAllowed(gateway.merchantId);
  if(options?.localQaFixture&&!localQa)throw new DigitalError("LOCAL_QA_POLICY_NOT_AUTHORIZED",403);
  const reserved = await prisma.$transaction(async tx => {
    await lock(tx, actor.id);
    const currentUser = await tx.user.findUnique({ where: { id: actor.id }, select: { status: true, emailVerified: true, email: true, displayName: true } });
    if (currentUser?.status !== "ACTIVE" || !currentUser.emailVerified) throw new DigitalError("VERIFIED_ACCOUNT_REQUIRED", 403);
    if(options?.localReview&&!localDigitalReviewCheckoutAllowed(currentUser.email,suppliedGateway?.merchantId??"",true))throw new DigitalError("NOT_FOUND",404);
    const previous = await tx.digitalOrder.findUnique({ where: { idempotencyKey: input.idempotencyKey }, include: { user: true, lines: true, attempts: { orderBy: { createdAt: "desc" } } } });
    if (previous) {
      if (previous.userId !== actor.id || previous.cartRevision !== input.revision || previous.attempts[0]?.provider !== input.provider) throw new DigitalError("IDEMPOTENCY_CONFLICT", 409);
      return { order: previous, attempt: previous.attempts[0], created: false };
    }
    if (await tx.digitalOrder.findFirst({ where: { userId: actor.id, status: { in: ["PENDING", "REQUIRES_REVIEW", "DISPUTED"] } } })) throw new DigitalError("PAYMENT_ALREADY_ENGAGED", 409);
    const cart = await tx.digitalCart.findUnique({ where: { userId: actor.id }, include: { lines: { where: { removed: false } } } });
    if (!cart || cart.revision !== input.revision || !cart.lines.length) throw new DigitalError("STALE_CART", 409);
    const ids = cart.lines.map(l => l.offerId);
    await tx.$queryRaw`SELECT id FROM digital_offers WHERE id=ANY(${ids}::uuid[]) FOR SHARE`;
    const owned=await ownedTrackIds(actor.id,tx);
    const chosen = await applyDigitalCompletions(tx,actor.id,await selections(ids, tx),owned);
    if (chosen.some(o => { const old = cart.lines.find(l => l.offerId === o.id); return old?.offerVersion !== o.version || old.priceCents !== o.priceCents; })) throw new DigitalError("PRICE_CHANGED", 409);
    if(chosen.some(o=>cart.lines.find(l=>l.offerId===o.id)?.selectionHash!==selectionFingerprint(o)))throw new DigitalError("CATALOGUE_CHANGED",409);
    const normalized = normalizeDigitalCart(chosen, owned);
    if (!normalized.lines.length) throw new DigitalError("EMPTY_CART", 409);
    const jurisdiction=await reserveDigitalJurisdiction(input.jurisdiction,tx,localQa,actor.id);
    if(!jurisdiction.tax.priceIncludesTax)throw new DigitalError("TAX_EXCLUSIVE_CHECKOUT_REVIEW_REQUIRED",409);
    if(normalized.lines.some(l=>l.completion)&&jurisdiction.approvalScope!=="LOCAL_QA")throw new DigitalError("COMPLETION_TAX_ALLOCATION_REVIEW_REQUIRED",409);
    const order = await tx.digitalOrder.create({ data: { userId: actor.id, idempotencyKey: input.idempotencyKey, cartRevision: cart.revision,
      totalCents: normalized.totalCents, mode: "TEST", termsVersion: DIGITAL_TERMS_VERSION, termsHash: createHash("sha256").update(DIGITAL_MUSIC_TERMS_DRAFT_TEXT).digest("hex"),
      jurisdictionSnapshot:jurisdiction as unknown as Prisma.InputJsonValue,
      earlyDelivery: true, withdrawalAcknowledged: true, lines: { create: normalized.lines.map(l => ({ offerId: l.id, scope: l.scope, title: l.title, priceCents: l.priceCents,
        offerVersion: l.version, trackSnapshot: l.tracks, ...(l.completion?{completionSnapshot:l.completion}:{}),
        taxSnapshot: {status:jurisdiction.approvalScope==="LOCAL_QA"?"LOCAL_REVIEW_ONLY":"APPROVED_TERRITORY",...calculateDigitalTax({grossBeforeCreditCents:l.completion?.basePriceCents??l.priceCents,creditCents:l.completion?.creditCents??0},jurisdiction)} })) },
      contractSnapshot: {...digitalContractSnapshot({ email: currentUser.email, name: currentUser.displayName || "Client QA" }, new Date()),rightsReviewPolicy:DIGITAL_RIGHTS_REVIEW_POLICY},
    }, include: { user: true, lines: true } });
    for(const l of normalized.lines)if(l.completion)await reserveDigitalCompletion(tx,actor.id,order.lines.find(line=>line.offerId===l.id)!.id,l.completion);
    const attempt = await tx.digitalPaymentAttempt.create({ data: { orderId: order.id, provider: input.provider, idempotencyKey: `dcn:${order.id}:${randomUUID()}`, leaseUntil: new Date(Date.now() + 60000) } });
    await tx.digitalEvent.create({ data: { orderId: order.id, actorId: actor.id, kind: "CHECKOUT_RESERVED", details: { attemptId: attempt.id, mode: "TEST", termsVersion: order.termsVersion, termsHash: order.termsHash } } });
    return { order, attempt, created: true };
  });
  if (!reserved.created) return presentOrder(reserved.order, reserved.attempt);
  try {
    const checkout = await gateway.create(providerOrder(reserved.order), reserved.attempt);
    checkoutProviderUrl(checkout.url, input.provider);
    const changed = await prisma.digitalPaymentAttempt.updateMany({ where: { id: reserved.attempt.id, status: "CREATING" }, data: {
      providerReference: checkout.id, checkoutUrl: checkout.url, status: "OPEN", leaseUntil: null } });
    if (!changed.count) return getDigitalOrderStatus(actor.id, reserved.order.id);
  } catch {
    // A timeout is not a failed payment. Never recreate or capture blindly.
    await prisma.$transaction(async tx => { await lock(tx, actor.id);
      const changed = await tx.digitalPaymentAttempt.updateMany({ where: { id: reserved.attempt.id, status: "CREATING" }, data: { status: "UNKNOWN", leaseUntil: null } });
      if (changed.count) { await tx.digitalOrder.update({ where: { id: reserved.order.id }, data: { status: "REQUIRES_REVIEW" } });
        await tx.digitalEvent.create({ data: { orderId: reserved.order.id, kind: "PROVIDER_RESULT_UNKNOWN", details: { attemptId: reserved.attempt.id } } }); }
    });
  }
  return getDigitalOrderStatus(actor.id, reserved.order.id);
}
export async function getDigitalOrderStatus(userId: string, id: string) {
  requireDigitalEnvironment(); assertDigitalUuid(id);
  const order = await prisma.digitalOrder.findFirst({ where: { id, userId }, include: { attempts: { orderBy: { createdAt: "desc" }, take: 1 } } });
  if (!order) throw new DigitalError("NOT_FOUND", 404);
  return presentOrder(order, order.attempts[0]);
}
export async function reconcileDigitalEvidence(e: DigitalPaymentEvidence, merchantId: string) {
  requireDigitalEnvironment(); assertDigitalUuid(e.orderId);
  const head = await prisma.digitalOrder.findUnique({ where: { id: e.orderId }, select: { userId: true } });
  if (!head) throw new DigitalError("NOT_FOUND", 404);
  return prisma.$transaction(async tx => {
    await lock(tx, head.userId);
    const key = `${e.provider}:TEST:${e.eventId}`;
    const duplicate = await tx.digitalEvent.findUnique({ where: { externalKey: key } });
    if (duplicate) {
      const d = duplicate.details as Record<string, unknown>;
      if (duplicate.orderId !== e.orderId || d.amountCents !== e.amountCents || d.paymentReference !== e.paymentReference || d.providerReference !== e.providerReference || d.status !== e.status
        || d.currency!==undefined&&d.currency!==e.currency || d.merchantId!==undefined&&d.merchantId!==e.merchantId) throw new DigitalError("EVENT_COLLISION", 409);
      return { duplicate: true };
    }
    const order = await tx.digitalOrder.findUniqueOrThrow({ where: { id: e.orderId }, include: { lines: true, attempts: true } });
    const attempt = order.attempts.find(a => a.provider === e.provider && a.providerReference === e.providerReference);
    if (!attempt) {
      if (e.authenticated && e.mode === "TEST" && e.status === "PAID" && e.merchantId === merchantId) {
        await tx.digitalEvent.create({ data: { orderId: order.id, externalKey: key, kind: "UNMATCHED_CAPTURE_INCIDENT", details: { ...e } } });
        await tx.digitalOrder.update({ where: { id: order.id }, data: { status: "REQUIRES_REVIEW" } });
        await enqueueDigitalEmail(tx, order.id, "INCIDENT", `incident:${key}`);
        return { review: true };
      }
      throw new DigitalError("UNKNOWN_PAYMENT", 409);
    }
    try {
      assertPaymentEvidence(e, order, attempt, merchantId);
      if(e.status==="PAID"&&order.attempts.some(a=>a.id!==attempt.id&&a.status==="PAID"))throw new DigitalError("SECOND_CAPTURE_REQUIRES_REVIEW",409);
      if (attempt.paymentReference && attempt.paymentReference !== e.paymentReference) throw new DigitalError("PAYMENT_REQUIRES_REVIEW", 409);
    } catch {
      await tx.digitalOrder.update({ where: { id: order.id }, data: { status: "REQUIRES_REVIEW" } });
        await tx.digitalEvent.create({ data: { orderId: order.id, externalKey:key, kind: "PAYMENT_CONTRADICTION", details: { provider:e.provider,eventId:e.eventId,amountCents:e.amountCents,paymentReference:e.paymentReference,providerReference:e.providerReference,status:e.status,currency:e.currency,merchantId:e.merchantId } } });
      await enqueueDigitalEmail(tx, order.id, "INCIDENT", `incident:${key}`);
      // Return a review state so the durable contradiction is not rolled back.
      return { review: true };
    }
    const details = { amountCents: e.amountCents, paymentReference: e.paymentReference, providerReference: e.providerReference, status: e.status,currency:e.currency,merchantId:e.merchantId };
    await tx.digitalEvent.create({ data: { orderId: order.id, externalKey: key, kind: "PROVIDER_EVIDENCE", details } });
    if (e.status !== "PAID") {
      if (isDigitalPaypalDeclinedEvidence(e)) {
        const recoverable = order.status === "PENDING" || order.status === "REQUIRES_REVIEW" && ["UNKNOWN", "CAPTURING"].includes(attempt.status);
        const contradiction = await tx.digitalEvent.findFirst({ where: { orderId: order.id,
          kind: { in: ["PAYMENT_CONTRADICTION", "UNMATCHED_CAPTURE_INCIDENT", "OVERLAPPING_ACQUISITION_INCIDENT"] } } });
        if (recoverable && !contradiction && !order.attempts.some(a => a.status === "PAID")) {
          await tx.digitalPaymentAttempt.update({ where: { id: attempt.id }, data: { status: "FAILED", paymentReference: e.paymentReference, leaseUntil: null } });
          await tx.digitalOrder.update({ where: { id: order.id }, data: { status: "FAILED" } });
          if(order.lines.some(l=>l.completionSnapshot))await releaseDigitalCompletions(tx,order.id);
          return { failed: true };
        }
        return { ignored: true }; // Never downgrade an actual capture or a financial contradiction.
      }
      if (order.status === "PENDING") await tx.digitalPaymentAttempt.update({ where: { id: attempt.id }, data: { status: e.status === "FAILED" ? "FAILED" : "PENDING" } });
      if (e.status === "FAILED" && order.status === "PENDING") {await tx.digitalOrder.update({ where: { id: order.id }, data: { status: "FAILED" } });
        if(order.lines.some(l=>l.completionSnapshot))await releaseDigitalCompletions(tx,order.id);}
      return { pending: true };
    }
    if (["REFUNDED", "PARTIALLY_REFUNDED", "DISPUTED", "REQUIRES_REVIEW"].includes(order.status) && attempt.status === "PAID") return { ignored: true };
    if(order.status==="PAID"&&attempt.status==="PAID")return{paid:true,duplicatePayment:true};
    // A revoked/failed order is never resurrected by late paid events.
    if (!["PENDING", "REQUIRES_REVIEW", "PAID"].includes(order.status)) {
      await tx.digitalOrder.update({ where: { id: order.id }, data: { status: "REQUIRES_REVIEW" } });
      await tx.digitalEvent.create({ data: { orderId: order.id, kind: "PAYMENT_CONTRADICTION", details: { reason: "PAID_AFTER_TERMINAL_STATE", eventId: e.eventId } } });
      return { review: true };
    }
    if (order.status === "REQUIRES_REVIEW" && await tx.digitalEvent.findFirst({ where: { orderId: order.id, kind: "PAYMENT_CONTRADICTION" } })) return { review: true };
    if (await tx.digitalEvent.findFirst({ where: { orderId: order.id, kind: "UNMATCHED_CAPTURE_INCIDENT" } })) return { review: true };
    const activeOwner=await tx.user.findFirst({where:{id:order.userId,status:"ACTIVE",emailVerified:true},select:{id:true}});
    if(!activeOwner){
      await tx.digitalPaymentAttempt.update({where:{id:attempt.id},data:{status:"PAID",paymentReference:e.paymentReference,leaseUntil:null}});
      await tx.digitalOrder.update({where:{id:order.id},data:{status:"REQUIRES_REVIEW"}});
      await tx.digitalEvent.create({data:{orderId:order.id,kind:"ACCOUNT_FULFILLMENT_REQUIRES_REVIEW",details:{reason:"VERIFIED_ACCOUNT_REQUIRED"}}});return{review:true};
    }
    try {await checkDigitalAcquiredJurisdiction(order.jurisdictionSnapshot,tx,merchantId,order.userId);
      await checkDigitalAcquiredRightsReview(order.contractSnapshot,order.lines,tx);
      await verifyDigitalPinnedMedia(tx,order.lines);
    }catch(error){
      await tx.digitalPaymentAttempt.update({where:{id:attempt.id},data:{status:"PAID",paymentReference:e.paymentReference,leaseUntil:null}});
      await tx.digitalOrder.update({where:{id:order.id},data:{status:"REQUIRES_REVIEW"}});
      await tx.digitalEvent.create({data:{orderId:order.id,kind:"TERRITORY_FULFILLMENT_REQUIRES_REVIEW",details:{reason:error instanceof DigitalError?error.code:"TERRITORY_REVIEW_REQUIRED"}}});
      return {review:true};
    }
    const completionLines=order.lines.filter(l=>l.completionSnapshot);
    if(completionLines.length){try{await verifyDigitalCompletions(tx,order.id,order.userId);}catch(error){
      await tx.digitalPaymentAttempt.update({where:{id:attempt.id},data:{status:"PAID",paymentReference:e.paymentReference,leaseUntil:null}});
      await tx.digitalOrder.update({where:{id:order.id},data:{status:"REQUIRES_REVIEW"}});
      await tx.digitalEvent.create({data:{orderId:order.id,kind:"COMPLETION_SOURCE_FINANCIAL_INCIDENT",details:{reason:error instanceof DigitalError?error.code:"COMPLETION_SOURCE_CHANGED"}}});
      await enqueueDigitalEmail(tx,order.id,"INCIDENT",`completion-incident:${order.id}`);return{review:true};}}
    // A second actual acquisition is a financial incident, never just a duplicate webhook.
    const trackIds = order.lines.flatMap(l => (l.trackSnapshot as unknown as DigitalSelection["tracks"]).map(t => t.trackId));
    const existingRights=completionLines.length?await tx.digitalEntitlement.findMany({where:{userId:order.userId,status:"ACTIVE",line:{orderId:{not:order.id}},master:{trackId:{in:trackIds}}},select:{lineId:true,masterId:true,master:{select:{trackId:true}}}}):null;
    const admittedSources=completionLines.flatMap(l=>(l.completionSnapshot as unknown as NonNullable<DigitalSelection["completion"]>).sources);
    const overlapping=existingRights?existingRights.some(r=>!admittedSources.some(s=>s.sourceLineId===r.lineId&&s.masterId===r.masterId&&s.trackId===r.master.trackId)):
      !!await tx.digitalEntitlement.findFirst({where:{userId:order.userId,status:"ACTIVE",line:{orderId:{not:order.id}},master:{trackId:{in:trackIds}}}});
    if (overlapping) {
      await tx.digitalPaymentAttempt.update({ where: { id: attempt.id }, data: { status: "PAID", paymentReference: e.paymentReference, leaseUntil: null } });
      await tx.digitalOrder.update({ where: { id: order.id }, data: { status: "REQUIRES_REVIEW" } });
      await tx.digitalEvent.create({ data: { orderId: order.id, kind: "OVERLAPPING_ACQUISITION_INCIDENT", details: { paymentReference: e.paymentReference, trackIds } } });
      await enqueueDigitalEmail(tx, order.id, "INCIDENT", `overlap:${order.id}`);
      return { review: true };
    }
    await tx.digitalPaymentAttempt.update({ where: { id: attempt.id }, data: { status: "PAID", paymentReference: e.paymentReference, leaseUntil: null } });
    for (const line of order.lines) {
      const tracks = line.trackSnapshot as unknown as DigitalSelection["tracks"];
      for (const t of tracks) await tx.digitalEntitlement.upsert({ where: { lineId_masterId: { lineId: line.id, masterId: t.masterId } },
        create: { userId: order.userId, lineId: line.id, masterId: t.masterId }, update: {} });
    }
    await tx.digitalOrder.update({ where: { id: order.id }, data: { status: "PAID" } });
    if(completionLines.length)await consumeDigitalCompletions(tx,order.id);
    await prepareDigitalDocuments(tx, order.id);
    return { paid: true };
  });
}
export async function reconcileDigitalOrder(id: string, suppliedGateway?: DigitalGateway, declinedCapture?: string) {
  requireDigitalEnvironment(); assertDigitalUuid(id);
  const order = await prisma.digitalOrder.findUniqueOrThrow({ where: { id }, include: { lines: true, user: true, attempts: { orderBy: { createdAt: "desc" }, take: 1 } } });
  const attempt = order.attempts[0];
  if (declinedCapture !== undefined) {
    digitalPaypalDeclinedReference(declinedCapture);
    if (!attempt || attempt.provider !== "PAYPAL" || attempt.paymentReference && attempt.paymentReference !== declinedCapture) throw new DigitalError("PAYMENT_REQUIRES_REVIEW", 409);
  }
  if (!attempt || ["PAID", "FAILED"].includes(attempt.status)) return;
  if (attempt.leaseUntil && attempt.leaseUntil.getTime() > Date.now()) return;
  const gateway = suppliedGateway ?? digitalGateway(attempt.provider);
  const recovered = await gateway.recover(providerOrder(order), attempt);
  if (declinedCapture !== undefined) assertDigitalPaypalDeclinedRecovery(declinedCapture, recovered?.evidence);
  if (!recovered) return;
  if (recovered.checkout && attempt.operation === "CHECKOUT") await prisma.digitalPaymentAttempt.updateMany({ where: { id: attempt.id, status: { in: ["UNKNOWN", "CREATING", "OPEN"] } }, data: {
    providerReference: recovered.checkout.id, checkoutUrl: checkoutProviderUrl(recovered.checkout.url, attempt.provider), status: "OPEN", leaseUntil: null } });
  if (recovered.evidence) await reconcileDigitalEvidence(recovered.evidence, gateway.merchantId);
  else if (recovered.checkout && attempt.operation === "CHECKOUT" && order.status === "REQUIRES_REVIEW" && attempt.status === "UNKNOWN") await prisma.digitalOrder.updateMany({ where: { id, status: "REQUIRES_REVIEW" }, data: { status: "PENDING" } });
}
export async function captureDigitalPaypal(userId: string, id: string, suppliedGateway?: DigitalGateway) {
  requireDigitalEnvironment(); assertDigitalUuid(id);
  await getDigitalOrderStatus(userId, id);
  const order = await prisma.digitalOrder.findUniqueOrThrow({ where: { id }, include: { user: true, lines: true, attempts: { orderBy: { createdAt: "desc" }, take: 1 } } });
  const attempt = order.attempts[0]; if (!attempt || attempt.provider !== "PAYPAL") throw new DigitalError("INVALID_PROVIDER");
  const gateway = suppliedGateway ?? digitalGateway("PAYPAL");
  if (attempt.status !== "OPEN") { await reconcileDigitalOrder(id, gateway); return getDigitalOrderStatus(userId, id); }
  const claimed = await prisma.$transaction(async tx => { await lock(tx, userId);
    if(!await tx.user.findFirst({where:{id:userId,status:"ACTIVE",emailVerified:true},select:{id:true}}))throw new DigitalError("VERIFIED_ACCOUNT_REQUIRED",403);
    await checkDigitalAcquiredJurisdiction(order.jurisdictionSnapshot,tx,gateway.merchantId,userId);
    await checkDigitalAcquiredRightsReview(order.contractSnapshot,order.lines,tx);
    await verifyDigitalPinnedMedia(tx,order.lines);
    if(order.lines.some(l=>l.completionSnapshot))await verifyDigitalCompletions(tx,id,userId);
    return tx.digitalPaymentAttempt.updateMany({ where: { id: attempt.id, status: "OPEN", operation: "CHECKOUT" }, data: { status: "CAPTURING", operation: "CAPTURE", leaseUntil: new Date(Date.now() + 60000) } }); });
  if (!claimed.count) return getDigitalOrderStatus(userId, id);
  try { await reconcileDigitalEvidence(await gateway.capture!(providerOrder(order), attempt), gateway.merchantId); }
  catch { await prisma.$transaction(async tx => { await lock(tx, userId);
    const c = await tx.digitalPaymentAttempt.updateMany({ where: { id: attempt.id, status: "CAPTURING" }, data: { status: "UNKNOWN", leaseUntil: null } });
    if (c.count) await tx.digitalOrder.update({ where: { id }, data: { status: "REQUIRES_REVIEW" } }); }); }
  return getDigitalOrderStatus(userId, id);
}
/** READ evidence from provider first. This function cannot initiate a financial movement. */
export async function recordDigitalAdjustment(actor: OrderActor, id: string, value: { reference: string; kind: "REFUND" | "DISPUTE"; lineIds: string[]; amountCents: number; provider: string; paymentReference: string; authenticated: boolean }) {
  requireDigitalEnvironment(); user(actor); assertDigitalUuid(id); if (actor.role !== "ADMIN") throw new DigitalError("ADMIN_REQUIRED", 403);
  if (!value.authenticated || !value.reference || !Number.isSafeInteger(value.amountCents) || value.amountCents < 1) throw new DigitalError("INVALID_ADJUSTMENT");
  const head = await prisma.digitalOrder.findUniqueOrThrow({ where: { id }, select: { userId: true } });
  return prisma.$transaction(async tx => { await lock(tx, head.userId);
    const key = `adjustment:${value.provider}:TEST:${value.reference}`;
    const duplicate = await tx.digitalEvent.findUnique({ where: { externalKey: key } });
    if (duplicate) {
      const details = duplicate.details as Record<string, unknown>;
      if (duplicate.orderId !== id || duplicate.kind !== value.kind || details.amountCents !== value.amountCents
        || details.paymentReference !== value.paymentReference || JSON.stringify(details.lineIds) !== JSON.stringify(value.lineIds)) throw new DigitalError("EVENT_COLLISION", 409);
      return;
    }
    const order = await tx.digitalOrder.findUniqueOrThrow({ where: { id }, include: { lines: true, attempts: { where: { status: "PAID" } } } });
    if (order.attempts.length !== 1 || order.attempts[0].paymentReference !== value.paymentReference || order.attempts[0].provider !== value.provider
      || !["PAID", "PARTIALLY_REFUNDED", "DISPUTED"].includes(order.status)) throw new DigitalError("INVALID_ADJUSTMENT", 409);
    const lines = order.lines.filter(l => value.lineIds.includes(l.id));
    if (!lines.length || new Set(value.lineIds).size !== lines.length || lines.reduce((s,l) => s+l.priceCents,0) !== value.amountCents) throw new DigitalError("PARTIAL_LINE_REQUIRES_REVIEW", 409);
    const existing = await tx.digitalEntitlement.findMany({ where: { lineId: { in: lines.map(l => l.id) } }, select: { status: true } });
    if (value.kind === "REFUND" && existing.some(e => e.status === "REVOKED")) throw new DigitalError("ALREADY_REFUNDED", 409);
    await tx.digitalEntitlement.updateMany({ where: { lineId: { in: lines.map(l => l.id) } }, data: { status: value.kind === "DISPUTE" ? "SUSPENDED" : "REVOKED" } });
    const remaining = await tx.digitalEntitlement.count({ where: { line: { orderId: id }, status: "ACTIVE" } });
    await tx.digitalOrder.update({ where: { id }, data: { status: value.kind === "DISPUTE" ? "DISPUTED" : remaining ? "PARTIALLY_REFUNDED" : "REFUNDED" } });
    await tx.digitalEvent.create({ data: { orderId: id, actorId: actor.id, kind: value.kind, externalKey: key, details: { lineIds: value.lineIds, amountCents: value.amountCents, reference: value.reference, paymentReference: value.paymentReference, provider: value.provider } } });
    await reviewDependentDigitalCompletions(tx,id,`adjustment:${value.reference}`);
  });
}
