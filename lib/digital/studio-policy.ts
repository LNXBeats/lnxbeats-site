import { createHash } from "node:crypto";
import { assertDigitalUuid, DigitalError } from "./domain";
import { digitalRuntimeMode, type DigitalEnvironment } from "./runtime-policy";

export const STUDIO_POLICY = "LNX_STUDIO_V1";
/** Dedicated owner-approved capability. Absent flags keep preparation closed;
 * this does not enable sales or approve a master, rights, or an excerpt. */
export const STUDIO_PRODUCTION_CONFIRM = "lnx-studio-v1-production-approved";
export const STUDIO_ROLES = ["ORIGINAL", "MP3", "WAV_CD", "WAV_24", "PREVIEW", "AUDITION_WAV_CD", "AUDITION_WAV_24"] as const;
export type StudioRole = typeof STUDIO_ROLES[number];
export function studioEnabled(env: DigitalEnvironment = process.env) {
  if (env.LNX_STUDIO_ENABLED !== "true") return false;
  const mode = digitalRuntimeMode(env);
  if (mode === "LIVE") return env.LNX_STUDIO_RELEASE_CONFIRM === STUDIO_PRODUCTION_CONFIRM;
  return mode === "TEST" && env.NODE_ENV !== "production"
    && !/production/i.test(env.RAILWAY_ENVIRONMENT_NAME ?? "");
}
export function requireStudioEnvironment() { if (!studioEnabled()) throw new DigitalError("STUDIO_DISABLED", 403); }
/** Suspending new preparations must never revoke previously acquired formats.
 * Runtime validity is still mandatory; ownership and exact-version rights are
 * independently checked by the customer read/download service. */
export function studioAcquiredAccessEnabled(env: DigitalEnvironment = process.env) {
  return digitalRuntimeMode(env) !== null;
}
export function requireStudioAcquiredAccess(env: DigitalEnvironment = process.env) {
  if (!studioAcquiredAccessEnabled(env)) throw new DigitalError("DIGITAL_CLOSED", 503);
}
function canonical(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]));
  return value;
}
export function studioHash(value: unknown) { return createHash("sha256").update(JSON.stringify(canonical(value))).digest("hex"); }
export function studioBinding(job: { id: string; trackId: string; uploadId: string | null; attempt: number; sourceAssetId: string | null; sourceSha256: string | null; title: string; album: string | null; metadata: unknown; report: unknown },
  artifacts: ReadonlyArray<{ role: string; assetId: string; asset: { checksumSha256: string | null; sizeBytes: bigint | number; durationMs: number | null; mimeType: string }; metadataVerified: boolean }>) {
  return studioHash({ policy: STUDIO_POLICY, jobId: job.id, trackId: job.trackId, uploadId: job.uploadId, attempt: job.attempt,
    sourceAssetId: job.sourceAssetId, sourceSha256: job.sourceSha256, title: job.title, album: job.album, metadata: job.metadata, reportHash: studioHash(job.report),
    artifacts: [...artifacts].sort((a, b) => a.role.localeCompare(b.role)).map(item => ({ role: item.role, assetId: item.assetId, sha256: item.asset.checksumSha256,
      sizeBytes: String(item.asset.sizeBytes), durationMs: item.asset.durationMs, mimeType: item.asset.mimeType, metadataVerified: item.metadataVerified })) });
}
export function studioMutation(raw: Record<string, unknown>) {
  if (Object.keys(raw).some(key => !["action", "jobId", "expectedBinding", "expectedCurrentBinding", "confirmReplacement", "confirmExistingPurchases", "humanListened"].includes(key))) throw new DigitalError("INVALID_STUDIO_ACTION");
  assertDigitalUuid(raw.jobId);
  if (!["approve", "reject", "retry", "restore"].includes(String(raw.action)) || typeof raw.expectedBinding !== "string" || !/^[a-f0-9]{64}$/.test(raw.expectedBinding)) throw new DigitalError("INVALID_STUDIO_ACTION");
  if (raw.action === "restore" ? typeof raw.expectedCurrentBinding !== "string" || !/^[a-f0-9]{64}$/.test(raw.expectedCurrentBinding) : raw.expectedCurrentBinding !== undefined) throw new DigitalError("INVALID_STUDIO_ACTION");
  return { action: raw.action as "approve" | "reject" | "retry" | "restore", jobId: raw.jobId, expectedBinding: raw.expectedBinding,
    expectedCurrentBinding: raw.action === "restore" ? raw.expectedCurrentBinding as string : undefined,
    confirmReplacement: raw.confirmReplacement === true, confirmExistingPurchases: raw.confirmExistingPurchases === true, humanListened: raw.humanListened === true };
}
