// Client-safe validation only; randomness is generated exclusively in the proxy.
export const CSP_NONCE_HEADER = "x-lnx-csp-nonce";
export const isScriptNonce = (value: string | null | undefined): value is string =>
  typeof value === "string" && /^[A-Za-z0-9+/]{43}=$/.test(value);
