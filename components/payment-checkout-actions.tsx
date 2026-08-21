import { PaypalCheckoutAction } from "@/components/paypal-checkout-action";
import { StripeCheckoutAction } from "@/components/stripe-checkout-action";
import type { PaymentProviderAvailability } from "@/lib/payments/availability";

export function PaymentCheckoutActions({
  orderNumber,
  amountCents,
  providers,
}: {
  orderNumber: string;
  amountCents: number;
  providers: PaymentProviderAvailability;
}) {
  if (!providers.stripe && !providers.paypal) return null;
  return (
    <section className="payment-methods" aria-labelledby={`payment-methods-${orderNumber}`}>
      <div>
        <p className="auth-panel__label">Moyen de paiement</p>
        <h3 id={`payment-methods-${orderNumber}`}>Choisissez un parcours sécurisé.</h3>
        <p>Une seule confirmation fournisseur peut valider cette commande. Le retour navigateur ne suffit jamais.</p>
      </div>
      <div className="payment-methods__actions">
        {providers.stripe ? (
          <div className="payment-methods__choice">
            <strong>Carte bancaire — Stripe</strong>
            <StripeCheckoutAction orderNumber={orderNumber} amountCents={amountCents} />
          </div>
        ) : null}
        {providers.paypal ? (
          <div className="payment-methods__choice">
            <strong>PayPal</strong>
            <PaypalCheckoutAction orderNumber={orderNumber} amountCents={amountCents} />
          </div>
        ) : null}
      </div>
    </section>
  );
}
