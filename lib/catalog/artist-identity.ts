/** Owner's site display decision. Not a copyright, performer or distribution claim. */
export const CATALOG_PRIMARY_ARTIST = "LNX Beats Studio";
export const CATALOG_ARTIST_DISPLAY_POLICY = "LNX_SITE_PRIMARY_ARTIST_20261018_V1";
const ownerArtistNames = new Set(["lnx beats", "lnx beats studio", "ludovic mathon", "ludovic mickael mathon", "mathon ludovic mickael"]);
function folded(value: string) {
  return value.normalize("NFD").replace(/\p{M}/gu, "").trim().replace(/\s+/g, " ").toLocaleLowerCase("fr");
}
export function catalogPrimaryArtist(type: string): string | undefined {
  return ["ALBUM", "SINGLE"].includes(type.toUpperCase()) ? CATALOG_PRIMARY_ARTIST : undefined;
}
/** Display projection only. Original rows/IDs/provenance remain in the private catalogue.
 * Self ARTIST aliases appear once as the separate primary byline, never as duplicate
 * public ARTIST credits. All other artists, collaborators and legal roles survive.
 * This MUST NOT feed rights, publication, announcement bindings or contract snapshots.
 */
export function catalogSecondaryCredits<T extends { name: string; role: string }>(credits: readonly T[]): T[] {
  return credits.filter(c => c.role.toUpperCase() !== "ARTIST" || !ownerArtistNames.has(folded(c.name)));
}
/** Avoid adding a second self ARTIST row under another spelling/pseudonym. */
export function catalogArtistAlreadyDocumented(credits: readonly { name: string; role: string }[], name: string): boolean {
  const candidate = folded(name);
  return credits.some(c => c.role.toUpperCase() === "ARTIST" && (folded(c.name) === candidate
    || ownerArtistNames.has(candidate) && ownerArtistNames.has(folded(c.name))));
}
