import assert from "node:assert/strict";
import test from "node:test";
import { createDigitalCheckoutOperationLock } from "@/lib/digital/checkout-operation";

test("a late PayPal error cannot release an outstanding Stripe request or allow a second checkout",()=>{
  const lock=createDigitalCheckoutOperationLock();
  assert.equal(lock.claim("STRIPE"),true);
  assert.equal(lock.claim("PAYPAL"),false);
  assert.equal(lock.release("PAYPAL"),false);
  assert.equal(lock.isOwnedBy("STRIPE"),true);
  assert.equal(lock.claim("STRIPE"),false);
  assert.equal(lock.release("STRIPE"),true);
  assert.equal(lock.claim("PAYPAL"),true);
});
test("a PayPal popup retains ownership through creation and approval until its own completion",()=>{
  const lock=createDigitalCheckoutOperationLock();
  assert.equal(lock.claim("PAYPAL"),true);
  assert.equal(lock.claim("STRIPE"),false);
  assert.equal(lock.release("STRIPE"),false);
  assert.equal(lock.isOwnedBy("PAYPAL"),true);
  assert.equal(lock.release("PAYPAL"),true);
  assert.equal(lock.claim("STRIPE"),true);
});
test("duplicate provider completion cannot release an unowned operation",()=>{
  const lock=createDigitalCheckoutOperationLock();
  assert.equal(lock.release("PAYPAL"),false);
  assert.equal(lock.claim("PAYPAL"),true);
  assert.equal(lock.release("PAYPAL"),true);
  assert.equal(lock.claim("STRIPE"),true);
  assert.equal(lock.release("PAYPAL"),false);
});
test("repeated activation of the same provider cannot acquire two simultaneous locks",()=>{
  const lock=createDigitalCheckoutOperationLock();
  assert.equal(lock.claim("STRIPE"),true);
  assert.equal(lock.claim("STRIPE"),false);
  assert.equal(lock.release("STRIPE"),true);
  assert.equal(lock.release("STRIPE"),false);
});
