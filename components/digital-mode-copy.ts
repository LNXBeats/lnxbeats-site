/** Presentation only. The server supplies the runtime or immutable order mode;
 * these labels never grant checkout, refund, download or contract approval rights. */
export type DigitalUiMode = "TEST" | "LIVE";
export function digitalUiIsLive(mode: unknown): mode is "LIVE" { return mode === "LIVE"; }
export function digitalUiCopy(mode: unknown) {
  const live = digitalUiIsLive(mode);
  return {
    live,
    paymentHeading: live ? "Paiement sécurisé" : "Paiement QA sécurisé",
    paymentNote: live ? "Compte vérifié · EUR · confirmation du paiement côté serveur" : "Compte vérifié · EUR · aucun encaissement LIVE autorisé",
    total: live ? "Total à payer" : "Total serveur QA",
    provider: live ? "Prestataire de paiement" : "Prestataire de test",
    noProvider: live ? "Paiement momentanément indisponible" : "Aucun sandbox configuré",
    stripe: live ? "Stripe" : "Stripe TEST",
    paypal: live ? "PayPal" : "PayPal SANDBOX",
    pay: live ? "Commander et payer" : "Payer en environnement de test",
    termsLink: live ? "Lire les conditions de vente numériques" : "Lire les conditions France exactes proposées pour cette commande QA",
    termsAcceptance: live ? "J’ai lu et j’accepte les conditions de vente numériques, dans la version indiquée ci-dessus." : "J’ai lu et j’accepte les conditions France de cette démonstration QA, dans la version indiquée ci-dessus. Cette case ne vaut pas approbation du texte pour une vente réelle.",
    invoice: live ? "Facture" : "Facture QA",
    creditNote: live ? "Avoir" : "Avoir QA",
    purchase: live ? "Achat numérique" : "Achat de démonstration",
  };
}
