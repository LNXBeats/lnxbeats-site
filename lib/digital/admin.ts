// Presentation-only diagnostics. The catalogue selection remains authoritative.
export type DigitalReadinessTrack = {
  id: string; title: string; publication: string; masterReady: boolean;
  previewDurationMs: number | null; mediaCleared: boolean;
  offer: { active: boolean; rightsConfirmed: boolean; priceCents: number | null } | null;
};
export function digitalSalesReadiness(project: { status: string; publicVisible: boolean }, tracks: DigitalReadinessTrack[], album: DigitalReadinessTrack["offer"]) {
  const published = project.status === "PUBLISHED" && project.publicVisible;
  const released = tracks.filter(t => t.publication === "RELEASED");
  const prepared = (t: DigitalReadinessTrack) => t.masterReady && t.mediaCleared && !!t.previewDurationMs && t.previewDurationMs > 0 && t.previewDurationMs <= 60_000;
  const saleOffer = (o: DigitalReadinessTrack["offer"]) => !!o?.active && o.rightsConfirmed && Number.isSafeInteger(o.priceCents) && Number(o.priceCents) >= 1 && Number(o.priceCents) <= 100_000;
  const items = tracks.map(t => ({ id: t.id, ready: published && t.publication === "RELEASED" && prepared(t) && saleOffer(t.offer), blockers: [
    ...(!published ? ["Projet non publié ou masqué"] : []),
    ...(t.publication !== "RELEASED" ? ["Piste non publiée"] : []),
    ...(!t.masterReady ? ["Master privé manquant"] : []),
    ...(!t.previewDurationMs || t.previewDurationMs > 60_000 ? ["Extrait valide manquant"] : []),
    ...(!t.mediaCleared ? ["Droits médias à confirmer"] : []),
    ...(!saleOffer(t.offer) ? ["Offre/prix/droits de vente à compléter"] : []),
  ] }));
  const albumReady = published && released.length > 0 && released.every(prepared) && saleOffer(album);
  // Compare only the same released tracks actually available independently.
  const comparable = albumReady && released.every(t => items.find(i => i.id === t.id)?.ready);
  const individualTotalCents = comparable ? released.reduce((sum, t) => sum + Number(t.offer!.priceCents), 0) : null;
  return { items, albumReady, includedTrackCount: albumReady ? released.length : 0,
    preparedTrackCount: released.filter(prepared).length, releasedTrackCount: released.length,
    individualTotalCents, albumMoreExpensive: individualTotalCents !== null && Number(album?.priceCents) > individualTotalCents };
}
export const DIGITAL_BATCH_FILE_LIMIT = 50;
export const DIGITAL_BATCH_CONCURRENCY = 2;
export function digitalImportStartMs(value: string) {
  if (!/^\d{1,4}(?:\.\d{1,3})?$/.test(value)) return null;
  const milliseconds = Math.round(Number(value) * 1000);
  return Number.isSafeInteger(milliseconds) && milliseconds >= 0 && milliseconds < 30 * 60_000 ? milliseconds : null;
}
export function digitalBatchAssociationIssue(rows: Array<{ trackId: string; valid: boolean; state: string }>) {
  const pending = rows.filter(row => row.state !== "ready");
  if (!pending.length) return "Aucun fichier en attente dans ce lot.";
  if (pending.some(row => !row.trackId || !row.valid)) return "Associez chaque fichier en attente, vérifiez le début d’extrait et confirmez les nouvelles versions avant le lot.";
  const associated = rows.filter(row => row.trackId);
  if (new Set(associated.map(row => row.trackId)).size !== associated.length) return "Deux fichiers sont associés à la même piste. Corrigez cette association avant l’envoi.";
  return null;
}
export async function runDigitalBatch<T>(items: T[], run: (item: T) => Promise<void>, shouldStop: () => boolean = () => false) {
  if (items.length > DIGITAL_BATCH_FILE_LIMIT) throw new Error("BATCH_TOO_LARGE");
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(DIGITAL_BATCH_CONCURRENCY, items.length) }, async () => {
    while (!shouldStop() && cursor < items.length) {
      const item = items[cursor++];
      // Each row owns its own failure/retry state; one rejection never loses others.
      await run(item).catch(() => undefined);
    }
  }));
}
export function digitalAdminPage(value: unknown) {
  return typeof value === "string" && /^\d{1,6}$/.test(value) && Number(value) >= 1 ? Number(value) : 1;
}
// Admin audition is independent of public publication and commercial rights approval.
// Only the bounded derived excerpt is eligible, never a complete WAV or MP3.
export function digitalAdminExcerptReady(master: { status: string; previewDurationMs: number | null; previewAsset: {
  type: string; visibility: string; mimeType: string | null; sizeBytes: bigint | number; durationMs: number | null; checksumSha256: string | null;
} | null }) {
  const asset = master.previewAsset;
  return master.status === "READY" && !!asset && asset.type === "AUDIO_PREVIEW" && asset.visibility === "PUBLIC" && asset.mimeType === "audio/mpeg"
    && /^[a-f0-9]{64}$/.test(asset.checksumSha256 ?? "") && Number.isSafeInteger(Number(asset.sizeBytes)) && Number(asset.sizeBytes) > 0 && Number(asset.sizeBytes) <= 3 * 1024 * 1024
    && Number.isSafeInteger(master.previewDurationMs) && master.previewDurationMs! > 0 && master.previewDurationMs! <= 60_000 && asset.durationMs === master.previewDurationMs;
}
