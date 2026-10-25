type JukeboxPreview = Readonly<{ url: string; durationMs: number }>;
type PreviewProject = Readonly<{ type: string; audioPreview?: JukeboxPreview | null }>;
type PublicDigitalPreview = Readonly<{
  tracks: readonly Readonly<{ previewUrl: string | null; previewDurationMs: number | null }>[];
}> | null;

const PUBLIC_DIGITAL_PREVIEW = /^\/media\/digital\/previews\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const PUBLIC_CATALOG_PREVIEW = /^\/media\/catalog\/audio\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

function usableDuration(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value > 0 && value <= 60_000;
}

/** Consume the existing server-approved public projection. Never construct a URL
 * from a master/asset record or use a members-only preview as a public fallback.
 * Legacy project presentations retain their independently gated public route.
 */
export function jukeboxPublicPreview(project: PreviewProject, digital: PublicDigitalPreview): JukeboxPreview | null {
  const track = digital?.tracks.find(({ previewUrl, previewDurationMs }) =>
    previewUrl !== null && PUBLIC_DIGITAL_PREVIEW.test(previewUrl) && usableDuration(previewDurationMs));
  if (track?.previewUrl && usableDuration(track.previewDurationMs)) {
    return { url: track.previewUrl, durationMs: track.previewDurationMs };
  }
  const legacy = project.type === "project" ? project.audioPreview : null;
  return legacy && PUBLIC_CATALOG_PREVIEW.test(legacy.url) && usableDuration(legacy.durationMs)
    ? { url: legacy.url, durationMs: legacy.durationMs }
    : null;
}
