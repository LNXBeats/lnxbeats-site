import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { OrderActor } from "@/lib/orders/domain";
import { prisma } from "@/lib/prisma";
import { DigitalError, assertDigitalUuid, normalizeDigitalCart, requireDigitalEnvironment } from "./domain";
import { ownedTrackIds, selections, selectionFingerprint } from "./catalog";
import { applyDigitalCompletions, consumeDigitalCompletions, reserveDigitalCompletion, verifyDigitalCompletions } from "./completion";
import { reserveDigitalJurisdiction, checkDigitalResidenceRetry, type DigitalCustomerTerritory } from "./checkout-jurisdiction";
import { localDigitalReviewCheckoutAllowed, LOCAL_REVIEW_MERCHANT } from "./local-review-policy";
import { digitalContractSnapshot } from "./fulfillment-policy";
import { DIGITAL_FRANCE_TERMS_VERSION } from "./france-legal";
import { DIGITAL_FRANCE_LIVE_CONTRACT_VERSION } from "./france-live-contract";
import { digitalContractTerms } from "./fulfillment-policy";
import { approvedDigitalFranceContract, digitalLiveContractCustomer } from "./contract-approval-service";
import { digitalNewSalesAllowed } from "./runtime-policy";
import { digitalCompletionJurisdictionAllowed } from "./live-commerce-policy";
import { DIGITAL_RIGHTS_REVIEW_POLICY } from "./rights-review-policy";
import { prepareFreeDigitalCompletionDocuments } from "./documents";
import { assertDigitalLiveNewSale } from "./sales-control";

export type DigitalFreeCompletionInput={idempotencyKey:string;revision:number;termsVersion:string;termsAccepted:boolean;
  earlyDelivery:boolean;withdrawalAcknowledged:boolean;jurisdiction?:DigitalCustomerTerritory;billingAddressSameAsResidence?:boolean};
const result=(o:{id:string;status:string;mode:string})=>({orderId:o.id,status:o.status,totalCents:0,mode:o.mode,checkoutUrl:null,needsReconciliation:o.status==="REQUIRES_REVIEW",freeCompletion:true});

/** Separate from checkout: never resolves a gateway, creates a payment attempt or an invoice.
 * The exact closed local capability remains mandatory; this does not open LIVE or approve tax.
 */
export async function createDigitalFreeCompletion(actor:OrderActor,input:DigitalFreeCompletionInput,options?:{localQaFixture?:true}){
  const mode=requireDigitalEnvironment();
  if(actor.status!=="ACTIVE"||!actor.emailVerified)throw new DigitalError("VERIFIED_ACCOUNT_REQUIRED",403);
  if(mode==="TEST"&&!localDigitalReviewCheckoutAllowed(actor.email,LOCAL_REVIEW_MERCHANT,true))throw new DigitalError("FREE_COMPLETION_LOCAL_ONLY",503);
  if(mode==="LIVE"&&(!digitalNewSalesAllowed(mode)||options?.localQaFixture))throw new DigitalError("NEW_DIGITAL_PAYMENTS_CLOSED",503);
  assertDigitalUuid(input.idempotencyKey);
  if(!Number.isSafeInteger(input.revision)||input.revision<1||input.termsVersion!==(mode==="LIVE"?DIGITAL_FRANCE_LIVE_CONTRACT_VERSION:DIGITAL_FRANCE_TERMS_VERSION)
    ||input.termsAccepted!==true||input.earlyDelivery!==true||input.withdrawalAcknowledged!==true)throw new DigitalError("INVALID_CHECKOUT");
  // Only a server-side, exact local fixture may omit the normal address-bound
  // dossier. Browser bodies cannot acquire this capability or bypass its review.
  if(options?.localQaFixture!==true&&(!input.jurisdiction?.residenceDeclarationId||!input.jurisdiction.addressHash))throw new DigitalError("FRANCE_ADDRESS_DECLARATION_REQUIRED",409);
  return prisma.$transaction(async tx=>{
    await assertDigitalLiveNewSale(tx, mode);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`digital-user:${actor.id}`})) IS NULL AS locked`;
    const owner=await tx.user.findUnique({where:{id:actor.id},select:{status:true,emailVerified:true,email:true,displayName:true}});
    if(owner?.status!=="ACTIVE"||!owner.emailVerified)throw new DigitalError("VERIFIED_ACCOUNT_REQUIRED",403);
    if(mode==="TEST"&&!localDigitalReviewCheckoutAllowed(owner.email,LOCAL_REVIEW_MERCHANT,true))throw new DigitalError("NOT_FOUND",404);
    const previous=await tx.digitalOrder.findUnique({where:{idempotencyKey:input.idempotencyKey},include:{attempts:true}});
    if(previous){
      if(previous.mode!==mode||previous.userId!==actor.id||previous.cartRevision!==input.revision||previous.totalCents!==0||previous.attempts.length
        ||previous.termsVersion!==input.termsVersion||(previous.contractSnapshot as {acquisition?:{kind?:string}})?.acquisition?.kind!=="FREE_ALBUM_COMPLETION")throw new DigitalError("IDEMPOTENCY_CONFLICT",409);
      await checkDigitalResidenceRetry(input.jurisdiction,previous.jurisdictionSnapshot,tx,LOCAL_REVIEW_MERCHANT,actor.id);
      return result(previous);
    }
    if(await tx.digitalOrder.findFirst({where:{userId:actor.id,mode,status:{in:["PENDING","REQUIRES_REVIEW","DISPUTED"]}}}))throw new DigitalError("PAYMENT_ALREADY_ENGAGED",409);
    const cart=await tx.digitalCart.findUnique({where:{userId:actor.id},include:{lines:{where:{removed:false}}}});
    if(!cart||cart.revision!==input.revision||cart.lines.length!==1)throw new DigitalError("STALE_CART",409);
    const ids=cart.lines.map(l=>l.offerId);
    await tx.$queryRaw`SELECT id FROM digital_offers WHERE id=ANY(${ids}::uuid[]) FOR SHARE`;
    const owned=await ownedTrackIds(actor.id,tx),chosen=await applyDigitalCompletions(tx,actor.id,await selections(ids,tx),owned);
    if(chosen.some(o=>{const old=cart.lines.find(l=>l.offerId===o.id);return old?.offerVersion!==o.version||old.priceCents!==o.priceCents;}))throw new DigitalError("PRICE_CHANGED",409);
    if(chosen.some(o=>cart.lines.find(l=>l.offerId===o.id)?.selectionHash!==selectionFingerprint(o)))throw new DigitalError("CATALOGUE_CHANGED",409);
    const normalized=normalizeDigitalCart(chosen,owned),line=normalized.lines[0];
    if(normalized.totalCents!==0||normalized.lines.length!==1||line?.scope!=="ALBUM"||line.completion?.version!==2)throw new DigitalError("FREE_COMPLETION_NOT_ELIGIBLE",409);
    const jurisdiction=await reserveDigitalJurisdiction(input.jurisdiction,tx,mode==="TEST",actor.id,input.termsVersion);
    if(!digitalCompletionJurisdictionAllowed(jurisdiction,mode)||jurisdiction.countryCode!=="FR")throw new DigitalError("COMPLETION_TAX_ALLOCATION_REVIEW_REQUIRED",409);
    const approval=mode==="LIVE"?await approvedDigitalFranceContract(tx):undefined;
    const customer=mode==="LIVE"?await digitalLiveContractCustomer(tx,actor.id,owner.displayName,owner.email,jurisdiction.franceResidenceV2,input.billingAddressSameAsResidence===true)
      :{email:owner.email,name:owner.displayName||"Client QA"};
    const order=await tx.digitalOrder.create({data:{userId:actor.id,idempotencyKey:input.idempotencyKey,cartRevision:cart.revision,
      status:"GRANTED",totalCents:0,mode,termsVersion:input.termsVersion,termsHash:digitalContractTerms(input.termsVersion).hash,
      earlyDelivery:true,withdrawalAcknowledged:true,jurisdictionSnapshot:jurisdiction as unknown as Prisma.InputJsonValue,
      contractSnapshot:{...digitalContractSnapshot(customer,new Date(),input.termsVersion,{mode,approval}),
        rightsReviewPolicy:DIGITAL_RIGHTS_REVIEW_POLICY,acquisition:{kind:"FREE_ALBUM_COMPLETION",version:1}},
      lines:{create:{offerId:line.id,scope:line.scope,title:line.title,priceCents:0,offerVersion:line.version,trackSnapshot:line.tracks,
        completionSnapshot:line.completion,taxSnapshot:mode==="TEST"?{status:"LOCAL_REVIEW_ONLY",treatment:"FREE_COMPLETION_REQUIRES_FISCAL_REVIEW",amountChargedCents:0}
          :{status:"APPROVED_TERRITORY",treatment:jurisdiction.tax.treatment,rateBasisPoints:0,legalNotice:jurisdiction.tax.legalNotice,policyId:jurisdiction.ruleId,policyVersion:jurisdiction.ruleVersion,policyHash:jurisdiction.ruleHash,amountChargedCents:0}}}},include:{lines:true}});
    await reserveDigitalCompletion(tx,actor.id,order.lines[0].id,line.completion);
    await verifyDigitalCompletions(tx,order.id,actor.id);
    for(const track of line.tracks)await tx.digitalEntitlement.create({data:{userId:actor.id,lineId:order.lines[0].id,masterId:track.masterId}});
    await consumeDigitalCompletions(tx,order.id);
    await prepareFreeDigitalCompletionDocuments(tx,order.id);
    await tx.digitalEvent.create({data:{orderId:order.id,actorId:actor.id,externalKey:`free-completion:${order.id}`,kind:"FREE_ALBUM_COMPLETION_GRANTED",
      details:{policy:mode==="TEST"?"LOCAL_QA_FREE_COMPLETION_V1":"LIVE_FREE_COMPLETION_V1",amountChargedCents:0,eligibleCents:line.completion.eligibleCents,
        appliedCreditCents:line.completion.creditCents,surplusCents:line.completion.eligibleCents!-line.completion.creditCents,
        reusableBalanceCents:0,externalProviderCalls:0}}});
    return result(order);
  });
}
