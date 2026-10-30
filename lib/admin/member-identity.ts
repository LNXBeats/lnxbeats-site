type MemberIdentitySource = {
  firstName?: string | null;
  lastName?: string | null;
  displayName?: string | null;
};

const placeholderNames = new Set(["membre", "member", "membrelnx", "memberlnx", "lnxmembre", "lnxmember"]);
const clean = (value?: string | null) => (value ?? "").trim().replace(/\s+/g, " ");

/** Display existing identity only. Never infer a person's name from their email. */
export function adminMemberIdentity(member: MemberIdentitySource) {
  const knownName = [clean(member.firstName), clean(member.lastName)].filter(Boolean).join(" ");
  const displayName = clean(member.displayName);
  const normalizedDisplayName = displayName.normalize("NFKC").toLocaleLowerCase("fr-FR").replace(/[^\p{L}\p{N}]/gu, "");
  const name = knownName || (placeholderNames.has(normalizedDisplayName) ? "" : displayName);
  return { label: name || "Nom à compléter", initial: name ? [...name][0].toLocaleUpperCase("fr-FR") : "?" };
}
