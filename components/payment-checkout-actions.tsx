import { PaypalCheckoutAction } from "@/components/paypal-checkout-action";
import { StripeCheckoutAction } from "@/components/stripe-checkout-action";
import type { PaymentProviderAvailability } from "@/lib/payments/availability";
import {
  checkoutPaymentChoicePresentation,
  enabledCheckoutPaymentProviders,
  type CheckoutPaymentProvider,
} from "@/lib/payments/presentation";

function PaymentMethodIcon({ provider }: { provider: CheckoutPaymentProvider }) {
  if (provider === "stripe") {
    return (
      <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
        <rect x="3.5" y="6.5" width="25" height="19" rx="3" />
        <path d="M3.5 12.5h25M8 20.5h7" />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <path d="M5.5 9.5A3.5 3.5 0 0 1 9 6h14.5v20H9a3.5 3.5 0 0 1-3.5-3.5z" />
      <path d="M5.5 11.5h19.75A2.75 2.75 0 0 1 28 14.25v5.5a2.75 2.75 0 0 1-2.75 2.75H18a3.5 3.5 0 0 1 0-7h10M19 19h.01" />
    </svg>
  );
}

export function PaymentCheckoutActions({
  orderNumber,
  amountCents,
  providers,
}: {
  orderNumber: string;
  amountCents: number;
  providers: PaymentProviderAvailability;
}) {
  const enabledProviders = enabledCheckoutPaymentProviders(providers);
  if (enabledProviders.length === 0) return null;

  return (
    <section className="payment-methods" aria-labelledby={`payment-methods-${orderNumber}`}>
      <div>
        <p className="auth-panel__label">Moyen de paiement</p>
        <h3 id={`payment-methods-${orderNumber}`}>Choisissez un parcours sécurisé.</h3>
        <p>Une seule confirmation de paiement peut valider cette commande. Le retour sur le site ne suffit pas.</p>
      </div>
      <div className="payment-methods__actions">
        {enabledProviders.map((provider) => {
          const presentation = checkoutPaymentChoicePresentation[provider];
          const headingId = `payment-method-${provider}-${orderNumber}`;
          return (
            <article
              className={`payment-methods__choice payment-methods__choice--${provider}`}
              data-payment-provider={provider}
              key={provider}
              aria-labelledby={headingId}
            >
              <header className="payment-methods__choice-heading">
                <span className="payment-methods__choice-icon"><PaymentMethodIcon provider={provider} /></span>
                <span className="payment-methods__choice-title">
                  <strong id={headingId}>{presentation.title}</strong>
                  <span>{presentation.providerLabel}</span>
                </span>
              </header>
              <p className="payment-methods__choice-details">{presentation.details}</p>
              {provider === "stripe"
                ? <StripeCheckoutAction orderNumber={orderNumber} amountCents={amountCents} />
                : <PaypalCheckoutAction orderNumber={orderNumber} amountCents={amountCents} />}
            </article>
          );
        })}
      </div>
    </section>
  );
}
