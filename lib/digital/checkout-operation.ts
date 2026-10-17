type CheckoutProvider = "STRIPE" | "PAYPAL";

/** Both payment cards share one owner-bound lock. A late SDK callback must not
 * release another provider's in-flight operation. Server idempotency remains
 * authoritative across documents and retries. */
export function createDigitalCheckoutOperationLock() {
  let owner: CheckoutProvider | null = null;
  return {
    claim(provider: CheckoutProvider) {
      if (owner !== null) return false;
      owner = provider;
      return true;
    },
    isOwnedBy(provider: CheckoutProvider) { return owner === provider; },
    release(provider: CheckoutProvider) {
      if (owner !== provider) return false;
      owner = null;
      return true;
    },
  };
}
