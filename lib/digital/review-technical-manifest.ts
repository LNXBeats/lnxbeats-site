/** Private Admin preparation only: never an authorization, entitlement or sale. */
export const PRIVATE_EVIDENCE_MAX_BYTES = 10 * 1024 * 1024;
type ManifestTrack = {
  id: string; title: string; position: number; masterId: string | null; version: number | null;
  durationMs: number | null; previewStartMs: number | null; previewDurationMs: number | null;
  sourceFormat: "WAV" | "MP3" | null; sourceSha256: string | null;
  wavSha256: string | null; mp3Sha256: string | null; previewSha256: string | null; bindingHash: string | null;
};
type ManifestProject = { id: string; slug: string; title: string; tracks: ManifestTrack[] };
export function technicalReviewManifest(project: ManifestProject) {
  // Explicit projection: do not serialize the full Admin DTO, storage keys,
  // private facts, payment/customer data or confidential evidence references.
  return {
    schema: "DCN_PRIVATE_TECHNICAL_MANIFEST_V1",
    purpose: "VERSION_IDENTIFICATION_ONLY_NOT_INTELLECTUAL_PROPERTY_EVIDENCE",
    checksumSource: "CATALOGUE_VALIDATED_INGESTION_NOT_A_FRESH_REMOTE_OBJECT_HASH",
    project: { id: project.id, slug: project.slug, title: project.title },
    tracks: [...project.tracks].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id)).map(t => ({
      trackId: t.id, title: t.title, position: t.position, masterId: t.masterId, version: t.version,
      durationMs: t.durationMs, previewStartMs: t.previewStartMs, previewDurationMs: t.previewDurationMs,
      sourceFormat: t.sourceFormat, sourceSha256: t.sourceSha256,
      wavSha256: t.wavSha256, mp3Sha256: t.mp3Sha256, previewSha256: t.previewSha256, bindingHash: t.bindingHash,
    })),
    grantsRights: false, validatesListening: false, activatesOffers: false,
  };
}
export async function browserSha256(bytes: ArrayBuffer): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, "0")).join("");
}
export async function privateEvidenceFingerprint(file: { size: number; arrayBuffer(): Promise<ArrayBuffer> }) {
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > PRIVATE_EVIDENCE_MAX_BYTES) throw new Error("Choisissez un justificatif non vide de 10 Mio maximum. Aucun fichier n’a été transmis.");
  const bytes = await file.arrayBuffer();
  if (bytes.byteLength !== file.size) throw new Error("Le justificatif a changé pendant sa lecture. Sélectionnez-le à nouveau.");
  const sha256 = await browserSha256(bytes);
  return { sha256, reference: `private-evidence:dcn-evidence/${sha256}` };
}
