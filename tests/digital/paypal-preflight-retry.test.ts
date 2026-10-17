import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { DigitalRequestError, digitalCheckoutPreflightRefused } from "@/lib/digital/request-error";
import { digitalPaypalButtonOptions, digitalPaypalRenderStatus } from "@/lib/digital/paypal-sdk-browser";

const source = (path: string) => readFile(new URL(`../../${path}`, import.meta.url), "utf8");
const order = { orderId: "d08df2b5-bc3b-445d-a012-a1c2a41f3927", providerOrderId: "QA123456789ORDER" };
test("only exact structured pre-creation refusals are retryable; not arbitrary HTTP failures", () => {
  for (const [code, status] of [["AUTH_REQUIRED",401],["ORIGIN_REFUSED",403],["RATE_LIMITED",429],["INVALID_BODY",400],["INVALID_CHECKOUT",400],["NEW_DIGITAL_PAYMENTS_CLOSED",503]] as const) {
    assert.equal(digitalCheckoutPreflightRefused(new DigitalRequestError("synthetic",status,code)),true);
    assert.equal(digitalCheckoutPreflightRefused(new DigitalRequestError("synthetic",500,code)),false);
  }
  for (const error of [new TypeError("network"),new SyntaxError("unreadable response"),new Error("timeout"),
    new DigitalRequestError("synthetic",503,"DIGITAL_UNAVAILABLE"),new DigitalRequestError("synthetic",409,"PAYMENT_ALREADY_ENGAGED"),
    new DigitalRequestError("synthetic",400,null),{status:429,code:"RATE_LIMITED"}]) assert.equal(digitalCheckoutPreflightRefused(error),false);
});
test("rejected SDK creation stays deduplicated until an explicit Buttons restart, retaining the parent's idempotency key", async () => {
  const key = "8b7bbe08-62b3-4a8a-9db8-1dc2f546e0a0", keys: string[] = [];
  let refused = true;
  const callbacks = {ready:()=>true,createOrder:async()=>{keys.push(key);if(refused)throw new DigitalRequestError("wait",429,"RATE_LIMITED");return order;},onApprove:async()=>{},onCancel:()=>{},onError:()=>{}};
  const initial = digitalPaypalButtonOptions(callbacks);
  const results = await Promise.allSettled([initial.createOrder(),initial.createOrder()]);
  assert.equal(results.filter(r=>r.status==="rejected").length,2);assert.deepEqual(keys,[key]);
  refused=false;
  await assert.rejects(initial.createOrder(),{code:"RATE_LIMITED"});assert.deepEqual(keys,[key]);
  // Only the human retry control constructs a new SDK Buttons instance.
  const restarted = digitalPaypalButtonOptions(callbacks);
  assert.deepEqual(await Promise.all([restarted.createOrder(),restarted.createOrder()]),[order.providerOrderId,order.providerOrderId]);
  assert.deepEqual(keys,[key,key]);
});
test("an ambiguous response never turns cached creation into another automatic server operation", async () => {
  let calls=0;
  const options=digitalPaypalButtonOptions({ready:()=>true,createOrder:async()=>{calls++;throw new TypeError("response lost");},onApprove:async()=>{},onCancel:()=>{},onError:()=>{}});
  for(let n=0;n<3;n++)await assert.rejects(options.createOrder(),/response lost/);
  assert.equal(calls,1);
});
test("the SDK's explicit preflight retry is separate from network reload and cannot reset the checkout key", async () => {
  const s=await source("components/digital-paypal-buttons.tsx");
  assert.ok(s.includes('digitalCheckoutPreflightRefused(error)) setStatus("preflight")'));
  assert.ok(s.includes('hidden={status === "preflight"}'));
  assert.ok(s.includes("Réessayer la préparation PayPal"));
  assert.doesNotMatch(s,/randomUUID|key\.current|actions\.order\.create|actions\.order\.capture/);
});
test("known or ambiguous orders block both payment cards and retain a safe account or order follow-up", async () => {
  const s=await source("components/digital-checkout.tsx");
  assert.ok(s.includes('if(startedOrder.current||!digitalCheckoutPreflightRefused(e))setAttemptNeedsReview(true)'));
  assert.match(s,/const paymentReady=[^;]*&&!attemptNeedsReview/);
  assert.ok(s.includes('attemptNeedsReview&&!pendingOrderId?<Link href="/compte/musique"'));
  const handler=s.slice(s.indexOf("async function createPaypalOrder()"),s.indexOf("async function approvePaypalOrder("));
  assert.doesNotMatch(handler,/key\.current\s*=/);
});
test("HTTP failure keeps code and status without printing raw payloads; API preflight guards precede the handler", async () => {
  const request=await source("components/digital-cart.tsx"),api=await source("lib/digital/http.ts"),commerce=await source("lib/digital/commerce.ts");
  assert.ok(request.includes("throw new DigitalRequestError("));assert.ok(request.includes("r.status"));
  assert.doesNotMatch(request,/console\./);
  assert.ok(api.indexOf('await digitalRateLimit(actor.id,"mutation")')<api.indexOf("return await handler(actor)"));
  assert.ok(commerce.indexOf('throw new DigitalError("NEW_DIGITAL_PAYMENTS_CLOSED"')<commerce.indexOf("gateway.create("));
});
test("a late render completion or error preserves the explicit preflight retry state", async () => {
  assert.equal(digitalPaypalRenderStatus("preflight","ready"),"preflight");
  assert.equal(digitalPaypalRenderStatus("preflight","error"),"preflight");
  assert.equal(digitalPaypalRenderStatus("loading","ready"),"ready");
  assert.equal(digitalPaypalRenderStatus("loading","error"),"error");
  const s=await source("components/digital-paypal-buttons.tsx");
  assert.ok(s.includes('setStatus(current => digitalPaypalRenderStatus(current, "ready"))'));
  assert.ok(s.includes('setStatus(current => digitalPaypalRenderStatus(current, "error"))'));
});
test("callbacks from a disposed PayPal instance cannot unlock or approve a newer instance", async () => {
  let active=true,calls=0,approved=0,cancelled=0,errors=0;
  const options=digitalPaypalButtonOptions({active:()=>active,ready:()=>true,createOrder:async()=>{calls++;return order;},onApprove:async()=>{approved++;},onCancel:()=>{cancelled++;},onError:()=>{errors++;}});
  assert.equal(await options.createOrder(),order.providerOrderId);
  active=false;
  await options.onApprove({orderID:order.providerOrderId});options.onCancel();options.onError();
  await assert.rejects(options.createOrder(),/CHECKOUT_CLOSED/);
  assert.deepEqual({calls,approved,cancelled,errors},{calls:1,approved:0,cancelled:0,errors:0});
  let finish!: (value:typeof order)=>void;
  active=true;
  const late=digitalPaypalButtonOptions({active:()=>active,ready:()=>true,createOrder:()=>new Promise(resolve=>{finish=resolve;}),onApprove:async()=>{approved++;},onCancel:()=>{},onError:()=>{}});
  const pending=late.createOrder();active=false;finish(order);
  await assert.rejects(pending,/CHECKOUT_CLOSED/);assert.equal(approved,0);
});
