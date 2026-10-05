export function financialEventDetailPath(id: string) {
  return `/admin/evenements-financiers/${encodeURIComponent(id)}`;
}

export type CheckoutReviewEvidence = {
  sessionId: string; livemode: boolean; status: string | null;
  paymentStatus: string; paymentIntentId: string | null;
  amountCents: number | null; currency: string | null;
  contributionId: string | null; purpose: string | null; expectedOrder: boolean;
};
export type FinancialReviewSnapshot = {
  provider: string; type: string; objectId: string | null; livemode: boolean;
  outcome: string; paymentId: string | null; refundAttemptId: string | null;
  incidentId: string | null; reviewed: boolean; matchingPayments: number;
  support: { id: string; provider: string; providerReference: string | null;
    mode: string; status: string; amountCents: number; currency: string;
    paymentReference: string | null; refundReference: string | null } | null;
};

/** NO is issued only for a bound, expired, unpaid session with no PaymentIntent.
 * An unrelated orphan is not sufficient proof that no order is expected. */
export function classifyFinancialReview(row: FinancialReviewSnapshot, proof: CheckoutReviewEvidence | null) {
  const bound = !!proof && row.provider === "STRIPE" && proof.sessionId === row.objectId
    && proof.livemode === row.livemode;
  const captured = bound && proof.paymentStatus === "paid" ? "YES"
    : bound && proof.status === "expired" && proof.paymentStatus === "unpaid" && !proof.paymentIntentId ? "NO" : "UNKNOWN";
  const support = row.support;
  const noOrderExpected = bound && proof.purpose === "SUPPORT_LNX_BEATS" && !!support
    && proof.contributionId === support.id && support.provider === "STRIPE"
    && support.providerReference === proof.sessionId && support.mode === (row.livemode ? "LIVE" : "TEST")
    && support.amountCents === proof.amountCents && support.currency.toLowerCase() === proof.currency
    && Number.isSafeInteger(proof.amountCents) && (proof.amountCents ?? 0) > 0
    && !proof.expectedOrder;
  const eligible = !row.reviewed && row.outcome === "REQUIRES_REVIEW"
    && row.type === "checkout.session.expired" && captured === "NO" && noOrderExpected
    && !row.paymentId && !row.refundAttemptId && !row.incidentId && row.matchingPayments === 0
    && support?.status === "FAILED" && !support.paymentReference && !support.refundReference;
  return { captured, eligible, noOrderExpected,
    reason: row.reviewed ? "Classement technique audité ; reçu prestataire conservé."
      : eligible ? "Checkout de soutien expiré sans paiement ; aucune commande n’est attendue."
        : captured === "YES" ? "Paiement capturé : intervention financière requise, classement interdit."
          : "Preuve insuffisante ou obligation possible : conserver la revue technique.",
    risk: eligible || row.reviewed ? "Aucune obligation démontrée lors de la revue" : "Revue requise",
  } as const;
}
