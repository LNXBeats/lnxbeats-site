const PAYPAL_APPROVAL_ORIGINS = new Set([
  "https://www.paypal.com",
  "https://www.sandbox.paypal.com",
]);

export function isAllowedPaypalApprovalRedirect(value: string, applicationOrigin: string) {
  try {
    const url = new URL(value);
    const currentOrigin = new URL(applicationOrigin);
    if (url.protocol !== "https:" || url.username || url.password) return false;

    return PAYPAL_APPROVAL_ORIGINS.has(url.origin)
      || (currentOrigin.protocol === "https:" && url.origin === currentOrigin.origin);
  } catch {
    return false;
  }
}
