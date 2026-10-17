/** Public labels describe verified state, never manufacture payment or access evidence. */
// A full price reduction can be REFUNDED while its source entitlement remains ACTIVE.
// A resolution revokes that entitlement; the financial label alone does not revoke rights.
export const DIGITAL_ACTIVE_RIGHTS_ORDER_STATES = ["PAID", "PARTIALLY_REFUNDED", "REFUNDED", "GRANTED"] as const;
export function digitalCountsOwnedRights(orderStatus: string, entitlementStatus: string) {
  return entitlementStatus === "ACTIVE" && DIGITAL_ACTIVE_RIGHTS_ORDER_STATES.some(status => status === orderStatus);
}
/** Display-only abbreviation; ownership and navigation always use the complete order ID. */
export function digitalLibraryPurchaseReference(orderId: string) {
  return `…${orderId.slice(-8).toUpperCase()}`;
}
export function digitalLibraryPaymentLabel(status: string, activeRights: boolean) {
  if(status==="GRANTED")return "Complément gratuit attribué — aucun nouveau paiement";
  if (status === "PAID") return "Paiement confirmé";
  if (status === "REFUNDED") return activeRights ? "Remboursé — droits conservés selon les lignes" : "Remboursé — accès retiré";
  if (status === "PARTIALLY_REFUNDED") return "Remboursement partiel confirmé. Le détail de vos téléchargements et vos justificatifs figurent ci-dessous.";
  if (status === "DISPUTED") return "Litige — accès suspendu";
  if (status === "FAILED") return "Paiement non abouti";
  return "Paiement en attente / à vérifier";
}
export function digitalLibraryBlockedMessage(status: string, accessReady: boolean, mode="TEST") {
  if (DIGITAL_ACTIVE_RIGHTS_ORDER_STATES.some(state=>state===status)) return !accessReady
    ? mode==="LIVE"?"Conservez et confirmez la réception de votre confirmation contractuelle avant de télécharger votre musique.":"La réception contractuelle QA reste nécessaire avant toute nouvelle fourniture. Les droits actifs sont vérifiés séparément."
    : "Aucun accès actif pour cette ligne.";
  if (status === "DISPUTED") return "Accès lié à cet achat suspendu pour revue ; vos autres acquisitions ne sont pas suspendues automatiquement.";
  return "Aucun fichier débloqué : paiement non confirmé ou achat en revue. Ne recommencez pas un paiement ambigu.";
}
export function digitalConfirmationMessage(status:string,needsReconciliation:boolean,mode="TEST"){
  if(status==="GRANTED")return mode==="LIVE"?"Complément gratuit attribué sans nouveau paiement. Conservez sa confirmation avant de commencer la fourniture.":"Complément gratuit attribué sans nouveau paiement. Conservez sa confirmation avant de commencer la fourniture QA.";
  if(status==="PAID")return "Paiement confirmé côté serveur.";
  if(status==="REFUNDED")return "Remboursement confirmé. Les droits sont vérifiés selon les lignes ; les justificatifs restent conservés.";
  if(status==="PARTIALLY_REFUNDED")return "Une partie de votre paiement a été remboursée. Consultez vos justificatifs ici et l’état de vos téléchargements dans Ma musique.";
  if(status==="DISPUTED")return "Cet achat est en litige et ses accès sont suspendus pour revue, sans accusation de fraude.";
  if(status==="FAILED")return "Paiement non abouti. Aucun accès délivré.";
  return needsReconciliation?"Résultat ambigu, conservé pour vérification. Ne recommencez pas le paiement.":"En attente de confirmation prestataire. Aucun téléchargement débloqué par cette page.";
}
/** Delivery state is displayed in plain language; no internal notification kind,
 * queue state or mail-provider identifier is a customer-facing receipt. */
export function digitalNotificationMessage(statuses:string[],mode:string){
  if(mode!=="LIVE"&&statuses.includes("CAPTURED_QA"))return "Courriels capturés localement : aucun envoi réel.";
  if(statuses.some(s=>["FAILED","REQUIRES_REVIEW","DEAD"].includes(s)))return "L’envoi du courriel nécessite une vérification. Vos documents restent disponibles ici.";
  if(statuses.some(s=>["SENT","DELIVERED"].includes(s)))return "Un courriel lié à cet achat a été envoyé. Conservez aussi vos documents.";
  if(statuses.length)return "Le courriel est en préparation. Suivez votre achat depuis cette page.";
  return "Aucun courriel envoyé pour le moment. Consultez vos documents ici.";
}
