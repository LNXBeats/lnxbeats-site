import { StripeCheckoutAction } from "@/components/stripe-checkout-action";

export function AdminPaymentTestAction({ orderNumber, amountCents }: { orderNumber: string; amountCents: number }) {
  return (
    <div className="admin-payment-test-action">
      <strong>MODE TEST STRIPE</strong>
      <p>Aucun argent réel. Le montant est relu depuis PostgreSQL et ne peut pas être modifié ici.</p>
      <StripeCheckoutAction orderNumber={orderNumber} amountCents={amountCents} compact />
    </div>
  );
}
