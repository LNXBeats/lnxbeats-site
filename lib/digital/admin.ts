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
