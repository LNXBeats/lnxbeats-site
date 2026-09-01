import "server-only";

import { createHash } from "node:crypto";

import { finalMusicTermsCandidate } from "@/data/legal";
import { earlyPerformanceConsentWording } from "@/data/order-offer";

export type EarlyPerformanceConsentProof = Readonly<{
  earlyPerformanceConsentVersion: string | null;
  earlyPerformanceConsentHashSha256: string | null;
  earlyPerformanceConsentAcceptedAt: Date | null;
}>;

export function earlyPerformanceConsentSnapshot() {
  return Object.freeze({
    version: finalMusicTermsCandidate.version,
    hashSha256: createHash("sha256").update(earlyPerformanceConsentWording, "utf8").digest("hex"),
  });
}

export function hasCurrentEarlyPerformanceConsent(proof: EarlyPerformanceConsentProof) {
  const expected = earlyPerformanceConsentSnapshot();
  return proof.earlyPerformanceConsentVersion === expected.version
    && proof.earlyPerformanceConsentHashSha256 === expected.hashSha256
    && proof.earlyPerformanceConsentAcceptedAt instanceof Date
    && !Number.isNaN(proof.earlyPerformanceConsentAcceptedAt.getTime());
}

export function resolveEarlyPerformanceConsent(
  proof: EarlyPerformanceConsentProof,
  accepted: unknown,
  acceptedAt: Date,
) {
  if (hasCurrentEarlyPerformanceConsent(proof)) {
    return Object.freeze({ ok: true as const, created: false as const, proof });
  }
  if (accepted !== true || Number.isNaN(acceptedAt.getTime())) {
    return Object.freeze({ ok: false as const, reason: "EARLY_PERFORMANCE_CONSENT_REQUIRED" as const });
  }
  const snapshot = earlyPerformanceConsentSnapshot();
  return Object.freeze({
    ok: true as const,
    created: true as const,
    proof: Object.freeze({
      earlyPerformanceConsentVersion: snapshot.version,
      earlyPerformanceConsentHashSha256: snapshot.hashSha256,
      earlyPerformanceConsentAcceptedAt: new Date(acceptedAt.getTime()),
    }),
  });
}
