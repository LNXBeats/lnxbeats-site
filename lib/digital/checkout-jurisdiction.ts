import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { DigitalError, DIGITAL_TERMS_VERSION, requireDigitalEnvironment } from "./domain";
import { localDigitalReviewAvailable, LOCAL_REVIEW_MERCHANT } from "./local-review-policy";
import { localQaDigitalCountryRule, type DigitalJurisdictionInput, type DigitalJurisdictionSnapshot } from "./jurisdictions";
import { assertDigitalCheckoutJurisdiction, revalidateDigitalCheckoutJurisdiction } from "./jurisdictions-service";
import {DIGITAL_FRANCE_LAUNCH_POLICY,parseDigitalFranceDeclaration,revalidateDigitalFranceResidenceSnapshot,type DigitalFranceResidenceSnapshot} from "./france-launch-policy";
import {assessDigitalFranceResidence} from "./france-residence-service";
import {assertDigitalFranceResidenceV2Prepared,type DigitalFranceResidenceSnapshotV2} from "./france-residence-v2-policy";
import {assessDigitalFranceResidenceV2,revalidateDigitalFranceResidenceV2} from "./france-residence-v2-service";
import {billingSnapshotHash} from "@/lib/billing/domain";
import {digitalUuid} from "./domain";

export type DigitalCustomerTerritory = { countryCode:string; subdivisionCode?:string; residenceCountryCode:string; billingCountryCode:string; customerType:string;
  residencePostalCode?:string;billingPostalCode?:string;residenceConfirmed?:boolean;residenceDeclarationId?:string;addressHash?:string };
export function parseDigitalCustomerTerritory(value:unknown):DigitalCustomerTerritory {
  if(!value||typeof value!=="object"||Array.isArray(value))throw new DigitalError("COUNTRY_EVIDENCE_REQUIRED",409);
  const v=value as Record<string,unknown>;
  if(Object.keys(v).some(k=>!["countryCode","subdivisionCode","residenceCountryCode","billingCountryCode","customerType","residencePostalCode","billingPostalCode","residenceConfirmed","residenceDeclarationId","addressHash"].includes(k))
    ||["countryCode","residenceCountryCode","billingCountryCode"].some(k=>typeof v[k]!=="string"||!/^[A-Z]{2}$/.test(v[k] as string))
    ||v.customerType!=="B2C"||v.subdivisionCode!==undefined&&(typeof v.subdivisionCode!=="string"||v.subdivisionCode.length>10)
    ||["residencePostalCode","billingPostalCode"].some(k=>v[k]!==undefined&&(typeof v[k]!=="string"||!/^\d{5}$/.test(v[k] as string)))
    ||v.residenceConfirmed!==undefined&&typeof v.residenceConfirmed!=="boolean"
    ||v.residenceDeclarationId!==undefined&&!digitalUuid(v.residenceDeclarationId)
    ||v.addressHash!==undefined&&(typeof v.addressHash!=="string"||!/^[a-f0-9]{64}$/.test(v.addressHash)))throw new DigitalError("INVALID_TERRITORY_INPUT",400);
  return v as DigitalCustomerTerritory;
}
/** Server-only capability for provider doubles in the exact isolated local profile. */
export function digitalLocalTerritoryFixtureAllowed(merchant:string) {
  return (merchant===LOCAL_REVIEW_MERCHANT||merchant.startsWith("dcn-consolidation-"))
    && localDigitalReviewAvailable({...process.env,DCN_NEW_PAYMENTS_ENABLED:"false"});
}
function input(territory:DigitalCustomerTerritory|undefined,qa:boolean,termsVersion=DIGITAL_TERMS_VERSION):DigitalJurisdictionInput {
  if(!territory||typeof territory.countryCode!=="string"||typeof territory.residenceCountryCode!=="string"||typeof territory.billingCountryCode!=="string"
    ||territory.customerType!=="B2C"||territory.subdivisionCode!==undefined&&typeof territory.subdivisionCode!=="string")throw new DigitalError("COUNTRY_EVIDENCE_REQUIRED",409);
  if(qa&&!digitalLocalTerritoryFixtureAllowed(LOCAL_REVIEW_MERCHANT))throw new DigitalError("LOCAL_QA_POLICY_NOT_AUTHORIZED",403);
  const providerCountryCode=(territory as DigitalCustomerTerritory&{providerCountryCode?:unknown}).providerCountryCode;
  // Persisted snapshots use null for an unavailable provider country. Null is not a contradictory country.
  // Do not spread arbitrary snapshot/browser properties into server-derived approval flags.
  return {countryCode:territory.countryCode,subdivisionCode:territory.subdivisionCode,residenceCountryCode:territory.residenceCountryCode,
    billingCountryCode:territory.billingCountryCode,customerType:territory.customerType,
    ...(providerCountryCode!==null&&providerCountryCode!==undefined?{providerCountryCode:String(providerCountryCode)}:{}),
    mode:requireDigitalEnvironment(),termsVersion,locale:"fr",providerAllowed:true,rightsApproved:true,formatsReady:true,localQaFixtureAuthorized:qa};
}
type AcquiredTerritory=DigitalJurisdictionSnapshot&{franceResidence?:DigitalFranceResidenceSnapshot;franceResidenceV2?:DigitalFranceResidenceSnapshotV2};
function localRule(v2:boolean,termsVersion=DIGITAL_TERMS_VERSION){const rule=localQaDigitalCountryRule(termsVersion);return v2?{...rule,subdivisionCode:DIGITAL_FRANCE_LAUNCH_POLICY.registrySubdivision}:rule;}
export async function reserveDigitalJurisdiction(territory:DigitalCustomerTerritory|undefined,tx:Prisma.TransactionClient,qa:boolean,subjectUserId?:string,termsVersion=DIGITAL_TERMS_VERSION):Promise<AcquiredTerritory>{
  const context=input(territory,qa,termsVersion);
  const hasFranceDeclaration=territory&&(territory.residencePostalCode!==undefined||territory.billingPostalCode!==undefined||territory.residenceConfirmed!==undefined);
  if(hasFranceDeclaration){
    if(territory.residenceConfirmed!==true||context.countryCode!=="FR"||context.residenceCountryCode!=="FR"||context.billingCountryCode!=="FR")throw new DigitalError("FRANCE_RESIDENCE_DECLARATION_REQUIRED",409);
    parseDigitalFranceDeclaration({countryCode:"FR",postalCode:territory.residencePostalCode,billingPostalCode:territory.billingPostalCode});
  }
  const v2=territory&&(territory.residenceDeclarationId!==undefined||territory.addressHash!==undefined);
  // Existing isolated provider-double fixtures are not residence/fiscal evidence.
  if(qa&&!v2)return assertDigitalCheckoutJurisdiction(context,tx,localRule(false,termsVersion));
  if(!territory||!subjectUserId||territory.residenceConfirmed!==true||context.countryCode!=="FR"||context.residenceCountryCode!=="FR"||context.billingCountryCode!=="FR"
    ||territory.subdivisionCode!==undefined&&territory.subdivisionCode!==DIGITAL_FRANCE_LAUNCH_POLICY.registrySubdivision)throw new DigitalError("FRANCE_RESIDENCE_DECLARATION_REQUIRED",409);
  if(!digitalUuid(territory.residenceDeclarationId)||typeof territory.addressHash!=="string"||!/^[a-f0-9]{64}$/.test(territory.addressHash)||!territory.billingPostalCode)throw new DigitalError("FRANCE_ADDRESS_DECLARATION_REQUIRED",409);
  const residence=assertDigitalFranceResidenceV2Prepared(await assessDigitalFranceResidenceV2({residenceDeclarationId:territory.residenceDeclarationId,addressHash:territory.addressHash,billingPostalCode:territory.billingPostalCode},subjectUserId,tx));
  if(residence.residencePostalCode!==territory.residencePostalCode)throw new DigitalError("FRANCE_RESIDENCE_PROOF_CHANGED_REQUIRES_REVIEW",409);
  const jurisdiction=await assertDigitalCheckoutJurisdiction({...context,subdivisionCode:DIGITAL_FRANCE_LAUNCH_POLICY.registrySubdivision},tx,qa?localRule(true,termsVersion):undefined);
  return{...jurisdiction,franceResidenceV2:residence};
}
/** Missing historical snapshots remain historical, never inferred or rewritten. */
export async function checkDigitalAcquiredJurisdiction(snapshot:unknown,tx:Prisma.TransactionClient,merchant?:string,subjectUserId?:string){
  if(snapshot===null||snapshot===undefined)return;
  const s=snapshot as AcquiredTerritory;
  const qa=s.approvalScope==="LOCAL_QA"&&digitalLocalTerritoryFixtureAllowed(merchant??LOCAL_REVIEW_MERCHANT);
  const v2=Object.prototype.hasOwnProperty.call(s,"franceResidenceV2");
  if(!qa&&s.subdivisionCode===DIGITAL_FRANCE_LAUNCH_POLICY.registrySubdivision&&!Object.prototype.hasOwnProperty.call(s,"franceResidence")&&!v2)throw new DigitalError("FRANCE_RESIDENCE_PROOF_BINDING_INVALID",409);
  if(v2){
    if(Object.prototype.hasOwnProperty.call(s,"franceResidence")||!subjectUserId||s.franceResidenceV2?.subjectUserId!==subjectUserId||s.countryCode!=="FR"||s.subdivisionCode!==DIGITAL_FRANCE_LAUNCH_POLICY.registrySubdivision)throw new DigitalError("FRANCE_RESIDENCE_PROOF_BINDING_INVALID",409);
    await revalidateDigitalFranceResidenceV2(s.franceResidenceV2,subjectUserId,tx);
  }
  if(Object.prototype.hasOwnProperty.call(s,"franceResidence")){
    const residence=s.franceResidence;
    if(qa||!residence||!subjectUserId||residence.subjectUserId!==subjectUserId||s.countryCode!=="FR"||s.subdivisionCode!==DIGITAL_FRANCE_LAUNCH_POLICY.registrySubdivision)throw new DigitalError("FRANCE_RESIDENCE_PROOF_BINDING_INVALID",409);
    const current=await assessDigitalFranceResidence({countryCode:"FR",postalCode:residence.residencePostalCode,billingPostalCode:residence.billingPostalCode},subjectUserId,tx);
    revalidateDigitalFranceResidenceSnapshot(residence,current);
  }
  // Revalidation follows the acquired policy version, never the current checkout template.
  return revalidateDigitalCheckoutJurisdiction(s,input(s,qa,s.termsVersion),tx,qa?localRule(v2,s.termsVersion):undefined);
}
/** Retry is not permission to change the bound territory or reuse an outdated
 * address review. Only new V2 orders gain this guard; old receipts stay intact. */
export async function checkDigitalResidenceRetry(territory:DigitalCustomerTerritory|undefined,snapshot:unknown,tx:Prisma.TransactionClient,merchant:string,userId:string){
  if(!snapshot||typeof snapshot!=="object"||Array.isArray(snapshot)||!("franceResidenceV2" in snapshot))return;
  const s=snapshot as AcquiredTerritory,b=s.franceResidenceV2;
  if(!territory||!b||territory.countryCode!=="FR"||territory.residenceCountryCode!=="FR"||territory.billingCountryCode!=="FR"||territory.customerType!=="B2C"||territory.residenceConfirmed!==true
    ||territory.subdivisionCode!==undefined&&territory.subdivisionCode!=="FR-MET"
    ||billingSnapshotHash([territory.residenceDeclarationId,territory.addressHash,territory.residencePostalCode,territory.billingPostalCode])!==billingSnapshotHash([b.residenceDeclarationId,b.addressHash,b.residencePostalCode,b.billingPostalCode]))throw new DigitalError("FRANCE_RESIDENCE_PROOF_CHANGED_REQUIRES_REVIEW",409);
  await checkDigitalAcquiredJurisdiction(s,tx,merchant,userId);
}
