import { isScriptNonce } from "../security/csp-nonce";

export type DigitalPaypalCreatedOrder = Readonly<{ orderId: string; providerOrderId: string }>;
export type DigitalPaypalCallbacks = {
  active?: () => boolean;
  ready: () => boolean;
  canStart?: () => boolean;
  createOrder: () => Promise<DigitalPaypalCreatedOrder>;
  onApprove: (order: DigitalPaypalCreatedOrder) => Promise<void>;
  onCancel: (order: DigitalPaypalCreatedOrder | null) => void;
  onError: () => void;
};
export type DigitalPaypalButtonOptions = {
  fundingSource: string;
  style: { layout: "vertical"; color: "gold"; shape: "rect"; label: "pay"; height: number; tagline: false };
  createOrder: () => Promise<string>;
  onApprove: (data: { orderID?: string }) => Promise<void>;
  onCancel: () => void;
  onError: () => void;
};
export type DigitalPaypalSdk = { FUNDING: { PAYPAL: string }; Buttons: (options: DigitalPaypalButtonOptions) => {
  isEligible: () => boolean; render: (container: HTMLElement) => Promise<void>; close: () => Promise<void>;
} };
export type DigitalPaypalButtonStatus = "loading" | "ready" | "error" | "ineligible" | "preflight";
/** A late SDK render cannot hide a refusal that already needs a human retry. */
export function digitalPaypalRenderStatus(current: DigitalPaypalButtonStatus, outcome: "ready" | "error") {
  return current === "preflight" ? current : outcome;
}
type PaypalWindow = Window & { lnxDigitalPaypal?: DigitalPaypalSdk };

const SDK_ID = "lnx-digital-paypal-sdk";
export function digitalPaypalSdkUrl(clientId: string) {
  if (!/^[A-Za-z0-9_-]{20,256}$/.test(clientId)) throw new Error("PAYPAL_SDK_CONFIGURATION");
  const url = new URL("https://www.paypal.com/sdk/js");
  url.search = new URLSearchParams({ "client-id": clientId, components: "buttons", currency: "EUR", intent: "capture", commit: "true", locale: "fr_FR", vault: "false" }).toString();
  return url.toString();
}

/** Read the *current HTML document* nonce, never a different RSC response nonce.
 * The checkout entry must be a document navigation so its scoped CSP applies. */
export function digitalPaypalDocumentNonce(doc: Document) {
  const nonce = doc.querySelector<HTMLScriptElement>('script[nonce][src^="/_next/"]')?.nonce;
  if (!isScriptNonce(nonce)) throw new Error("PAYPAL_DOCUMENT_RELOAD_REQUIRED");
  return nonce;
}

/** One SDK per document/client configuration. A failed script can be retried by
 * the buyer, but neither load nor retry ever creates a PayPal Order. */
export function createDigitalPaypalSdkLoader() {
  const documents = new WeakMap<Document, { key: string; promise: Promise<DigitalPaypalSdk> }>();
  return (clientId: string, nonce: string, doc: Document = document, win: PaypalWindow = window): Promise<DigitalPaypalSdk> => {
    if (!isScriptNonce(nonce)) return Promise.reject(new Error("PAYPAL_SDK_NONCE"));
    let src: string;
    try { src = digitalPaypalSdkUrl(clientId); } catch (error) { return Promise.reject(error); }
    const key = `${src}\n${nonce}`, active = documents.get(doc);
    if (active) return active.key === key ? active.promise : Promise.reject(new Error("PAYPAL_SDK_CONFIGURATION_CHANGED"));
    if (doc.getElementById(SDK_ID)) return Promise.reject(new Error("PAYPAL_SDK_CONFIGURATION_CHANGED"));
    const script = doc.createElement("script");
    script.id = SDK_ID; script.src = src; script.async = true; script.nonce = nonce;
    script.setAttribute("data-csp-nonce", nonce);
    script.setAttribute("data-namespace", "lnxDigitalPaypal");
    script.setAttribute("data-page-type", "checkout");
    const promise = new Promise<DigitalPaypalSdk>((resolve, reject) => {
      let settled = false;
      const fail = () => {
        if (settled) return;
        settled = true; clearTimeout(timer); script.onload = null; script.onerror = null;
        script.remove(); documents.delete(doc);
        reject(new Error("PAYPAL_SDK_UNAVAILABLE"));
      };
      const timer = setTimeout(fail, 20_000);
      script.onerror = fail;
      script.onload = () => {
        const sdk = win.lnxDigitalPaypal;
        if (!sdk || typeof sdk.Buttons !== "function" || sdk.FUNDING?.PAYPAL !== "paypal") return fail();
        if (settled) return;
        settled = true; clearTimeout(timer); script.onload = null; script.onerror = null; resolve(sdk);
      };
      doc.head.append(script);
    });
    documents.set(doc, { key, promise });
    return promise;
  };
}
export const loadDigitalPaypalSdk = createDigitalPaypalSdkLoader();

/** SDK callbacks never capture client-side or grant rights. The existing
 * authenticated server capture/reconciliation is supplied by the checkout. */
export function digitalPaypalButtonOptions(callbacks: DigitalPaypalCallbacks): DigitalPaypalButtonOptions {
  let created: DigitalPaypalCreatedOrder | null = null;
  let creating: Promise<DigitalPaypalCreatedOrder> | null = null;
  let approving: Promise<void> | null = null;
  return {
    fundingSource: "paypal",
    style: { layout: "vertical", color: "gold", shape: "rect", label: "pay", height: 48, tagline: false },
    async createOrder() {
      if (callbacks.active?.() === false) throw new Error("PAYPAL_CHECKOUT_CLOSED");
      if (!callbacks.ready()) throw new Error("PAYPAL_CHECKOUT_NOT_READY");
      if (!creating && callbacks.canStart && !callbacks.canStart()) throw new Error("PAYPAL_CHECKOUT_BUSY");
      // The server idempotency key is still authoritative across page reloads.
      creating ??= callbacks.createOrder();
      const order = await creating;
      if (callbacks.active?.() === false) throw new Error("PAYPAL_CHECKOUT_CLOSED");
      if (!/^[A-Za-z0-9]{10,64}$/.test(order.providerOrderId) || !/^[0-9a-f-]{36}$/i.test(order.orderId)) throw new Error("PAYPAL_ORDER_UNAVAILABLE");
      created = order;
      return order.providerOrderId;
    },
    async onApprove(data) {
      if (callbacks.active?.() === false) return;
      if (!created || data.orderID !== created.providerOrderId) throw new Error("PAYPAL_ORDER_MISMATCH");
      // Latch before invoking checkout code: a synchronous throw or a late SDK
      // cancel/error must not unlock an approval whose server result is pending.
      // Keep rejected approvals cached too; recovery is explicit, never recapture.
      const order = created;
      approving ??= Promise.resolve().then(() => {
        if (callbacks.active?.() === false) return;
        return callbacks.onApprove(order);
      });
      await approving;
    },
    onCancel() { if (callbacks.active?.() !== false && !approving) callbacks.onCancel(created); },
    onError() { if (callbacks.active?.() !== false && !approving) callbacks.onError(); },
  };
}
