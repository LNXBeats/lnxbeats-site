import { digitalFranceContractHash, digitalFranceLiveContractCandidate, validateSavedDigitalFranceLiveContractApproval,
  type DigitalFranceLiveContractApprovalSnapshot } from "./france-live-contract";

/** Publication alias, not a new contract and not an approval repository. The
 * approved content and all acquired version identifiers remain immutable.
 */
const mapping = Object.freeze({ reference: "digital-music-france-cgv-20261016", label: "CGV numériques du 16 octobre 2026",
  contentVersion: "digital-music-france-cgv-20261016-draft-04",
  documentHashSha256: "33ae20b540a718cd22d887f72e5651cdce317d9bf60bc3381be2fe06d2d69d41",
  textHashSha256: "868a08be362b2f499e979b996063b435c28a13f973d19d83ec78f072b0c6e41b",
  consentsHashSha256: "f52a7310693970e748d5ec5cbfa534dede96f9d5f72c433424a71e4953c1f100" });
export const digitalFranceContractPublication = Object.freeze({ ...mapping, mappingHashSha256: digitalFranceContractHash(mapping) });
export function approvedDigitalFranceContractPublication(approval: DigitalFranceLiveContractApprovalSnapshot | null) {
  const d = digitalFranceLiveContractCandidate;
  if (!approval || !validateSavedDigitalFranceLiveContractApproval(approval) || approval.approval.version !== mapping.contentVersion
    || d.version !== mapping.contentVersion || d.hashSha256 !== mapping.documentHashSha256 || d.textHashSha256 !== mapping.textHashSha256
    || d.consentsHashSha256 !== mapping.consentsHashSha256 || approval.approval.documentHashSha256 !== mapping.documentHashSha256) return null;
  return digitalFranceContractPublication;
}
