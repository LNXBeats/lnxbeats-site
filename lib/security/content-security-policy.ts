import { directUploadConnectOrigin, publicMediaOrigin } from "../media/storage/csp";
import { isScriptNonce } from "./csp-nonce";
import { googleCmpConfigured } from "../ads/policy";
import { GOOGLE_CMP_ORIGIN } from "../../data/google-cmp";
import { digitalPaypalSdkOrigins } from "../digital/paypal-sdk-config";
import type { DigitalMode } from "../digital/runtime-policy";
import { ANALYTICS_CONNECT_ORIGINS, allowsAnalyticsPath, resolveAnalyticsConfiguration } from "../analytics/policy";

/** Baseline is byte-for-byte equivalent to the pre-CMP policy without a nonce. */
export function contentSecurityPolicy(env: Record<string, string | undefined>, nonce?: string, options?: { digitalPaypalMode?: DigitalMode; analyticsPathname?: string; googleCmpAllowed?: boolean }) {
  if (nonce !== undefined && !isScriptNonce(nonce)) throw new Error("Invalid CSP nonce");
  const isDevelopment = env.NODE_ENV === "development";
  const directUploadOrigin = directUploadConnectOrigin(env);
  const playbackOrigin = publicMediaOrigin(env);
  const cmp = Boolean(nonce) && options?.googleCmpAllowed !== false && googleCmpConfigured(env);
  const paypal = nonce && options?.digitalPaypalMode ? digitalPaypalSdkOrigins(options.digitalPaypalMode) : null;
  const analytics = Boolean(nonce) && allowsAnalyticsPath(options?.analyticsPathname) && resolveAnalyticsConfiguration(env) !== null;
  const paypalOrigins = paypal ? [...new Set([paypal.sdk, paypal.checkout, paypal.assets])].join(" ") : "";
  const paypalFrames = paypal ? [...new Set([paypal.sdk, paypal.checkout])].join(" ") : "";
  return [
    "default-src 'self'",
    nonce ? "base-uri 'none'" : "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "object-src 'none'",
    nonce ? `script-src 'nonce-${nonce}' 'strict-dynamic'` : `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${playbackOrigin ? ` ${playbackOrigin}` : ""}${paypal ? ` ${paypalOrigins}` : ""}`,
    "font-src 'self' data:",
    `connect-src 'self'${directUploadOrigin ? ` ${directUploadOrigin}` : ""}${cmp ? ` ${GOOGLE_CMP_ORIGIN}` : ""}${paypal ? ` ${paypalOrigins}` : ""}${analytics ? ` ${ANALYTICS_CONNECT_ORIGINS.join(" ")}` : ""}${isDevelopment ? " ws: wss:" : ""}`,
    ...(cmp || paypal ? [`frame-src 'self'${cmp ? ` ${GOOGLE_CMP_ORIGIN}` : ""}${paypal ? ` ${paypalFrames}` : ""}`] : []),
    `media-src 'self' blob:${playbackOrigin ? ` ${playbackOrigin}` : ""}`,
    "manifest-src 'self'",
  ].join("; ");
}
