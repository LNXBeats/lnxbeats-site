import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import Stripe from "stripe";
import { digitalAvailableProviders, digitalStripeParameters, stripeDigitalEvidence, verifiedDigitalStripeEvent, verifyDigitalPaypalEvent } from "@/lib/digital/providers";
import { digitalEnabled } from "@/lib/digital/domain";

test("public DCN flag fails closed for missing mode or production context", () => {
  assert.equal(digitalEnabled({ DCN_ENABLED: "true" }), false);
  assert.equal(digitalEnabled({ DCN_ENABLED: "true", DCN_MODE: "LIVE" }), false);
  assert.equal(digitalEnabled({ DCN_ENABLED: "true", DCN_MODE: "TEST", PAYMENT_DEPLOYMENT_ENV: "production" }), false);
  assert.equal(digitalEnabled({ DCN_ENABLED: "true", DCN_MODE: "TEST" }), true);
});
test("valid TEST signatures/credentials alone never authorize remote webhook verification",async()=>{
  const names=["DCN_ENABLED","DCN_MODE","DCN_STRIPE_SECRET_KEY","DCN_STRIPE_ACCOUNT_ID","DCN_STRIPE_WEBHOOK_SECRET","DCN_EXTERNAL_TEST_AUTHORIZED"];
  const old=new Map(names.map(k=>[k,process.env[k]]));const secret="whsec_LOCAL_DUMMY_ONLY";
  try{Object.assign(process.env,{DCN_ENABLED:"true",DCN_MODE:"TEST",DCN_STRIPE_SECRET_KEY:"sk_test_LOCAL_DUMMY_ONLY",DCN_STRIPE_ACCOUNT_ID:"acct_localDummy",DCN_STRIPE_WEBHOOK_SECRET:secret,DCN_EXTERNAL_TEST_AUTHORIZED:"false"});
    const payload=JSON.stringify({id:"evt_local",object:"event",type:"checkout.session.completed",livemode:false,data:{object:{}}}),client=new Stripe("sk_test_LOCAL_DUMMY_ONLY");
    await assert.rejects(verifiedDigitalStripeEvent(payload,client.webhooks.generateTestHeaderString({payload,secret})),{code:"EXTERNAL_QA_AUTHORIZATION_REQUIRED"});
    assert.throws(()=>verifyDigitalPaypalEvent("{}",{transmissionId:"qa",transmissionTime:"qa",certUrl:"https://api.sandbox.paypal.com/qa",authAlgo:"SHA256withRSA",transmissionSignature:"qa"}),{code:"EXTERNAL_QA_AUTHORIZATION_REQUIRED"});
  }finally{for(const[key,value]of old){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});

test("available sandboxes require their own merchant and signature configuration; no LIVE fallback", () => {
  const names = ["DCN_ENABLED", "DCN_MODE", "DCN_STRIPE_SECRET_KEY", "DCN_STRIPE_ACCOUNT_ID", "DCN_STRIPE_WEBHOOK_SECRET", "DCN_PAYPAL_ENVIRONMENT", "STRIPE_SECRET_KEY"];
  const old = new Map(names.map(k => [k, process.env[k]]));
  try {
    Object.assign(process.env, { DCN_ENABLED: "true", DCN_MODE: "TEST", STRIPE_SECRET_KEY: "sk_live_NOT_A_REAL_KEY" });
    delete process.env.DCN_STRIPE_SECRET_KEY;
    delete process.env.DCN_STRIPE_WEBHOOK_SECRET;
    delete process.env.DCN_PAYPAL_ENVIRONMENT;
    assert.deepEqual(digitalAvailableProviders(), []);
    Object.assign(process.env, { DCN_STRIPE_SECRET_KEY: "sk_test_LOCAL_DUMMY_ONLY", DCN_STRIPE_ACCOUNT_ID: "acct_localDummy" });
    assert.deepEqual(digitalAvailableProviders(), []);
    process.env.DCN_STRIPE_WEBHOOK_SECRET = "whsec_LOCAL_DUMMY_ONLY";
    assert.deepEqual(digitalAvailableProviders(), ["STRIPE"]);
    process.env.DCN_STRIPE_SECRET_KEY = "sk_live_NOT_A_REAL_KEY";
    assert.deepEqual(digitalAvailableProviders(), []);
  } finally { for (const [key, value] of old) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});

test("Checkout metadata belongs only to DCN; physical Orders/Support metadata is not reused", () => {
  const order = { id: randomUUID(), totalCents: 305, userEmail: "qa@example.invalid", lines: [{ title: "Titre QA", priceCents: 305 }] };
  const attempt = randomUUID();
  const p = digitalStripeParameters(order, attempt);
  assert.deepEqual(p.metadata, { paymentSource: "DIGITAL_MUSIC", digitalOrderId: order.id, digitalAttemptId: attempt, mode: "TEST" });
  assert.deepEqual(p.payment_intent_data?.metadata, p.metadata);
  assert.equal(p.mode, "payment");
  assert.equal(p.line_items?.[0]?.price_data?.unit_amount, 305);
});

test("Stripe session evidence rejects LIVE, wrong domain, reference and currency", () => {
  const id = randomUUID();
  const s = { id: "cs_test_local", livemode: false, client_reference_id: id, amount_total: 305, currency: "eur", payment_intent: "pi_local",
    status: "complete", payment_status: "paid", metadata: { paymentSource: "DIGITAL_MUSIC", digitalOrderId: id, digitalAttemptId: randomUUID(), mode: "TEST" } } as unknown as Stripe.Checkout.Session;
  assert.equal(stripeDigitalEvidence(s, "evt_local", "acct_local").status, "PAID");
  for (const patch of [{ livemode: true }, { currency: "usd" }, { client_reference_id: randomUUID() }, { metadata: { ...s.metadata, paymentSource: "SUPPORT" } }]) {
    assert.throws(() => stripeDigitalEvidence({ ...s, ...patch } as Stripe.Checkout.Session, "evt_local", "acct_local"));
  }
  assert.equal(stripeDigitalEvidence({ ...s, status: "open", payment_status: "unpaid" }, "evt_pending", "acct_local").status, "PENDING");
  assert.equal(stripeDigitalEvidence({ ...s, status: "expired", payment_status: "unpaid" }, "evt_expired", "acct_local").status, "FAILED");
  assert.equal(stripeDigitalEvidence({ ...s, status: "complete", payment_status: "unpaid" }, "evt_async_failed", "acct_local", "checkout.session.async_payment_failed").status, "FAILED");
});
test("dedicated Stripe webhook rejects bad signatures, LIVE and Connect before any account request", async()=>{
  const names=["DCN_ENABLED","DCN_MODE","DCN_STRIPE_SECRET_KEY","DCN_STRIPE_ACCOUNT_ID","DCN_STRIPE_WEBHOOK_SECRET"];
  const old=new Map(names.map(k=>[k,process.env[k]]));const secret="whsec_LOCAL_DUMMY_ONLY";
  try{Object.assign(process.env,{DCN_ENABLED:"true",DCN_MODE:"TEST",DCN_STRIPE_SECRET_KEY:"sk_test_LOCAL_DUMMY_ONLY",DCN_STRIPE_ACCOUNT_ID:"acct_localDummy",DCN_STRIPE_WEBHOOK_SECRET:secret});
    await assert.rejects(verifiedDigitalStripeEvent("{}","invalid"),{code:"INVALID_WEBHOOK"});
    const client=new Stripe("sk_test_LOCAL_DUMMY_ONLY");
    for(const extra of [{livemode:true},{livemode:false,account:"acct_other"}]){const payload=JSON.stringify({id:"evt_local",object:"event",type:"checkout.session.completed",data:{object:{}},...extra});
      const signature=client.webhooks.generateTestHeaderString({payload,secret});await assert.rejects(verifiedDigitalStripeEvent(payload,signature),{code:"INVALID_WEBHOOK"});}
  }finally{for(const[key,value]of old){if(value===undefined)delete process.env[key];else process.env[key]=value;}}
});
