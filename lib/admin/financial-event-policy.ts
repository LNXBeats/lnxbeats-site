export function financialEventDetailPath(id: string) {
  return `/admin/evenements-financiers/${encodeURIComponent(id)}`;
}

export type CheckoutReviewEvidence = {
  sessionId: string; livemode: boolean; status: string | null;
  paymentStatus: string; paymentIntentId: string | null;
  amountCents: number | null; currency: string | null;
  contributionId: string | null; purpose: string | null; expectedOrder: boolean;
  clientReferenceId?: string | null;
  verifiedAt?: number;
  payment?: { id: string; livemode: boolean; status: string; amountReceived: number; currency: string;
    contributionId: string | null; purpose: string | null; captured: boolean; refunded: boolean; amountRefunded: number } | null;
};
export type FinancialReviewSnapshot = {
  provider: string; type: string; objectId: string | null; livemode: boolean;
  outcome: string; paymentId: string | null; refundAttemptId: string | null;
  incidentId: string | null; reviewed: boolean; matchingPayments: number;
  supportCandidates?: number;
  support: { id: string; provider: string; providerReference: string | null;
    mode: string; status: string; amountCents: number; currency: string;
    paymentReference: string | null; refundReference: string | null } | null;
};

/** Independent of Order reconciliation. Missing capture/refund evidence is NOT a match. */
export function supportPaymentReconciled(row: FinancialReviewSnapshot, proof: CheckoutReviewEvidence | null) {
  const s = row.support, p = proof?.payment;
  return !!proof && !!s && !!p && row.provider === "STRIPE"
    && typeof proof.verifiedAt === "number" && Number.isFinite(proof.verifiedAt)
    && Date.now() - proof.verifiedAt >= 0 && Date.now() - proof.verifiedAt <= 30_000
    && ["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(row.type)
    && proof.sessionId === row.objectId && proof.livemode === row.livemode
    && proof.status === "complete" && proof.paymentStatus === "paid"
    && proof.purpose === "SUPPORT_LNX_BEATS" && proof.contributionId === s.id && proof.clientReferenceId === s.id
    && !proof.expectedOrder && row.supportCandidates === 1 && row.matchingPayments === 0
    && !row.paymentId && !row.refundAttemptId && !row.incidentId
    && s.provider === "STRIPE" && s.mode === (row.livemode ? "LIVE" : "TEST") && s.status === "SUCCEEDED"
    && Number.isSafeInteger(s.amountCents) && s.amountCents > 0
    && s.amountCents === proof.amountCents && s.currency === "EUR" && proof.currency === "eur"
    && s.providerReference === proof.sessionId && !!s.paymentReference && s.paymentReference === proof.paymentIntentId
    && p.id === proof.paymentIntentId && p.livemode === row.livemode && p.status === "succeeded"
    && p.contributionId === s.id && p.purpose === "SUPPORT_LNX_BEATS"
    && p.amountReceived === s.amountCents && p.currency === "eur" && p.captured
    && !p.refunded && p.amountRefunded === 0 && !s.refundReference;
}

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
  const reconciled = supportPaymentReconciled(row, proof);
  const reconciliationEligible = !row.reviewed && row.outcome === "REQUIRES_REVIEW" && reconciled;
  return { captured, eligible, reconciliationEligible, reconciled, noOrderExpected,
    reason: row.reviewed ? "Classement technique audité ; reçu prestataire conservé."
      : reconciled ? "SUPPORT_PAYMENT_RECONCILED : paiement concordant avec une contribution Soutien confirmée."
        : eligible ? "Checkout de soutien expiré sans paiement ; aucune commande n’est attendue."
        : captured === "YES" ? "Paiement capturé : intervention financière requise, classement interdit."
          : "Preuve insuffisante ou obligation possible : conserver la revue technique.",
    risk: reconciled ? "Soutien rapproché — aucune commande attendue" : eligible || row.reviewed ? "Aucune obligation démontrée lors de la revue" : "Revue requise",
  } as const;
}
