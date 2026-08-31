export const SHOP_SAV_FIRST_ANALYSIS_BUSINESS_DAYS = 5;
export const SHOP_SAV_EVIDENCE_RETENTION_DAYS = 90;

export function addBusinessDays(value: Date, businessDays: number) {
  if (!Number.isSafeInteger(businessDays) || businessDays < 0) throw new Error("Business-day duration is invalid.");
  const result = new Date(value);
  let remaining = businessDays;
  while (remaining > 0) {
    result.setUTCDate(result.getUTCDate() + 1);
    const day = result.getUTCDay();
    if (day !== 0 && day !== 6) remaining -= 1;
  }
  return result;
}

export function savFirstAnalysisIsOverdue(requestedAt: Date, reviewedAt: Date | null, now = new Date()) {
  return reviewedAt === null && addBusinessDays(requestedAt, SHOP_SAV_FIRST_ANALYSIS_BUSINESS_DAYS).getTime() < now.getTime();
}

export function savEvidencePurgeDueAt(closedAt: Date) {
  return new Date(closedAt.getTime() + SHOP_SAV_EVIDENCE_RETENTION_DAYS * 24 * 60 * 60_000);
}
