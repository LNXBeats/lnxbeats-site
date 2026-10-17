import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { DigitalError } from "./domain";
import { DIGITAL_FRANCE_LIVE_CONTRACT_VERSION, snapshotDigitalFranceLiveContractApproval,
  type DigitalFranceLiveContractApproval } from "./france-live-contract";
import { normalizeDigitalFranceResidenceAddress, digitalFranceResidenceHash,
  DIGITAL_FRANCE_RESIDENCE_DECLARATION_EVENT, type DigitalFranceResidenceSnapshotV2 } from "./france-residence-v2-policy";
import { resolveDigitalContractBillingAddress } from "./billing-address-policy";
import type { DigitalFranceMinimalAddress } from "./france-residence-v2-policy";

/** Server provenance for new commitments, never an approval submitted by the buyer.
 * This function only reads: recording a seller decision requires a separate explicit action.
 */
export async function approvedDigitalFranceContract(db: Pick<Prisma.TransactionClient, "digitalEvent" | "user">, now = new Date()) {
  const row = await db.digitalEvent.findFirst({ where: { kind: "DIGITAL_FRANCE_LIVE_CONTRACT_APPROVAL",
    details: { path: ["version"], equals: DIGITAL_FRANCE_LIVE_CONTRACT_VERSION } }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
  const record = row?.details as DigitalFranceLiveContractApproval | undefined;
  if (!row?.actorId || !record || record.id !== row.id || record.approvedBy !== row.actorId
    || record.createdAt !== row.createdAt.toISOString()) throw new DigitalError("FR_LIVE_CONTRACT_APPROVAL_REQUIRED", 409);
  const actor = await db.user.findUnique({ where: { id: row.actorId }, select: { id: true, role: true, status: true, emailVerified: true } });
  try { return snapshotDigitalFranceLiveContractApproval(record, actor, now); }
  catch { throw new DigitalError("FR_LIVE_CONTRACT_APPROVAL_REQUIRED", 409); }
}

/** Pin only the address already declared and reviewed by this buyer. No identity
 * document, PSP lookup, unrelated purchase or historical address is collected.
 */
export async function digitalLiveContractCustomer(db: Pick<Prisma.TransactionClient,"digitalEvent">,
  userId:string,name:string|null,email:string,residence?:DigitalFranceResidenceSnapshotV2,billingAddressSameAsResidence=false,suppliedBillingAddress?:DigitalFranceMinimalAddress){
  if(!name?.trim()||name.trim().length<2)throw new DigitalError("CUSTOMER_NAME_REQUIRED",409);
  if(!residence||residence.subjectUserId!==userId)throw new DigitalError("FRANCE_ADDRESS_DECLARATION_REQUIRED",409);
  const row=await db.digitalEvent.findFirst({where:{id:residence.residenceDeclarationId,actorId:userId,kind:DIGITAL_FRANCE_RESIDENCE_DECLARATION_EVENT},select:{details:true}});
  const details=row?.details as {address?:unknown;addressHash?:string}|undefined;
  try{
    const billingAddress=normalizeDigitalFranceResidenceAddress(details?.address);
    if(details?.addressHash!==residence.addressHash||digitalFranceResidenceHash(billingAddress)!==residence.addressHash)throw new Error("ADDRESS_CHANGED");
    return{type:"INDIVIDUAL",email,name:name.trim(),...resolveDigitalContractBillingAddress(billingAddress,residence,billingAddressSameAsResidence,suppliedBillingAddress)};
  }catch(e){if(e instanceof DigitalError)throw e;throw new DigitalError("FRANCE_RESIDENCE_PROOF_CHANGED_REQUIRES_REVIEW",409);}
}
