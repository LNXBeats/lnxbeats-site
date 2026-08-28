# Exigences juridiques de la future logistique

Colissimo n’est pas actif. Aucun appel La Poste, tarif réel, étiquette ou suivi n’est implémenté par la Phase 4B.

## OWNER-APPROVED REQUIREMENTS

- destination initiale : France métropolitaine uniquement ;
- préparation : 2 à 3 jours ouvrés après paiement, sauf exception explicite de fiche produit ;
- service de lancement : Colissimo avec signature ;
- retour : LNX Beats, 35 Impasse des Orties, 07370 Ozon, France ;
- frais directs de rétractation de convenance : client, si l’information précontractuelle est fournie ; vendeur lorsque la loi l’impose ;
- CD audio expédiés scellés ; garanties légales intactes ;
- poids : somme produits × quantité + emballage + protection, puis minimum facturable interne de 150 g ;
- suivi : automatisation Colissimo future avec fallback Admin manuel.

Avant l’obligation de paiement, le Checkout devra afficher pays, service avec signature, préparation, estimation transport, frais exacts et total. Une quote de livraison absente ou périmée devra fermer le Checkout Production. `shippingCents` est snapshoté dans `ShopOrder` puis repris sans recalcul dans la facture.

## FUTURE TECHNICAL IMPLEMENTATION

Prévoir `PackagingProfile`, poids propres aux produits, emballage et protection, capacités/dimensions, activation et priorité. Prévoir des grilles transport versionnées, datées, liées au service et au palier de poids, snapshotées sur la commande. Aucun tarif courant ne doit être inscrit dans les CGV.

Statuts cibles à adapter à l’API réelle : `PREPARING`, `HANDED_TO_CARRIER`, `IN_TRANSIT`, `OUT_FOR_DELIVERY`, `DELIVERED`, `DELIVERY_EXCEPTION`, `RETURNING`, `RETURNED`. Le fallback doit permettre à l’Admin de saisir transporteur, numéro, date et lien ; le client les voit dans son Compte. Le transfert des risques demeure lié à la prise de possession physique selon la règle impérative.

À l’intégration, revérifier les conditions La Poste, mappings d’événements, délais, tarifs et mentions juridiques. Une modification future de grille ne réécrit jamais une commande ni une facture historique.
