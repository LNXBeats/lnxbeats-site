import {test} from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import type Stripe from "stripe";
import {assertDigitalProviderBilling,digitalExpectedBilling,digitalProviderBilling,digitalPaypalProviderBilling} from "@/lib/digital/france-provider-billing";
import {stripeDigitalEvidence} from "@/lib/digital/providers";
import {digitalPaypalOrderEvidence} from "@/lib/digital/paypal-evidence";
const expected={countryCode:"FR" as const,billingPostalCode:"20000"};
test("provider billing minimises existing response and never invents residence or card origin",()=>{
  assert.equal(digitalProviderBilling(null),undefined);
  assert.equal(digitalProviderBilling({city:"PRIVATE",line1:"PRIVATE"}),undefined);
  assert.deepEqual(digitalProviderBilling({country:"FR",postal_code:"20000",line1:"NEVER_COPIED",cardCountry:"DE"}),{countryCode:"FR",postalCode:"20000"});
  assert.deepEqual(digitalProviderBilling({country:false}),{countryCode:"INVALID"});
  assert.deepEqual(digitalProviderBilling({country_code:"DE",postal_code:"10115"}),{countryCode:"DE",postalCode:"10115"});
  assert.deepEqual(digitalProviderBilling({country:"FR",country_code:"DE"}),{countryCode:"INVALID"});
});
test("missing provider fields are unknown, not proof; available disagreements block only V2 new supply",()=>{
  assert.doesNotThrow(()=>assertDigitalProviderBilling(expected,undefined));
  assert.doesNotThrow(()=>assertDigitalProviderBilling(expected,{countryCode:"FR"}));
  assert.doesNotThrow(()=>assertDigitalProviderBilling(expected,{countryCode:"FR",postalCode:"20000"}));
  for(const actual of[{countryCode:"DE"},{countryCode:"FR",postalCode:"97100"},{postalCode:"20000\n"},{postalCode:"75001"}])assert.throws(()=>assertDigitalProviderBilling(expected,actual),{code:"FRANCE_PROVIDER_BILLING_CONFLICT"});
  assert.doesNotThrow(()=>assertDigitalProviderBilling(undefined,{countryCode:"DE"}));
  assert.equal(digitalExpectedBilling({franceResidence:{countryCode:"FR"}}),undefined);
  assert.deepEqual(digitalExpectedBilling({countryCode:"FR",franceResidenceV2:expected}),expected);
  assert.throws(()=>digitalExpectedBilling({countryCode:"DE",franceResidenceV2:expected}));
});
test("authenticated Stripe normalisation carries only existing billing country/postal and no extra API call",()=>{
  const s={id:"cs_test_local",livemode:false,metadata:{paymentSource:"DIGITAL_MUSIC",mode:"TEST",digitalOrderId:"order"},client_reference_id:"order",amount_total:990,currency:"eur",status:"complete",payment_status:"paid",payment_intent:"pi_test_local",customer_details:{address:{country:"FR",postal_code:"20000",line1:"NEVER_COPIED"}}} as unknown as Stripe.Checkout.Session;
  const e=stripeDigitalEvidence(s,"evt_local","acct_local");assert.equal(e.status,"PAID");assert.deepEqual(e.billing,{countryCode:"FR",postalCode:"20000"});assert.equal(JSON.stringify(e).includes("NEVER_COPIED"),false);
  assert.equal(stripeDigitalEvidence({...s,customer_details:null},"evt_local","acct_local").billing,undefined);
});
test("provider inconsistency gates are before entitlement and PayPal capture, not a refund or legacy download rewrite",async()=>{
  const commerce=await readFile(new URL("../../lib/digital/commerce.ts",import.meta.url),"utf8"),provider=await readFile(new URL("../../lib/digital/providers.ts",import.meta.url),"utf8");
  assert.ok(commerce.indexOf("assertDigitalProviderBilling(digitalExpectedBilling(order.jurisdictionSnapshot),e.billing)")<commerce.indexOf("await tx.digitalEntitlement.upsert"));
  const capture=provider.slice(provider.indexOf("async capture(order, attempt)"));assert.ok(capture.indexOf("assertDigitalProviderBilling(")<capture.indexOf("await client.captureOrder("));
});
test("fresh PayPal Orders response carries its existing payer billing country without inventing a shipping address",()=>{
  const body={id:"ORDER-QA",status:"COMPLETED",payer:{address:{country_code:"DE",postal_code:"10115"}},purchase_units:[{reference_id:"order",custom_id:"attempt",payee:{merchant_id:"merchant"},amount:{value:"9.90",currency_code:"EUR"},payments:{captures:[{id:"CAPTURE-QA",status:"COMPLETED",amount:{value:"9.90",currency_code:"EUR"},final_capture:true,update_time:"2026-10-15T08:00:00Z"}]}}]};
  const evidence=digitalPaypalOrderEvidence(body,{id:"order",totalCents:990},{id:"attempt",providerReference:"ORDER-QA"},"merchant");
  assert.equal(evidence.status,"PAID");assert.deepEqual(evidence.billing,{countryCode:"DE",postalCode:"10115"});
  assert.throws(()=>assertDigitalProviderBilling(expected,evidence.billing),{code:"FRANCE_PROVIDER_BILLING_CONFLICT"});
  assert.deepEqual(digitalPaypalProviderBilling({payment_source:{paypal:{address:{country_code:"DE",postal_code:"10115"}}}}),evidence.billing);
  assert.deepEqual(digitalPaypalProviderBilling({payment_source:{card:{billing_address:{country_code:"FR",postal_code:"20000"},bin_details:{bin_country_code:"DE"}}}}),{countryCode:"FR",postalCode:"20000"});
  assert.deepEqual(digitalPaypalProviderBilling({payer:{address:{country_code:"FR"}},payment_source:{paypal:{address:{country_code:"DE"}}}}),{countryCode:"INVALID"});
  assert.equal(digitalPaypalProviderBilling({purchase_units:[{shipping:{address:{country_code:"DE"}}}],payment_source:{card:{bin_details:{bin_country_code:"DE"}}}}),undefined);
});
