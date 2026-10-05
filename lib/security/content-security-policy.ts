import { directUploadConnectOrigin, publicMediaOrigin } from "../media/storage/csp";
import { isScriptNonce } from "./csp-nonce";
import { googleCmpConfigured } from "../ads/policy";
import { GOOGLE_CMP_ORIGIN } from "../../data/google-cmp";

/** Baseline is byte-for-byte equivalent to the pre-CMP policy without a nonce. */
export function contentSecurityPolicy(env: Record<string, string | undefined>, nonce?: string) {
  if (nonce !== undefined && !isScriptNonce(nonce)) throw new Error("Invalid CSP nonce");
  const isDevelopment = env.NODE_ENV === "development";
  const directUploadOrigin = directUploadConnectOrigin(env);
  const playbackOrigin = publicMediaOrigin(env);
  const cmp = Boolean(nonce) && googleCmpConfigured(env);
  return [
    "default-src 'self'",
    nonce ? "base-uri 'none'" : "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    nonce ? `script-src 'nonce-${nonce}' 'strict-dynamic'` : `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${playbackOrigin ? ` ${playbackOrigin}` : ""}`,
    "font-src 'self' data:",
    `connect-src 'self'${directUploadOrigin ? ` ${directUploadOrigin}` : ""}${cmp ? ` ${GOOGLE_CMP_ORIGIN}` : ""}${isDevelopment ? " ws: wss:" : ""}`,
    ...(cmp ? [`frame-src 'self' ${GOOGLE_CMP_ORIGIN}`] : []),
    `media-src 'self' blob:${playbackOrigin ? ` ${playbackOrigin}` : ""}`,
    "manifest-src 'self'",
  ].join("; ");
}
