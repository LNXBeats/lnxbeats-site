import { DigitalError } from "./domain";

export const DIGITAL_CHECKOUT_CONSENT_PRESENTATION = "DCN_TWO_CHECKBOXES_20261016_1" as const;
export const DIGITAL_CHECKOUT_TERMS_LABEL = "J’accepte les CGV numériques.";
export const DIGITAL_CHECKOUT_IMMEDIATE_DELIVERY_LABEL = "Je demande la fourniture immédiate des fichiers, avant la fin des 14 jours, et je reconnais perdre mon droit de rétractation lorsque les conditions légales sont réunies.";
export const DIGITAL_CHECKOUT_IMMEDIATE_CONSENT_TEXT = DIGITAL_CHECKOUT_IMMEDIATE_DELIVERY_LABEL;
export type DigitalCheckoutConsentPresentation = {
  policy: typeof DIGITAL_CHECKOUT_CONSENT_PRESENTATION; termsLabel: typeof DIGITAL_CHECKOUT_TERMS_LABEL;
  immediateDeliveryLabel: typeof DIGITAL_CHECKOUT_IMMEDIATE_DELIVERY_LABEL;
  termsAccepted: true; immediateSupplyRequested: true; withdrawalLossAcknowledged: true;
};
export function parseDigitalCheckoutConsentPresentation(value: unknown) {
  if (value === undefined) return undefined;
  if (value !== DIGITAL_CHECKOUT_CONSENT_PRESENTATION) throw new DigitalError("INVALID_CHECKOUT", 400);
  return DIGITAL_CHECKOUT_CONSENT_PRESENTATION;
}
/** Presentation evidence supplements, never replaces, the three independently
 * checked consent facts and immutable contractual consent texts.
 */
export function digitalCheckoutConsentPresentation(value: unknown): DigitalCheckoutConsentPresentation | undefined {
  const policy = parseDigitalCheckoutConsentPresentation(value);
  return policy ? { policy, termsLabel: DIGITAL_CHECKOUT_TERMS_LABEL, immediateDeliveryLabel: DIGITAL_CHECKOUT_IMMEDIATE_DELIVERY_LABEL,
    termsAccepted: true, immediateSupplyRequested: true, withdrawalLossAcknowledged: true } : undefined;
}
export function validDigitalCheckoutConsentPresentation(value: DigitalCheckoutConsentPresentation) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  try { const exact = digitalCheckoutConsentPresentation(value.policy); return !!exact
    && Object.keys(value).length === Object.keys(exact).length && Object.entries(exact).every(([k, v]) => value[k as keyof typeof value] === v); }
  catch { return false; }
}
export function assertDigitalCheckoutConsentRetry(snapshot: unknown, requested: unknown) {
  const policy = parseDigitalCheckoutConsentPresentation(requested);
  const saved = snapshot as { checkoutConsentPresentation?: DigitalCheckoutConsentPresentation } | null;
  if (saved?.checkoutConsentPresentation?.policy !== policy) throw new DigitalError("IDEMPOTENCY_CONFLICT", 409);
}
