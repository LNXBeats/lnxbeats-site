/** Owner-requested preservation: no claim, recovery, file access or session mutation.
 * This single's recording identity remains unresolved. Removal needs a separate decision.
 * This is an upload hold, not a catalogue/right/price change or a reset of its history.
 */
export const DIGITAL_AUDIO_UPLOAD_HOLDS = ["d7af5226-f1b6-4da3-ba87-9e96f0ab11d8"] as const;
export function digitalAudioUploadHeld(id: string) {
  return DIGITAL_AUDIO_UPLOAD_HOLDS.some(held => held === id);
}
export function digitalAudioUploadHoldFilter() {
  return { AND: [{ id: { notIn: [...DIGITAL_AUDIO_UPLOAD_HOLDS] } }] };
}
