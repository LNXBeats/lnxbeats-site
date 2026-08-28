import type { PaymentMethod, PaymentStatus } from "@/lib/payments/types";
import { formatEuro } from "@/lib/orders/domain";

export const paymentStatusPresentation: Record<PaymentStatus, string> = {
  CREATED: "Paiement en préparation",
  PENDING: "Paiement en attente de confirmation",
  SUCCEEDED: "Paiement confirmé",
  FAILED: "Paiement échoué",
  CANCELED: "Paiement annulé",
  EXPIRED: "Session de paiement expirée",
  REFUND_PENDING: "Remboursement en cours",
  PARTIALLY_REFUNDED: "Paiement partiellement remboursé",
  REFUNDED: "Paiement remboursé",
  REQUIRES_REVIEW: "Paiement à vérifier",
};

export const paymentMethodPresentation: Record<PaymentMethod, string> = {
  CARD: "Carte",
  PAYPAL: "PayPal",
  WERO: "Wero",
  OTHER: "Autre moyen",
};

export type CheckoutPaymentProvider = "stripe" | "paypal";

export const checkoutPaymentChoicePresentation = {
  stripe: {
    title: "Carte bancaire & Apple Pay",
    providerLabel: "Paiement sécurisé par Stripe",
    details: "Apple Pay est proposé selon l’appareil, le navigateur et sa disponibilité.",
    assurance: "Paiement sécurisé hébergé par Stripe. Aucune donnée de carte n’est saisie sur LNX Studio.",
  },
  paypal: {
    title: "PayPal",
    providerLabel: "Paiement sécurisé par PayPal",
    details: "Compte PayPal ou carte, selon les options proposées par PayPal.",
    assurance: "Paiement sécurisé hébergé par PayPal. Le montant reste calculé par LNX Studio.",
  },
} as const satisfies Record<CheckoutPaymentProvider, {
  title: string;
  providerLabel: string;
  details: string;
  assurance: string;
}>;

export function enabledCheckoutPaymentProviders(
  providers: Readonly<{ stripe: boolean; paypal: boolean }>,
): CheckoutPaymentProvider[] {
  const enabled: CheckoutPaymentProvider[] = [];
  if (providers.stripe) enabled.push("stripe");
  if (providers.paypal) enabled.push("paypal");
  return enabled;
}

export function checkoutPaymentCtaLabel(
  provider: CheckoutPaymentProvider,
  amountCents: number,
  target: "music" | "shop" = "music",
) {
  const amount = formatEuro(amountCents);
  if (target === "shop") return `Payer ${amount} — commande avec obligation de paiement`;
  return provider === "stripe"
    ? `Payer ${amount} en toute sécurité`
    : `Payer ${amount} avec PayPal`;
}
