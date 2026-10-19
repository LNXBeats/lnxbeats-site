// Quoted identities in existing editorial material, never catalogue data fallback.
const EDITORIAL_IDENTITIES = ["LNX Beats Studio", "LNX Beats", "Ludovic Mathon", "Bienvenue dans le bordel familial", "J’ai adopté un humain", "J’ai adopté", "Chaos canin", "Miss Click", "Le Dernier Âge d’Or", "Ça va l’faire", "J’préfère le carton", "Madame Piécettes", "L’ADO"];

/** HTML renders CRLF as LF. Normalize only lookup text, never stored catalogue data or names. */
export function editorialLookupText(text: string) {
  return text.replace(/\r\n?/g, "\n");
}

/** Literal matching, including punctuation or brackets, without regular expressions. */
export function editorialIdentityParts(text: string, names: readonly string[] = []) {
  const identities = [...new Set([...EDITORIAL_IDENTITIES, ...names].filter(Boolean))].sort((a, b) => b.length - a.length);
  const parts: Array<{ text: string; original: boolean }> = [];
  let offset = 0;
  while (offset < text.length) {
    let next = -1;
    let identity = "";
    for (const name of identities) {
      const index = text.indexOf(name, offset);
      if (index !== -1 && (next === -1 || index < next)) { next = index; identity = name; }
    }
    if (next === -1) { parts.push({ text: text.slice(offset), original: false }); break; }
    if (next > offset) parts.push({ text: text.slice(offset, next), original: false });
    parts.push({ text: identity, original: true });
    offset = next + identity.length;
  }
  return parts;
}

export function editorialSafeTranslation(source: string, translated: string, names: readonly string[] = []) {
  const identities = (text: string) => JSON.stringify(editorialIdentityParts(text, names).filter(p => p.original).map(p => p.text).sort());
  return identities(source) === identities(translated) ? translated : source;
}
