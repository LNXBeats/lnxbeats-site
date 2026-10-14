import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { DigitalError, DIGITAL_TERMS_VERSION } from "./domain";
import { localDigitalReviewAvailable, LOCAL_REVIEW_MERCHANT } from "./local-review-policy";
import { localQaDigitalCountryRule, type DigitalJurisdictionInput, type DigitalJurisdictionSnapshot } from "./jurisdictions";
import { assertDigitalCheckoutJurisdiction, revalidateDigitalCheckoutJurisdiction } from "./jurisdictions-service";

export type DigitalCustomerTerritory = { countryCode:string; subdivisionCode?:string; residenceCountryCode:string; billingCountryCode:string; customerType:string };
export function parseDigitalCustomerTerritory(value:unknown):DigitalCustomerTerritory {
  if(!value||typeof value!=="object"||Array.isArray(value))throw new DigitalError("COUNTRY_EVIDENCE_REQUIRED",409);
  const v=value as Record<string,unknown>;
  if(Object.keys(v).some(k=>!["countryCode","subdivisionCode","residenceCountryCode","billingCountryCode","customerType"].includes(k))
    ||["countryCode","residenceCountryCode","billingCountryCode"].some(k=>typeof v[k]!=="string"||!/^[A-Z]{2}$/.test(v[k] as string))
    ||v.customerType!=="B2C"||v.subdivisionCode!==undefined&&(typeof v.subdivisionCode!=="string"||v.subdivisionCode.length>10))throw new DigitalError("INVALID_TERRITORY_INPUT",400);
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
export async function reserveDigitalJurisdiction(territory:DigitalCustomerTerritory|undefined,tx:Prisma.TransactionClient,qa:boolean){
  return assertDigitalCheckoutJurisdiction(input(territory,qa),tx,qa?localQaDigitalCountryRule(DIGITAL_TERMS_VERSION):undefined);
}
/** Missing historical snapshots remain historical, never inferred or rewritten. */
export async function checkDigitalAcquiredJurisdiction(snapshot:unknown,tx:Prisma.TransactionClient,merchant?:string){
  if(snapshot===null||snapshot===undefined)return;
  const s=snapshot as DigitalJurisdictionSnapshot;
  const qa=s.approvalScope==="LOCAL_QA"&&digitalLocalTerritoryFixtureAllowed(merchant??LOCAL_REVIEW_MERCHANT);
  return revalidateDigitalCheckoutJurisdiction(s,input(s,qa),tx,qa?localQaDigitalCountryRule(DIGITAL_TERMS_VERSION):undefined);
}
