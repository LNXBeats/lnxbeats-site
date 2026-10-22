/** A standing personal declaration applied by the owner's explicit upload
 * action in a private Express draft. Not an independent copyright certificate. */
export const EXPRESS_COVER_OWNER_POLICY = "OWNER_EXPRESS_COVER_UPLOAD_20261022_V1";

export function expressOwnerCoverEligible(state: { status: string; publicVisible: boolean; hasActiveOffers: boolean; expressDraft: boolean }) {
  return state.status === "DRAFT" && !state.publicVisible && !state.hasActiveOffers && state.expressDraft;
}

export function catalogCoverDeclaration(form: Pick<FormData, "get">): "CHECKBOX" | typeof EXPRESS_COVER_OWNER_POLICY | null {
  if (form.get("rightsConfirmed") === "on") return "CHECKBOX";
  return form.get("ownerDeclaration") === EXPRESS_COVER_OWNER_POLICY ? EXPRESS_COVER_OWNER_POLICY : null;
}
