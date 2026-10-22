/** Automatic transport is restricted to files explicitly bound by the Admin.
 * Never retries an ambiguous failure, guesses a track or authorizes replacement. */
export function automaticAudioStarts(
  rows: Array<{ id: string; trackId: string; valid: boolean; state: string }>,
  boundEntries: Array<{ id: string; trackId?: string }>,
  attempted: ReadonlySet<string>,
  running: number,
) {
  const capacity = Math.max(0, 2 - Math.max(running, rows.filter(row => row.state === "busy").length));
  return rows.filter(row => row.state === "waiting" && row.valid && !attempted.has(row.id)
    && boundEntries.some(entry => entry.id === row.id && entry.trackId === row.trackId))
    .slice(0, capacity).map(row => row.id);
}
