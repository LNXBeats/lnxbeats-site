/** Owner-selected defaults for this site's new original creations. They are
 * self-declared credits, never independent evidence of copyright ownership. */
export const EXPRESS_OWNER_CREDIT_POLICY = "EXPRESS_OWNER_CREDITS_20261022_V1";
export const EXPRESS_OWNER_ARTIST = "LNX Beats Studio";
export const EXPRESS_OWNER_COMPOSER = "Ludovic Mickaël Mathon";
export type ExpressOwnerCredit = { name: string; role: "ARTIST" | "COMPOSER" };

function folded(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").trim().replace(/\s+/g, " ").toLocaleLowerCase("fr");
}
const selfArtists = new Set(["lnx beats", "lnx beats studio", "ludovic mathon", "ludovic mickael mathon", "mathon ludovic mickael"]);

/** Additive only. An existing legal role or collaborator is never overwritten.
 * Collaborations must retain their own factual credit review; no sole composer
 * is inferred there. Lyrics, performers and producers are not inferred at all. */
export function expressOwnerCreditPlan(existing: readonly { name: string; role: string }[], hasCollaborations: boolean): ExpressOwnerCredit[] {
  const additions: ExpressOwnerCredit[] = [];
  if (!existing.some(c => c.role.toUpperCase() === "ARTIST" && selfArtists.has(folded(c.name)))) {
    additions.push({ name: EXPRESS_OWNER_ARTIST, role: "ARTIST" });
  }
  if (!hasCollaborations && !existing.some(c => c.role.toUpperCase() === "COMPOSER")) {
    additions.push({ name: EXPRESS_OWNER_COMPOSER, role: "COMPOSER" });
  }
  return additions;
}

export function expressHasCollaborationCredits(credits: readonly { name: string; role: string }[]) {
  return credits.some(c => c.role.toUpperCase() === "FEATURING"
    || ["ARTIST", "WRITER", "COMPOSER", "PRODUCER", "ENGINEER", "OTHER"].includes(c.role.toUpperCase()) && !selfArtists.has(folded(c.name)));
}
