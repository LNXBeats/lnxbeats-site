/** Structured same-origin API refusal. Codes are control data, not customer copy.
 * Network failures or unreadable responses deliberately remain ordinary errors. */
export class DigitalRequestError extends Error {
  constructor(message: string, readonly status: number, readonly code: string | null) {
    super(message);
    this.name = "DigitalRequestError";
  }
}

/** These exact refusals occur before checkout can engage a provider. This is not
 * an inference from any 4xx/5xx response or a provider/network error. A retry must
 * still be explicit and keep the same server idempotency key. */
export function digitalCheckoutPreflightRefused(error: unknown) {
  if (!(error instanceof DigitalRequestError)) return false;
  const statuses: Record<string, number> = {
    AUTH_REQUIRED: 401,
    ORIGIN_REFUSED: 403,
    RATE_LIMITED: 429,
    INVALID_BODY: 400,
    INVALID_CHECKOUT: 400,
    NEW_DIGITAL_PAYMENTS_CLOSED: 503,
  };
  return error.code !== null && Object.prototype.hasOwnProperty.call(statuses, error.code)
    && statuses[error.code] === error.status;
}
