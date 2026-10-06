import "server-only";
import Stripe from "stripe";
import { STRIPE_API_VERSION } from "@/lib/payments/config";
import type { CheckoutReviewEvidence } from "@/lib/admin/financial-event-policy";

/** GET only, bounded, independent of checkout kill switches. No provider object
 * or exception is exposed to the UI/logs; account identity is mandatory. */
export async function readFinancialCheckout(sessionId: string, livemode: boolean): Promise<CheckoutReviewEvidence | null> {
  try {
    const mode = livemode ? "live" : "test";
    const key = process.env.STRIPE_SECRET_KEY ?? "";
    const accountId = process.env.SUPPORT_STRIPE_ACCOUNT_ID;
    if (process.env.STRIPE_MODE !== mode || !new RegExp(`^(sk|rk)_${mode}_[a-zA-Z0-9_-]{8,}$`).test(key)
      || !/^acct_[A-Za-z0-9]+$/.test(accountId ?? "") || !/^cs_(live|test)_[A-Za-z0-9]+$/.test(sessionId)) return null;
    const client = new Stripe(key, { apiVersion: STRIPE_API_VERSION, timeout: 10000, maxNetworkRetries: 0 });
    const account = await client.accounts.retrieve(null);
    if (account.id !== accountId) return null;
    const session = await client.checkout.sessions.retrieve(sessionId, { expand: ["payment_intent.latest_charge"] });
    const intent = typeof session.payment_intent === "object" ? session.payment_intent : null;
    const charge = intent && typeof intent.latest_charge === "object" ? intent.latest_charge : null;
    return {
      sessionId: session.id, livemode: session.livemode, status: session.status,
      paymentStatus: session.payment_status,
      paymentIntentId: typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? null,
      amountCents: session.amount_total, currency: session.currency,
      contributionId: session.metadata?.contributionId ?? null, purpose: session.metadata?.purpose ?? null,
      expectedOrder: ["orderId", "shopOrderId", "rightsRequestId", "paymentId"].some(key => !!session.metadata?.[key] || !!intent?.metadata?.[key]),
      clientReferenceId: session.client_reference_id,
      verifiedAt: Date.now(),
      payment: intent && charge && charge.payment_intent === intent.id && charge.amount === session.amount_total
        && charge.currency === session.currency && charge.livemode === livemode ? {
          id: intent.id, livemode: intent.livemode, status: intent.status, amountReceived: intent.amount_received,
          currency: intent.currency, contributionId: intent.metadata?.contributionId ?? null,
          purpose: intent.metadata?.purpose ?? null, captured: charge.captured && charge.paid,
          refunded: charge.refunded, amountRefunded: charge.amount_refunded,
        } : null,
    };
  } catch { return null; }
}
