/** Public explanations only: never include provider errors, credentials or raw input. */
export function digitalErrorMessage(code:string,ownedTitles:readonly string[]=[]):string {
  if (ownedTitles.length) return `Déjà acquis : ${ownedTitles.join(" · ")}. Ce panier ne permet pas un complément automatique sûr. Vos achats restent dans Ma musique ; aucun crédit n’est appliqué sans vérification.`;
  if (/TERRITORY|COUNTRY|SUBDIVISION|B2C_REQUIRED/.test(code)) return "Ce territoire ou les informations de résidence ne permettent pas encore cet achat numérique. Aucun nouveau paiement n’a été lancé. Vérifiez vos informations ou attendez une ouverture validée.";
  if (code === "ALREADY_OWNED") return "Cette édition est déjà dans Ma musique. Retrouvez-y vos fichiers et documents ; aucun nouvel achat n’est nécessaire.";
  if (code === "ALBUM_PARTIALLY_OWNED") return "Certains titres sont déjà acquis, mais leur édition ou leur situation ne permet pas de calculer un complément automatique sûr. Vos achats restent dans Ma musique.";
  if (code === "COMPLETION_ZERO_REQUIRES_REVIEW") return "Vos montants éligibles couvrent le prix de l’album. L’attribution sans paiement reste à valider ; aucun paiement à zéro ni crédit réutilisable n’est créé.";
  if (code.startsWith("COMPLETION_")) return "Le complément de cet album nécessite une vérification de vos acquisitions, remboursements ou crédits réservés. Aucun nouveau crédit n’est appliqué par cette action refusée.";
  if (code === "NO_READY_MASTER") return "Les fichiers requis ne sont pas tous validés pour une nouvelle vente. Vérifiez les masters, MP3 et extraits dans l’Admin ; les fichiers déjà acquis ne sont pas remplacés.";
  if (code === "ARCHIVE_PREPARING") return "L’archive privée est en préparation dans le worker. Réessayez dans quelques instants ; vos pistes restent accessibles individuellement.";
  if (code === "CONTRACT_RECEIPT_REQUIRED") return "Téléchargez et accusez réception de votre confirmation contractuelle avant de commencer la fourniture QA.";
  if (code === "PRICE_CHANGED") return "Le prix a changé. Vérifiez et confirmez de nouveau le panier.";
  if (code === "CATALOGUE_CHANGED") return "Le contenu ou la version de la sélection a changé. Vérifiez de nouveau le panier avant tout paiement.";
  if (code.includes("REVIEW")) return "Ce paiement nécessite une vérification. Ne recommencez pas le paiement.";
  return "Cette action n’a pas pu être traitée. Vérifiez votre connexion et l’état du parcours.";
}
