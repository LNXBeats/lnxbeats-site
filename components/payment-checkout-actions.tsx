import Image from "next/image";
import { PaypalCheckoutAction } from "@/components/paypal-checkout-action";
import { StripeCheckoutAction } from "@/components/stripe-checkout-action";
import type { PaymentProviderAvailability } from "@/lib/payments/availability";
import {
  checkoutPaymentChoicePresentation,
  enabledCheckoutPaymentProviders,
} from "@/lib/payments/presentation";

function CardPaymentIcon() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect x="3.5" y="6.5" width="25" height="19" rx="3" />
      <path d="M3.5 12.5h25M8 20.5h7" />
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
                {provider === "stripe" ? (
                  <span className="payment-methods__choice-icon"><CardPaymentIcon /></span>
                ) : (
                  <Image
                    className="payment-methods__paypal-logo"
                    src="/brands/paypal-white.svg"
                    width={101}
                    height={32}
                    alt=""
                    aria-hidden="true"
                    loading="eager"
                  />
                )}
                <span className="payment-methods__choice-title">
                  {provider === "stripe" ? <strong id={headingId}>{presentation.title}</strong> : null}
                  <span id={provider === "paypal" ? headingId : undefined}>{presentation.providerLabel}</span>
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
