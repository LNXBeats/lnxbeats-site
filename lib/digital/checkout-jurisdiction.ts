import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { DigitalError, DIGITAL_TERMS_VERSION } from "./domain";
import { localDigitalReviewAvailable, LOCAL_REVIEW_MERCHANT } from "./local-review-policy";
import { localQaDigitalCountryRule, type DigitalJurisdictionInput, type DigitalJurisdictionSnapshot } from "./jurisdictions";
import { assertDigitalCheckoutJurisdiction, revalidateDigitalCheckoutJurisdiction } from "./jurisdictions-service";
import {DIGITAL_FRANCE_LAUNCH_POLICY,parseDigitalFranceDeclaration,assertDigitalFranceResidencePrepared,revalidateDigitalFranceResidenceSnapshot,type DigitalFranceResidenceSnapshot} from "./france-launch-policy";
import {assessDigitalFranceResidence} from "./france-residence-service";

export type DigitalCustomerTerritory = { countryCode:string; subdivisionCode?:string; residenceCountryCode:string; billingCountryCode:string; customerType:string;
  residencePostalCode?:string;billingPostalCode?:string;residenceConfirmed?:boolean };
export function parseDigitalCustomerTerritory(value:unknown):DigitalCustomerTerritory {
  if(!value||typeof value!=="object"||Array.isArray(value))throw new DigitalError("COUNTRY_EVIDENCE_REQUIRED",409);
  const v=value as Record<string,unknown>;
  if(Object.keys(v).some(k=>!["countryCode","subdivisionCode","residenceCountryCode","billingCountryCode","customerType","residencePostalCode","billingPostalCode","residenceConfirmed"].includes(k))
    ||["countryCode","residenceCountryCode","billingCountryCode"].some(k=>typeof v[k]!=="string"||!/^[A-Z]{2}$/.test(v[k] as string))
    ||v.customerType!=="B2C"||v.subdivisionCode!==undefined&&(typeof v.subdivisionCode!=="string"||v.subdivisionCode.length>10)
    ||["residencePostalCode","billingPostalCode"].some(k=>v[k]!==undefined&&(typeof v[k]!=="string"||!/^\d{5}$/.test(v[k] as string)))
    ||v.residenceConfirmed!==undefined&&typeof v.residenceConfirmed!=="boolean")throw new DigitalError("INVALID_TERRITORY_INPUT",400);
  return v as DigitalCustomerTerritory;
}
/** Server-only capability for provider doubles in the exact isolated local profile. */
export function digitalLocalTerritoryFixtureAllowed(merchant:string) {
  return (merchant===LOCAL_REVIEW_MERCHANT||merchant.startsWith("dcn-consolidation-"))
    && localDigitalReviewAvailable({...process.env,DCN_NEW_PAYMENTS_ENABLED:"false"});
}
function input(territory:DigitalCustomerTerritory|undefined,qa:boolean):DigitalJurisdictionInput {
  if(!territory||typeof territory.countryCode!=="string"||typeof territory.residenceCountryCode!=="string"||typeof territory.billingCountryCode!=="string"
    ||territory.customerType!=="B2C"||territory.subdivisionCode!==undefined&&typeof territory.subdivisionCode!=="string")throw new DigitalError("COUNTRY_EVIDENCE_REQUIRED",409);
  if(qa&&!digitalLocalTerritoryFixtureAllowed(LOCAL_REVIEW_MERCHANT))throw new DigitalError("LOCAL_QA_POLICY_NOT_AUTHORIZED",403);
  const providerCountryCode=(territory as DigitalCustomerTerritory&{providerCountryCode?:unknown}).providerCountryCode;
  // Persisted snapshots use null for an unavailable provider country. Null is not a contradictory country.
  // Do not spread arbitrary snapshot/browser properties into server-derived approval flags.
  return {countryCode:territory.countryCode,subdivisionCode:territory.subdivisionCode,residenceCountryCode:territory.residenceCountryCode,
    billingCountryCode:territory.billingCountryCode,customerType:territory.customerType,
    ...(providerCountryCode!==null&&providerCountryCode!==undefined?{providerCountryCode:String(providerCountryCode)}:{}),
    mode:"TEST",termsVersion:DIGITAL_TERMS_VERSION,locale:"fr",providerAllowed:true,rightsApproved:true,formatsReady:true,localQaFixtureAuthorized:qa};
}
export async function reserveDigitalJurisdiction(territory:DigitalCustomerTerritory|undefined,tx:Prisma.TransactionClient,qa:boolean,subjectUserId?:string):Promise<DigitalJurisdictionSnapshot&{franceResidence?:DigitalFranceResidenceSnapshot}>{
  const context=input(territory,qa);
  const hasFranceDeclaration=territory&&(territory.residencePostalCode!==undefined||territory.billingPostalCode!==undefined||territory.residenceConfirmed!==undefined);
  if(hasFranceDeclaration){
    if(territory.residenceConfirmed!==true||context.countryCode!=="FR"||context.residenceCountryCode!=="FR"||context.billingCountryCode!=="FR")throw new DigitalError("FRANCE_RESIDENCE_DECLARATION_REQUIRED",409);
    parseDigitalFranceDeclaration({countryCode:"FR",postalCode:territory.residencePostalCode,billingPostalCode:territory.billingPostalCode});
  }
  // Existing isolated provider-double fixtures are not residence/fiscal evidence.
  if(qa)return assertDigitalCheckoutJurisdiction(context,tx,localQaDigitalCountryRule(DIGITAL_TERMS_VERSION));
  if(!territory||!subjectUserId||territory.residenceConfirmed!==true||context.countryCode!=="FR"||context.residenceCountryCode!=="FR"||context.billingCountryCode!=="FR"
    ||territory.subdivisionCode!==undefined&&territory.subdivisionCode!==DIGITAL_FRANCE_LAUNCH_POLICY.registrySubdivision)throw new DigitalError("FRANCE_RESIDENCE_DECLARATION_REQUIRED",409);
  const residence=assertDigitalFranceResidencePrepared(await assessDigitalFranceResidence({countryCode:"FR",postalCode:territory.residencePostalCode,billingPostalCode:territory.billingPostalCode},subjectUserId,tx));
  const jurisdiction=await assertDigitalCheckoutJurisdiction({...context,subdivisionCode:DIGITAL_FRANCE_LAUNCH_POLICY.registrySubdivision},tx);
  return{...jurisdiction,franceResidence:residence};
}
/** Missing historical snapshots remain historical, never inferred or rewritten. */
export async function checkDigitalAcquiredJurisdiction(snapshot:unknown,tx:Prisma.TransactionClient,merchant?:string,subjectUserId?:string){
  if(snapshot===null||snapshot===undefined)return;
  const s=snapshot as DigitalJurisdictionSnapshot&{franceResidence?:DigitalFranceResidenceSnapshot};
  const qa=s.approvalScope==="LOCAL_QA"&&digitalLocalTerritoryFixtureAllowed(merchant??LOCAL_REVIEW_MERCHANT);
  if(!qa&&s.subdivisionCode===DIGITAL_FRANCE_LAUNCH_POLICY.registrySubdivision&&!Object.prototype.hasOwnProperty.call(s,"franceResidence"))throw new DigitalError("FRANCE_RESIDENCE_PROOF_BINDING_INVALID",409);
  if(Object.prototype.hasOwnProperty.call(s,"franceResidence")){
    const residence=s.franceResidence;
    if(qa||!residence||!subjectUserId||residence.subjectUserId!==subjectUserId||s.countryCode!=="FR"||s.subdivisionCode!==DIGITAL_FRANCE_LAUNCH_POLICY.registrySubdivision)throw new DigitalError("FRANCE_RESIDENCE_PROOF_BINDING_INVALID",409);
    const current=await assessDigitalFranceResidence({countryCode:"FR",postalCode:residence.residencePostalCode,billingPostalCode:residence.billingPostalCode},subjectUserId,tx);
    revalidateDigitalFranceResidenceSnapshot(residence,current);
  }
  return revalidateDigitalCheckoutJurisdiction(s,input(s,qa),tx,qa?localQaDigitalCountryRule(DIGITAL_TERMS_VERSION):undefined);
}
