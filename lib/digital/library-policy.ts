/** Public labels describe verified state, never manufacture payment or access evidence. */
// A full price reduction can be REFUNDED while its source entitlement remains ACTIVE.
// A resolution revokes that entitlement; the financial label alone does not revoke rights.
export const DIGITAL_ACTIVE_RIGHTS_ORDER_STATES = ["PAID", "PARTIALLY_REFUNDED", "REFUNDED"] as const;
export function digitalCountsOwnedRights(orderStatus: string, entitlementStatus: string) {
  return entitlementStatus === "ACTIVE" && DIGITAL_ACTIVE_RIGHTS_ORDER_STATES.some(status => status === orderStatus);
}
export function digitalLibraryPaymentLabel(status: string, activeRights: boolean) {
  if (status === "PAID") return "Paiement confirmé";
  if (status === "REFUNDED") return activeRights ? "Remboursé — droits conservés selon les lignes" : "Remboursé — accès retiré";
  if (status === "PARTIALLY_REFUNDED") return "Remboursement partiel — droits selon les lignes";
  if (status === "DISPUTED") return "Litige — accès suspendu";
  if (status === "FAILED") return "Paiement non abouti";
  return "Paiement en attente / à vérifier";
}
export function digitalLibraryBlockedMessage(status: string, accessReady: boolean) {
  if (["PAID", "PARTIALLY_REFUNDED", "REFUNDED"].includes(status)) return !accessReady
    ? "La réception contractuelle QA reste nécessaire avant toute nouvelle fourniture. Les droits actifs sont vérifiés séparément."
    : "Aucun accès actif pour cette ligne.";
  if (status === "DISPUTED") return "Accès lié à cet achat suspendu pour revue ; vos autres acquisitions ne sont pas suspendues automatiquement.";
  return "Aucun fichier débloqué : paiement non confirmé ou achat en revue. Ne recommencez pas un paiement ambigu.";
}
export function digitalConfirmationMessage(status:string,needsReconciliation:boolean){
  if(status==="PAID")return "Paiement confirmé côté serveur.";
  if(status==="REFUNDED")return "Remboursement confirmé. Les droits sont vérifiés selon les lignes ; les justificatifs restent conservés.";
  if(status==="PARTIALLY_REFUNDED")return "Remboursement partiel confirmé. Consultez les droits de chaque ligne dans Ma musique.";
  if(status==="DISPUTED")return "Cet achat est en litige et ses accès sont suspendus pour revue, sans accusation de fraude.";
  if(status==="FAILED")return "Paiement non abouti. Aucun accès délivré.";
  return needsReconciliation?"Résultat ambigu, conservé pour vérification. Ne recommencez pas le paiement.":"En attente de confirmation prestataire. Aucun téléchargement débloqué par cette page.";
}
