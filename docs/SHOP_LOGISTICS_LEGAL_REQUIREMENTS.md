# Exigences juridiques de la future logistique

Colissimo n’est pas actif. Aucun appel La Poste, tarif réel, étiquette ou suivi n’est implémenté par la Phase 4B.

## OWNER-APPROVED REQUIREMENTS

- destination initiale : France métropolitaine uniquement ;
- préparation : 2 à 3 jours ouvrés après paiement, sauf exception explicite de fiche produit ;
- service de lancement : Colissimo avec signature ;
- retour : LNX Beats, 35 Impasse des Orties, 07370 Ozon, France ;
- frais directs de rétractation de convenance : client, si l’information précontractuelle est fournie ; vendeur lorsque la loi l’impose ;
- CD audio expédiés scellés ; garanties légales intactes ;
- poids facturable Release B : somme des poids produits × quantité, avec minimum commercial de 250 g ; le carton CD de 60 g reste physique, offert et non inclus dans le poids facturé ;
- capacité de lancement : 16 articles maximum tant que le multi-colis n’est pas disponible ;
- suivi de lancement : saisie Admin manuelle du numéro Colissimo ; l’API transporteur reste désactivée.

Avant l’obligation de paiement, le Checkout devra afficher pays, service avec signature, préparation, estimation transport, frais exacts et total. Une quote de livraison absente ou périmée devra fermer le Checkout Production. `shippingCents` est snapshoté dans `ShopOrder` puis repris sans recalcul dans la facture.

## FUTURE TECHNICAL IMPLEMENTATION

Prévoir `PackagingProfile`, poids propres aux produits, emballage et protection, capacités/dimensions, activation et priorité. Prévoir des grilles transport versionnées, datées, liées au service et au palier de poids, snapshotées sur la commande. Aucun tarif courant ne doit être inscrit dans les CGV.

Les statuts détaillés d’une future API transporteur ne doivent pas être simulés. Au lancement, l’Admin saisit transporteur, numéro, date et lien officiel ; le client les voit dans son Compte. Le transfert des risques demeure lié à la prise de possession physique selon la règle impérative.

À l’intégration, revérifier les conditions La Poste, mappings d’événements, délais, tarifs et mentions juridiques. Une modification future de grille ne réécrit jamais une commande ni une facture historique.
