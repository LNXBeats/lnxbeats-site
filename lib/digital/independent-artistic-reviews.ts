import { DigitalError } from "./domain";
/** A stale approval in another work must not erase independently valid ones.
 * Fast batch path; bounded individual rechecks only on a business gate refusal.
 * Infrastructure failures still propagate instead of fabricating a verdict.
 */
export async function independentlyValidatedMasters<T extends { id: string }>(masters: T[], verify: (masters: T[]) => Promise<unknown>) {
  const valid = new Set<string>(); if (!masters.length) return valid;
  try { await verify(masters); masters.forEach(m => valid.add(m.id)); }
  catch (error) {
    if (!(error instanceof DigitalError)) throw error;
    for (const m of masters) { try { await verify([m]); valid.add(m.id); } catch (failure) { if (!(failure instanceof DigitalError)) throw failure; } }
  }
  return valid;
}
