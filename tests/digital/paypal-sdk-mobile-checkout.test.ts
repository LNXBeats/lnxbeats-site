import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { NextRequest } from "next/server";
import { proxy } from "@/proxy";
import { CSP_NONCE_HEADER } from "@/lib/security/csp-nonce";
import { contentSecurityPolicy } from "@/lib/security/content-security-policy";
import { digitalPaypalSdkConfiguration } from "@/lib/digital/paypal-sdk-config";
import { createDigitalPaypalSdkLoader, digitalPaypalButtonOptions, digitalPaypalDocumentNonce, digitalPaypalSdkUrl, type DigitalPaypalButtonOptions, type DigitalPaypalSdk } from "@/lib/digital/paypal-sdk-browser";

const nonce = randomBytes(32).toString("base64");
const clientId = "QA_PUBLIC_CLIENT_IDENTIFIER_00001";
const sandbox = { DCN_ENABLED: "true", DCN_MODE: "TEST", DCN_NEW_PAYMENTS_ENABLED: "true", DCN_EXTERNAL_TEST_AUTHORIZED: "true",
  DCN_PAYPAL_ENVIRONMENT: "sandbox", DCN_PAYPAL_CLIENT_ID: clientId, DCN_PAYPAL_CLIENT_SECRET: "synthetic-server-only-secret",
  DCN_PAYPAL_WEBHOOK_ID: "synthetic-webhook", DCN_PAYPAL_MERCHANT_ID: "SYNTHETICSELLER", NODE_ENV: "test" } as const;
const live = { ...sandbox, NODE_ENV: "production", DCN_MODE: "LIVE", DCN_EXTERNAL_TEST_AUTHORIZED: "false", DCN_STORAGE_MODE: "OBJECT",
  RAILWAY_ENVIRONMENT_NAME: "production", MEDIA_DEPLOYMENT_ENV: "production", PAYMENT_DEPLOYMENT_ENV: "production", PAYMENTS_ENABLED: "true",
  PAYMENT_PRODUCTION_CONFIRM: "payments-production-live-approved", DCN_PAYPAL_ENVIRONMENT: "live" } as const;
const order = { orderId: "d08df2b5-bc3b-445d-a012-a1c2a41f3927", providerOrderId: "QA123456789ORDER" };

test("PayPal SDK config returns only the public Client ID and exact current mode; all server gates remain closed by default", () => {
  assert.deepEqual(digitalPaypalSdkConfiguration(sandbox), { clientId, mode: "TEST" });
  assert.deepEqual(digitalPaypalSdkConfiguration(live), { clientId, mode: "LIVE" });
  assert.equal(digitalPaypalSdkConfiguration({}), null);
  for (const patch of [{ DCN_ENABLED: "false" }, { DCN_NEW_PAYMENTS_ENABLED: "false" }, { DCN_PAYPAL_CLIENT_ID: "" }, { DCN_PAYPAL_CLIENT_SECRET: "" },
    { DCN_PAYPAL_WEBHOOK_ID: "" }, { DCN_PAYPAL_MERCHANT_ID: "" }, { DCN_EXTERNAL_TEST_AUTHORIZED: "false" }, { DCN_PAYPAL_ENVIRONMENT: "live" }]) {
    assert.equal(digitalPaypalSdkConfiguration({ ...sandbox, ...patch }), null);
  }
  assert.equal(digitalPaypalSdkConfiguration({ ...live, PAYMENTS_ENABLED: "false" }), null);
  assert.equal(digitalPaypalSdkConfiguration({ ...live, DCN_MODE: "TEST" }), null);
  assert.doesNotMatch(JSON.stringify(digitalPaypalSdkConfiguration(live)), /secret|webhook|merchant/i);
});

test("checkout alone receives nonce CSP and exact PayPal origins, without new inline/eval/wildcard script permission", t => {
  t.mock.property(process, "env", { ...process.env, ...live, ADS_CSP_NONCE_ENABLED: "false" });
  const response = proxy(new NextRequest("https://www.lnxbeats.fr/musique/checkout", { headers: { [CSP_NONCE_HEADER]: "attacker" } }));
  const generated = response.headers.get(`x-middleware-request-${CSP_NONCE_HEADER}`)!;
  assert.equal(Buffer.from(generated, "base64").length, 32);
  const policy = response.headers.get("Content-Security-Policy")!;
  assert.equal(policy, contentSecurityPolicy(process.env, generated, { digitalPaypalMode: "LIVE" }));
  assert.match(policy, /frame-src 'self' https:\/\/www.paypal.com/);
  assert.match(policy, /connect-src 'self' https:\/\/www.paypal.com https:\/\/www.paypalobjects.com/);
  assert.doesNotMatch(policy, /sandbox|\*|unsafe-eval/);
  assert.doesNotMatch(policy.split("; ").find(value => value.startsWith("script-src"))!, /unsafe-inline|'self'|https:/);
  assert.match(response.headers.get("Cache-Control")!, /private, no-store/);
  for (const path of ["/musique/panier", "/admin", "/compte/musique", "/api/digital/checkout", "/boutique", "/soutenir"]) {
    assert.equal(proxy(new NextRequest(`https://www.lnxbeats.fr${path}`)).headers.get("Content-Security-Policy"), null);
  }
  assert.equal(proxy(new NextRequest("https://www.lnxbeats.fr/musique/checkout", { method: "POST" })).headers.get("Content-Security-Policy"), null);
});

test("missing PayPal configuration never widens CSP, even on nonce-protected checkout", () => {
  assert.doesNotMatch(contentSecurityPolicy({}, nonce), /paypal/);
  assert.doesNotMatch(contentSecurityPolicy({}, undefined, { digitalPaypalMode: "LIVE" }), /paypal/);
  const sandboxPolicy = contentSecurityPolicy({}, nonce, { digitalPaypalMode: "TEST" });
  assert.match(sandboxPolicy, /frame-src 'self' https:\/\/www.paypal.com https:\/\/www.sandbox.paypal.com/);
});

function fakeBrowser() {
  const scripts: Array<{ id: string; src: string; nonce: string; async: boolean; removed: boolean; attributes: Record<string, string>; onload: (() => void) | null; onerror: (() => void) | null; remove: () => void; setAttribute: (name: string, value: string) => void }> = [];
  const doc = {
    getElementById: (id: string) => scripts.find(value => value.id === id && !value.removed),
    createElement: () => {
      const script = { id: "", src: "", nonce: "", async: false, removed: false, attributes: {} as Record<string, string>, onload: null as (() => void) | null, onerror: null as (() => void) | null,
        remove() { this.removed = true; }, setAttribute(name: string, value: string) { this.attributes[name] = value; } };
      return script;
    },
    head: { append: (script: typeof scripts[number]) => { scripts.push(script); } },
  };
  const sdk: DigitalPaypalSdk = { FUNDING: { PAYPAL: "paypal" }, Buttons: () => ({ isEligible: () => true, render: async () => {}, close: async () => {} }) };
  const win = { lnxDigitalPaypal: sdk } as unknown as Window;
  return { doc: doc as unknown as Document, win, scripts, sdk };
}

test("official SDK loads once with nonce and scoped namespace; concurrent callers reuse it without creating an Order", async () => {
  const browser = fakeBrowser(), load = createDigitalPaypalSdkLoader();
  const first = load(clientId, nonce, browser.doc, browser.win), second = load(clientId, nonce, browser.doc, browser.win);
  assert.equal(first, second);
  assert.equal(browser.scripts.length, 1);
  const script = browser.scripts[0], url = new URL(script.src);
  assert.equal(url.origin, "https://www.paypal.com");
  assert.equal(url.pathname, "/sdk/js");
  assert.equal(url.searchParams.get("currency"), "EUR");
  assert.equal(url.searchParams.get("intent"), "capture");
  assert.equal(url.searchParams.get("components"), "buttons");
  assert.equal(url.searchParams.get("client-id"), clientId);
  assert.equal(script.nonce, nonce);
  assert.equal(script.attributes["data-csp-nonce"], nonce);
  assert.equal(script.attributes["data-namespace"], "lnxDigitalPaypal");
  script.onload!();
  assert.equal(await first, browser.sdk);
  assert.equal(await load(clientId, nonce, browser.doc, browser.win), browser.sdk);
  assert.equal(browser.scripts.length, 1);
  await assert.rejects(load("DIFFERENT_PUBLIC_CLIENT_IDENTIFIER", nonce, browser.doc, browser.win), /CONFIGURATION_CHANGED/);
});

test("failed SDK load permits only an explicit safe reload; malformed inputs do not append scripts", async () => {
  const browser = fakeBrowser(), load = createDigitalPaypalSdkLoader();
  await assert.rejects(load(clientId, "invalid", browser.doc, browser.win), /NONCE/);
  await assert.rejects(load("<script>", nonce, browser.doc, browser.win), /CONFIGURATION/);
  assert.equal(browser.scripts.length, 0);
  const failed = load(clientId, nonce, browser.doc, browser.win), failure = assert.rejects(failed, /UNAVAILABLE/);
  browser.scripts[0].onerror!();
  await failure;
  assert.equal(browser.scripts[0].removed, true);
  const retried = load(clientId, nonce, browser.doc, browser.win);
  browser.scripts[1].onload!();
  assert.equal(await retried, browser.sdk);
});

test("a current document nonce is mandatory, rather than trusting a future client-navigation RSC nonce", () => {
  assert.equal(digitalPaypalDocumentNonce({ querySelector: () => ({ nonce }) } as unknown as Document), nonce);
  assert.throws(() => digitalPaypalDocumentNonce({ querySelector: () => null } as unknown as Document), /RELOAD_REQUIRED/);
});

test("official Buttons recheck readiness, deduplicate creation/capture callbacks and bind the server Order ID", async () => {
  let ready = false, created = 0, approved = 0, cancelled = 0, errors = 0;
  const options: DigitalPaypalButtonOptions = digitalPaypalButtonOptions({ ready: () => ready,
    createOrder: async () => { created++; return order; }, onApprove: async value => { assert.deepEqual(value, order); approved++; },
    onCancel: value => { assert.deepEqual(value, order); cancelled++; }, onError: () => { errors++; } });
  await assert.rejects(options.createOrder(), /NOT_READY/);
  assert.equal(created, 0);
  ready = true;
  assert.deepEqual(await Promise.all([options.createOrder(), options.createOrder()]), [order.providerOrderId, order.providerOrderId]);
  assert.equal(created, 1);
  await assert.rejects(options.onApprove({ orderID: "ANOTHERORDER123" }), /MISMATCH/);
  assert.equal(approved, 0);
  await Promise.all([options.onApprove({ orderID: order.providerOrderId }), options.onApprove({ orderID: order.providerOrderId })]);
  assert.equal(approved, 1);
  options.onCancel(); options.onError();
  assert.equal(cancelled, 0); assert.equal(errors, 0);
  assert.equal(options.fundingSource, "paypal");
});

// Local callback simulations only: these tests do not establish an authentic
// PayPal popup return, SDK delivery or a provider-side capture.
test("PayPal cancellation and errors before approval retain the existing safe follow-up", async () => {
  const cancelled: Array<typeof order | null> = [];
  let errors = 0, approved = 0;
  const options = digitalPaypalButtonOptions({ ready: () => true,
    createOrder: async () => order, onApprove: async () => { approved++; },
    onCancel: value => { cancelled.push(value); }, onError: () => { errors++; } });
  options.onCancel(); options.onError();
  assert.deepEqual(cancelled, [null]); assert.equal(errors, 1);
  await options.createOrder();
  options.onCancel();
  assert.deepEqual(cancelled, [null, order]); assert.equal(approved, 0);
});

test("a deferred PayPal approval survives late cancel/error callbacks and concurrent approvals remain unique", async () => {
  let finish!: () => void;
  let approved = 0, cancelled = 0, errors = 0;
  const options = digitalPaypalButtonOptions({ ready: () => true, createOrder: async () => order,
    onApprove: async () => { approved++; await new Promise<void>(resolve => { finish = resolve; }); },
    onCancel: () => { cancelled++; }, onError: () => { errors++; } });
  await options.createOrder();
  const first = options.onApprove({ orderID: order.providerOrderId });
  const duplicate = options.onApprove({ orderID: order.providerOrderId });
  await Promise.resolve();
  options.onCancel(); options.onError();
  // Resolve before asserting so a failing regression leaves no pending work.
  finish();
  await Promise.all([first, duplicate]);
  options.onCancel(); options.onError();
  assert.deepEqual({ approved, cancelled, errors }, { approved: 1, cancelled: 0, errors: 0 });
});

test("an ambiguous rejected PayPal approval stays cached without another capture intent or misleading cancellation", async () => {
  const failure = new TypeError("synthetic approval response lost");
  let approved = 0, cancelled = 0, errors = 0;
  const options = digitalPaypalButtonOptions({ ready: () => true, createOrder: async () => order,
    onApprove: async () => { approved++; throw failure; },
    onCancel: () => { cancelled++; }, onError: () => { errors++; } });
  await options.createOrder();
  const results = await Promise.allSettled([
    options.onApprove({ orderID: order.providerOrderId }), options.onApprove({ orderID: order.providerOrderId }),
  ]);
  assert.ok(results.every(result => result.status === "rejected" && result.reason === failure));
  await assert.rejects(options.onApprove({ orderID: order.providerOrderId }), error => error === failure);
  options.onCancel(); options.onError();
  assert.deepEqual({ approved, cancelled, errors }, { approved: 1, cancelled: 0, errors: 0 });
});

test("a synchronous PayPal approval callback failure is latched before duplicate callbacks", async () => {
  const failure = new Error("synthetic synchronous approval failure");
  let approved = 0;
  const options = digitalPaypalButtonOptions({ ready: () => true, createOrder: async () => order,
    onApprove: () => { approved++; throw failure; }, onCancel: () => {}, onError: () => {} });
  await options.createOrder();
  const results = await Promise.allSettled([
    options.onApprove({ orderID: order.providerOrderId }), options.onApprove({ orderID: order.providerOrderId }),
  ]);
  assert.ok(results.every(result => result.status === "rejected" && result.reason === failure));
  await assert.rejects(options.onApprove({ orderID: order.providerOrderId }), error => error === failure);
  assert.equal(approved, 1);
});

test("a PayPal instance disposed between approval scheduling and invocation cannot start capture intent", async () => {
  let active = true, approved = 0, cancelled = 0, errors = 0;
  const options = digitalPaypalButtonOptions({ active: () => active, ready: () => true,
    createOrder: async () => order, onApprove: async () => { approved++; },
    onCancel: () => { cancelled++; }, onError: () => { errors++; } });
  await options.createOrder();
  const scheduled = options.onApprove({ orderID: order.providerOrderId });
  active = false;
  options.onCancel(); options.onError();
  await scheduled;
  assert.deepEqual({ approved, cancelled, errors }, { approved: 0, cancelled: 0, errors: 0 });
});

test("missing, premature or mismatched PayPal approval identifiers cannot start capture intent", async () => {
  let approved = 0;
  const options = digitalPaypalButtonOptions({ ready: () => true, createOrder: async () => order,
    onApprove: async () => { approved++; }, onCancel: () => {}, onError: () => {} });
  await assert.rejects(options.onApprove({ orderID: order.providerOrderId }), /PAYPAL_ORDER_MISMATCH/);
  await options.createOrder();
  for (const data of [{}, { orderID: "" }, { orderID: "ANOTHERORDER123" }]) {
    await assert.rejects(options.onApprove(data), /PAYPAL_ORDER_MISMATCH/);
  }
  assert.equal(approved, 0);
  await options.onApprove({ orderID: order.providerOrderId });
  assert.equal(approved, 1);
});

test("SDK component cannot grant acquisitions, capture in-browser or load before prerequisites", async () => {
  const source = await readFile(new URL("../../components/digital-paypal-buttons.tsx", import.meta.url), "utf8");
  assert.ok(source.indexOf("if (!props.ready || !props.clientId") < source.indexOf("loadDigitalPaypalSdk("));
  assert.match(source, /sdk.Buttons\(digitalPaypalButtonOptions/);
  assert.match(source, /buttons.isEligible\(\)/);
  assert.match(source, /buttons.render\(target\)/);
  assert.doesNotMatch(source, /actions\.order\.capture|actions\.order\.create|entitlement|localStorage|sessionStorage|console\./);
  assert.ok(source.includes("Réessayer le chargement PayPal"));
  assert.equal(new URL(digitalPaypalSdkUrl(clientId)).searchParams.has("client-secret"), false);
});
test("a temporarily busy Stripe card does not poison a later legitimate PayPal creation or duplicate callback",async()=>{
  let canStart=false,created=0;
  const options=digitalPaypalButtonOptions({ready:()=>true,canStart:()=>canStart,createOrder:async()=>{created++;return order;},onApprove:async()=>{},onCancel:()=>{},onError:()=>{}});
  await assert.rejects(options.createOrder(),/CHECKOUT_BUSY/);
  assert.equal(created,0);
  canStart=true;
  assert.equal(await options.createOrder(),order.providerOrderId);
  canStart=false;
  assert.equal(await options.createOrder(),order.providerOrderId);
  assert.equal(created,1);
});

test("SDK Order ID comes only from the authenticated buyer's persisted OPEN PayPal attempt, not a checkout URL", async t => {
  t.mock.property(process, "env", { ...process.env, ...sandbox });
  const { prisma } = await import("@/lib/prisma");
  const { getDigitalOrderStatus } = await import("@/lib/digital/commerce");
  let attempt = { provider: "PAYPAL", status: "OPEN", providerReference: order.providerOrderId, checkoutUrl: "https://www.sandbox.paypal.com/checkoutnow?token=UNTRUSTED_URL_ID" };
  let status = "PENDING", absent = false;
  const userId = "21699050-7940-49af-965d-a803a8035e48";
  const restore = prisma.digitalOrder.findFirst;
  prisma.digitalOrder.findFirst = (async (input: unknown) => {
    assert.deepEqual((input as { where: unknown }).where, { id: order.orderId, userId, mode: "TEST" });
    return absent ? null : { id: order.orderId, status, totalCents: 990, mode: "TEST", attempts: [attempt] };
  }) as unknown as typeof restore;
  try {
    assert.equal((await getDigitalOrderStatus(userId, order.orderId)).providerOrderId, order.providerOrderId);
    for (const patch of [{ provider: "STRIPE" }, { status: "UNKNOWN" }, { status: "PAID" }]) {
      const saved = attempt; attempt = { ...attempt, ...patch };
      assert.equal((await getDigitalOrderStatus(userId, order.orderId)).providerOrderId, null); attempt = saved;
    }
    status = "PAID";
    assert.equal((await getDigitalOrderStatus(userId, order.orderId)).providerOrderId, null);
    absent = true;
    await assert.rejects(getDigitalOrderStatus(userId, order.orderId), { code: "NOT_FOUND" });
  } finally { prisma.digitalOrder.findFirst = restore; }
});
