export function digitalResidenceFeedback(value: { checkoutEligible?: boolean; checkoutCode?: string | null; reviewStatus?: string }) {
  if (value.checkoutEligible || value.reviewStatus === "VERIFIED") return "Coordonnées enregistrées. Vous pouvez poursuivre votre commande.";
  return digitalResidenceErrorMessage(value.checkoutCode ?? null);
}
export function digitalResidenceErrorMessage(code: string | null) {
  if (code === "FRANCE_ADDRESS_POSTAL_CITY_MISMATCH") return "Le code postal et la ville ne correspondent pas au référentiel postal. Vérifiez leur orthographe ; n’indiquez pas CEDEX.";
  if (code === "FRANCE_RESIDENCE_ADDRESS_INVALID" || code === "FRANCE_RESIDENCE_DECLARATION_REQUIRED") return "Vérifiez la rue, le code postal et la ville. Cette boutique est réservée à la France métropolitaine et à la Corse, hors CEDEX et outre-mer.";
  if (code === "FRANCE_RESIDENCE_DECLARATION_CHANGED") return "Vos coordonnées ont changé dans un autre onglet. Actualisez leur état avant de recommencer.";
  if (code === "PAYMENT_ALREADY_ENGAGED") return "Une commande est déjà en cours. Consultez son suivi ou Ma musique avant de modifier vos coordonnées ; ne recommencez pas le paiement.";
  if (code === "FRANCE_ADDRESS_DECLARATION_EXPIRED") return "Confirmez à nouveau vos coordonnées pour cette commande.";
  if (code === "FRANCE_RESIDENCE_BILLING_CONFLICT_REVIEW_REQUIRED") return "Ces coordonnées diffèrent des informations de facturation disponibles. Une vérification par LNX Beats est nécessaire ; aucun paiement n’a été lancé.";
  if (code === "FRANCE_BILLING_ADDRESS_DIFFERENT_REQUIRES_REVIEW") return "Une adresse de facturation différente nécessite une vérification par LNX Beats avant paiement.";
  if (code === "FRANCE_RESIDENCE_REVIEW_REVOKED") return "Votre dossier nécessite une vérification par LNX Beats. Aucun paiement n’a été lancé.";
  if (code === "FRANCE_RESIDENCE_MANUAL_REVIEW_REQUIRED") return "Votre adresse attend une vérification manuelle par LNX Beats. Aucun paiement n’a été lancé.";
  return "Ces coordonnées ne permettent pas encore de poursuivre. Vérifiez-les ou contactez LNX Beats. Aucun paiement n’a été lancé.";
}
