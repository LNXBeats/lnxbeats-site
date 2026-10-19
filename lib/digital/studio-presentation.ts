/** Browser-safe presentation only. The Studio service repeats every approval check. */
export const STUDIO_REQUIRED_OUTPUTS = ["MP3", "WAV_CD", "WAV_24"] as const;
export type StudioArtifactRole = "ORIGINAL" | "MP3" | "WAV_CD" | "WAV_24" | "PREVIEW" | "AUDITION_WAV_CD" | "AUDITION_WAV_24";
export type StudioArtifactView = {
  role: StudioArtifactRole; filename: string; mimeType: string; sizeBytes: number; durationMs: number | null;
  sampleRate: number | null; bitDepth: number | null; bitrateKbps: number | null;
  integratedLufs: number | null; truePeakDbtp: number | null; audioUrl: string | null; sha256: string;
  metadataVerified: boolean;
};
export type StudioJobView = {
  id: string; trackId: string; title: string; status: string; phase?: string; errorCode?: string | null;
  binding: string; sourceLossy: boolean; baseMasterId: string | null; approved: boolean;
  decision?: string; attempt?: number; restoreAllowed?: boolean; hasAcquisitions?: boolean;
  restoreCurrent?: { masterId: string; version: number; binding: string; hasAcquisitions: boolean } | null;
  artifacts: StudioArtifactView[]; report: unknown;
};
export type StudioExistingSourceView = {
  masterId: string; expectedVersion: number; sourceAssetId: string; sourceSha256: string; expectedMetadataHash: string;
  title: string; trackId: string;
};
export function studioExistingSourceRequest(source: StudioExistingSourceView) {
  if (![source.masterId, source.sourceAssetId, source.trackId].every(id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    || !Number.isSafeInteger(source.expectedVersion) || source.expectedVersion < 1 || ![source.sourceSha256, source.expectedMetadataHash].every(value => /^[a-f0-9]{64}$/.test(value))) return null;
  return { masterId: source.masterId, expectedVersion: source.expectedVersion, sourceAssetId: source.sourceAssetId,
    sourceSha256: source.sourceSha256, expectedMetadataHash: source.expectedMetadataHash };
}
export function studioPhaseLabel(status: string) {
  return ({ QUEUED: "Importé — en attente", PROCESSING: "Traitement en cours", ANALYZING: "Analyse en cours", MASTERING: "Mastering adaptatif en cours", CONVERTING: "Conversion en cours", VERIFYING: "Vérification en cours", READY: "Traitement terminé — en attente d’écoute", FAILED: "Erreur — fichier non validé", ERROR: "Erreur — fichier non validé", REJECTED: "Refusé — versions conservées", APPROVED: "Fichiers approuvés — publication distincte" } as Record<string, string>)[status] ?? "État technique à vérifier";
}
export function studioJobPending(status: string) { return ["QUEUED", "PROCESSING", "ANALYZING", "MASTERING", "CONVERTING", "VERIFYING"].includes(status); }
export function studioPrivateAudioUrl(value: unknown) {
  if (typeof value !== "string" || /[\\\r\n\u0000]/.test(value)) return null;
  // No object-storage URL, protocol-relative URL or path traversal may reach a player.
  return /^\/api\/admin\/digital\/studio\/[0-9a-f-]{36}\/audio\/(?:ORIGINAL|MP3|WAV_CD|WAV_24|PREVIEW|AUDITION_WAV_CD|AUDITION_WAV_24)$/i.test(value) ? value : null;
}
export function studioApprovalAvailable(job: Pick<StudioJobView, "status" | "binding" | "approved" | "artifacts" | "decision">) {
  return job.status === "READY" && job.decision !== "REJECTED" && !job.approved && /^[a-f0-9]{64}$/.test(job.binding) && STUDIO_REQUIRED_OUTPUTS.every(role => job.artifacts.some(a => a.role === role && a.metadataVerified && /^[a-f0-9]{64}$/.test(a.sha256)));
}
export function studioReplacementConfirmed(job: Pick<StudioJobView, "baseMasterId" | "hasAcquisitions">, replacement: boolean, purchases: boolean) {
  return (!job.baseMasterId || replacement) && (job.hasAcquisitions !== true || purchases);
}
/** A return prepares a private candidate only. It never reuses a listening decision. */
export function studioRestoreRequest(job: Pick<StudioJobView, "id" | "status" | "binding" | "approved" | "decision" | "restoreAllowed" | "restoreCurrent">, confirmed: boolean, purchases: boolean) {
  const current = job.restoreCurrent;
  if (!job.approved || job.decision === "REJECTED" || job.status !== "READY" || job.restoreAllowed !== true || !current || !confirmed
    || current.hasAcquisitions && !purchases || !Number.isSafeInteger(current.version) || current.version < 1
    || ![job.id, current.masterId].every(id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))
    || ![job.binding, current.binding].every(value => /^[a-f0-9]{64}$/.test(value))) return null;
  return { action: "restore" as const, jobId: job.id, expectedBinding: job.binding, expectedCurrentBinding: current.binding,
    confirmReplacement: true, confirmExistingPurchases: purchases, humanListened: false };
}
/** Attenuate only: source/output are compared at the lower measured integrated loudness. */
export function studioAuditionGains(originalLufs: number | null, finalLufs: number | null) {
  if (originalLufs === null || finalLufs === null || !Number.isFinite(originalLufs) || !Number.isFinite(finalLufs) || originalLufs > 0 || finalLufs > 0 || originalLufs < -120 || finalLufs < -120) return null;
  const target = Math.min(originalLufs, finalLufs);
  return { original: Math.pow(10, (target - originalLufs) / 20), final: Math.pow(10, (target - finalLufs) / 20) };
}
export function studioAuditionTime(requested: number, duration: number) {
  return Number.isFinite(requested) && Number.isFinite(duration) && duration > 0 ? Math.min(Math.max(requested, 0), Math.max(0, duration - 0.01)) : 0;
}
export function studioFormatLabel(artifact: Pick<StudioArtifactView, "role" | "bitrateKbps" | "sampleRate">) {
  if (artifact.role === "ORIGINAL") return "Original intact";
  if (artifact.role === "MP3") return artifact.bitrateKbps ? `MP3 — ${artifact.bitrateKbps} kbit/s réels` : "MP3 — débit à vérifier";
  if (artifact.role === "WAV_CD") return "WAV — Qualité CD · 16 bits / 44,1 kHz";
  if (artifact.role === "WAV_24") return `WAV — Master 24 bits${artifact.sampleRate ? ` / ${artifact.sampleRate / 1000} kHz natifs` : ""}`;
  return "Écoute encodée privée — contrôle technique sur le WAV véritable";
}
export function studioClientDownloadUrl(jobId: string, role: string, lineId: string, masterId: string) {
  if (![jobId, lineId, masterId].every(id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) || !(STUDIO_REQUIRED_OUTPUTS as readonly string[]).includes(role)) return null;
  return `/api/digital/studio/${jobId}/${role}?lineId=${encodeURIComponent(lineId)}&masterId=${encodeURIComponent(masterId)}`;
}
