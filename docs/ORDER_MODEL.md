# Commandes personnalisées et droits post-livraison — V0.6.0.1

## Décision et frontière

La V0.6 transforme Commander en un parcours membre réel : brouillon privé, sauvegarde, reprise, suppression, photos de référence, calcul serveur, finalisation et suivi. Une finalisation produit une `Order` au statut `AWAITING_PAYMENT` et un événement client horodaté. Elle ne prouve ni paiement, ni acceptation artistique, ni démarrage de la prestation.

La V0.6.0.1 sépare définitivement deux objets métier : la création personnelle, puis l’éventuelle extension de droits demandée après livraison. La grille initiale `2026-08-v1` allait de 50 à 90 €. Depuis V0.8.3, les nouvelles commandes utilisent `2026-08-v2`, de 20 à 60 €. Le second objet ne modifie jamais le prix, le statut ou le snapshot de la création d’origine.

Aucun paiement, secret marchand, SDK PSP, webhook, facture ou email transactionnel n’est actif.

`Wero — moyen de paiement potentiel à évaluer dans le sprint paiement selon disponibilité technique et commerciale au moment de l’intégration.`

## Offre et prix

Tous les montants sont calculés côté serveur en centimes entiers, en EUR, puis figés dans la commande avec leur `pricingVersion`. La grille courante `2026-08-v2` est :

| Élément | Montant |
| --- | ---: |
| Création personnelle | 20 € |
| Illustration personnalisée | +10 € |
| Traitement prioritaire | +30 € |
| Total maximal de la commande initiale | 60 € |

La grille historique `2026-08-v1` reste enregistrée dans le registre avec une base à 50 €, une illustration à +10 €, une priorité à +30 € et les totaux 50/60/80/90 €. Toute `Order` existante conserve cette version ; lorsqu’elle est payable, Checkout utilise son snapshot d’origine. Elle n’est jamais migrée vers v2.

Le serveur ignore tout prix, toute version tarifaire et tout `usage` envoyés par le client. Il persiste séparément base, illustration (`coverIncluded` et `coverPriceCents` restent les noms techniques historiques), priorité et total, puis force `usage = PERSONAL` et `contractRequired = false` pour chaque brouillon et chaque finalisation. Le choix `COMMERCIAL_EXTENDED` reste dans l’ancien enum uniquement pour compatibilité de schéma ; aucune route de commande initiale ne peut le produire. Un snapshot historique est conservé et explicitement signalé comme tel, jamais réécrit silencieusement.

Depuis V0.8.4, une nouvelle illustration exige un format parmi `SQUARE`, `VERTICAL`, `LANDSCAPE`, `PORTRAIT` et `CUSTOM`. `CUSTOM` exige une précision nettoyée de 240 caractères maximum. Le format ne modifie jamais le prix. Lorsque l’option est absente, les deux champs de format sont normalisés à `NULL`. Les Orders antérieures avec `coverIncluded=true` et format nul restent lisibles comme « Non renseigné » ; aucune migration ne leur invente une acceptation.

Le modèle prévoit un retour inclus (`revisionAllowance = 1`). Le délai public reste indicatif ; la priorité n’est pas une promesse automatique de date.

## Parcours membre

1. Un compte actif et vérifié ouvre ou crée un brouillon.
2. Le brief est sauvegardé explicitement en PostgreSQL ; aucune histoire sensible n’est déposée dans `localStorage`.
3. Les photos sont contrôlées puis ajoutées au brouillon privé. Une sélection encore en attente est automatiquement envoyée avant la finalisation afin qu’un changement de page ne l’oublie pas.
4. Le serveur valide de nouveau le brief, recalcule le prix avec la version déjà figée sur l’Order et finalise atomiquement la commande. Seule la création initiale d’une nouvelle Order choisit la grille courante.
5. Le statut devient `AWAITING_PAYMENT`. La page privée présente le prix comme calculé mais rappelle que le paiement n’est pas disponible.
6. Tant que la commande n’est pas `DELIVERED`, aucun bouton de droits n’est proposé et le service refuse toute demande.
7. Après livraison, le propriétaire peut demander une extension distincte depuis le détail privé.

Seul un brouillon peut être modifié ou supprimé par le membre. La suppression efface ses jointures et ses fichiers privés orphelins. Une finalisation incomplète échoue sans transition partielle.

Depuis V0.6.2, l’administration peut aussi supprimer définitivement un brouillon ou une commande `CANCELLED` uniquement lorsque le serveur confirme l’absence de paiement confirmé, service commencé, livraison, droits commerciaux et asset de livraison/document. La confirmation demande le numéro complet. La transaction retire timeline et jointures ; seuls les assets devenus réellement orphelins et leurs fichiers privés sont ensuite supprimés. Une annulation conservée reste distincte d’une suppression.

## Numéro et concurrence

Les références suivent `LNX-AAAA-NNNNNN`. Une séquence PostgreSQL dédiée garantit l’unicité sous concurrence ; elle n’est jamais calculée à partir d’un `count()` ni d’un dernier numéro lu par l’application. Les trous éventuels sont acceptables : une référence attribuée n’est pas recyclée.

## Autorisation et confidentialité

Chaque lecture ou mutation relit l’utilisateur depuis la session serveur. Un membre ne voit que les commandes dont `userId` correspond exactement à son compte. Un administrateur actif peut accéder au même service par une décision explicite côté serveur. Les absences et refus de propriété utilisent une réponse neutre afin de limiter l’énumération des références.

Les routes privées et leurs images sont dynamiques, `noindex`, hors sitemap et protégées contre l’IDOR. Les notes `INTERNAL` d’un `OrderEvent` ne sont jamais sérialisées vers le client ; seuls les événements `CLIENT` alimentent la timeline membre.

## Références privées image

Les règles sont cumulatives :

- 10 photos maximum par commande ;
- 10 Mio maximum par photo avant décodage ;
- JPEG, PNG ou WebP uniquement ;
- extension, `Content-Type`, signature binaire et décodage réel cohérents ;
- dimensions maximales 12 000 × 12 000 et 40 millions de pixels ;
- nom original traité comme une information d’affichage nettoyée, jamais comme un chemin ;
- clé de stockage générée par UUID côté serveur ;
- réencodage WebP et retrait des métadonnées EXIF ;
- contenu binaire hors PostgreSQL et hors `public/` ;
- service uniquement après autorisation du propriétaire ou de l’administration.

La V0.6 fournit seulement un adaptateur de stockage privé local pour développement et QA. Il refuse la production. Un stockage objet privé futur devra conserver la même interface, des clés non prévisibles et des URLs éphémères ou un proxy autorisé.

Le membre confirme qu’il peut communiquer les images et qu’elles concernent le projet. Cette confirmation ne remplace pas une analyse juridique des droits, de la conservation ni des demandes d’effacement. Commander ne propose aucun upload MP3/WAV client.

Le décodage/réencodage réduit la surface d’attaque mais ne constitue pas une promesse « sans virus ». Un scan antivirus devra être évalué avant d’accepter d’autres formats ou documents.

## Limites du brief

L’histoire principale accepte 30 à 10 000 caractères. Le titre de repère est limité à 120 caractères ; destinataire et contexte à 200 ; direction et émotion à 500 ; détails à 4 000. Depuis V0.6.2, le client n’est plus interrogé séparément sur les mots à préserver, éléments à éviter et prononciations : `Détails importants` porte ces précisions libres. Les colonnes historiques restent intactes pour préserver les anciennes commandes. Le JSON complet est borné à 128 Kio avant parsing. React affiche ces textes comme texte échappé, sans Markdown ni HTML utilisateur.

## Statuts

| Statut | Présentation client | Usage |
| --- | --- | --- |
| `DRAFT` | Brouillon | Modifiable et supprimable par son propriétaire. |
| `AWAITING_PAYMENT` | En attente de paiement | Demande finalisée ; aucun paiement encore disponible. |
| `PAYMENT_CONFIRMED` | Paiement confirmé | Preuve Stripe serveur reçue ; création prête à être prise en charge. |
| `SUBMITTED` / `RECEIVED` | Histoire reçue | Réception métier. |
| `REVIEWING` | En cours d’étude | Analyse par LNX Beats. |
| `ACCEPTED` | Projet accepté | Périmètre accepté. |
| `IN_PROGRESS` | Création en cours | Service commencé. |
| `FIRST_VERSION_READY` | Première version prête | Version soumise au retour prévu. |
| `REVISION_REQUESTED` | Retour demandé | Retour inclus consommé selon les règles serveur. |
| `FINALIZING` | Finalisation | Préparation de la livraison. |
| `DELIVERED` | Livré | Master privé publié pour le propriétaire. |
| `REFUSED` | Demande refusée | Le projet n’est pas accepté. |
| `CANCELLED` | Demande annulée | Projet arrêté. |
| `REFUND_PENDING` / `REFUNDED` | Remboursement | Réservé à une architecture de paiement future. |

Les transitions futures doivent passer par un service central, valider l’état précédent, appliquer les règles de révision et produire un `OrderEvent` dans la même transaction. Un bouton client ne peut jamais déclarer `PAYMENT_CONFIRMED`.

## Droits et contrats après livraison

V0.7.2 remplace le flux runtime historique `CommercialLicense` par `RightsRequest`. L’ancien modèle demeure une archive additive en lecture seule afin de ne pas effacer l’historique ; aucune route ne l’écrit. Une commande `DELIVERED`, payée et dotée d’un master privé publié peut ouvrir une licence de publication à 150 € ou un partenariat d’exploitation à 1 500 €. Les montants sont des snapshots serveur et aucun paiement de droits n’est disponible.

Les coordonnées confirmées, contributions déclarées, paramètres structurés, échanges, modèles versionnés, PDF privés, acceptations et événements disposent de relations distinctes. Une contrainte partielle interdit deux demandes actives du même type pour une Order. Un brouillon sans document peut être supprimé ; une demande soumise peut être annulée en conservant son historique. Les documents acceptés sont protégés contre la suppression et toute correction crée une nouvelle version.

Le Legal Review Gate conserve les modèles en `DRAFT` ou `AWAITING_LEGAL_REVIEW` tant qu’un ADMIN n’enregistre pas une revue juridique professionnelle référencée. Aucun état `ACTIVE` n’est accessible dans V0.7.2, y compris directement en base. Aucun rôle d’auteur, transfert de droit moral, quote-part SACEM ou proposition 70/30 n’est déduit automatiquement. Voir [`docs/RIGHTS.md`](RIGHTS.md), [`docs/CONTRACTS.md`](CONTRACTS.md) et [`docs/LEGAL_REVIEW_GATE.md`](LEGAL_REVIEW_GATE.md).

## Livraison audio privée

V0.7.1 active un master MP3/WAV privé lié à la commande par le rôle `DELIVERY`. Seul l’ADMIN peut le déposer ou le remplacer, sur une Order payée encore en cours, après validation de la taille (200 Mo maximum), de l’extension, du MIME, de la signature et du flux audio par FFmpeg. Le binaire vit uniquement dans R2 privé sous une clé opaque et ne part jamais vers Stripe.

La publication vers `DELIVERED` exige exactement un master actif. Le propriétaire et l’ADMIN le servent via l’application ; l’accès membre exige aussi la propriété, le statut livré et `downloadExpiresAt` futur. La fenêtre initiale est de six mois à partir de `deliveredAt`. Un remplacement avant clôture est audité et atomique ; une future purge devra toujours préserver les obligations comptables et la traçabilité minimale.

## Paiements, facture et LNX Gestion

Le paiement Stripe de la création reste lié exclusivement à `Order`. V0.7.2 ne crée aucun `Payment`, Checkout ou PaymentIntent pour `RightsRequest`; `READY_FOR_PAYMENT` signifie seulement que les validations internes sont réunies pour une future étape encore fermée. Un futur modèle de facturation devra avoir sa propre séquence légale, être immuable après émission et refléter le régime fiscal réellement validé. Une référence de commande ou de contrat n’est pas un numéro de facture.

LNX Gestion pourra recevoir des événements métier via une intégration authentifiée et idempotente, jamais par accès direct à la base. Les données minimales, la responsabilité du système source, les reprises et les échecs devront être spécifiés séparément.

Avant toute activation commerciale, il faut confirmer le régime de TVA associé au numéro communiqué `FR14106870850`, les mentions obligatoires, la rétractation, le commencement anticipé d’une prestation personnalisée, les annulations, remboursements, preuves de consentement, délais, licence et médiation.

## Notifications de commande

`OrderNotification` porte une outbox transactionnelle idempotente pour l’email propriétaire après paiement et l’email client après publication. Le transport s’exécute après la transaction métier ; son échec ne régresse ni Payment, ni Order. Aucun payload fournisseur, secret Stripe ou master n’est stocké/joint. Le canal SMS est préparé mais sans provider configuré.

## Tests et environnement jetable

Les tests de commande couvrent la grille courante v2 plafonnée à 60 €, la grille historique v1 plafonnée à 90 €, l’usage personnel versionné et le workflow de livraison. Les tests de contrats couvrent les tarifs serveur 150/1 500 €, l’éligibilité post-livraison, l’ownership, la concurrence, les snapshots, l’idempotence, le PDF privé, le hash, la réauthentification, la double validation, l’interdiction d’activation et l’absence de paiement. La suite runtime exige l’instance jetable exacte `lnx-studio-v072-test`, des identités `@example.invalid`, un stockage R2 simulé et Stripe absent ; elle nettoie cette base dans un `finally` et vérifie une postcondition vide.

## Données professionnelles confirmées

- Ludovic Mathon ;
- LNX Beats ;
- Entrepreneur individuel ;
- activité déclarée : Autre création artistique — 9003B ;
- SIREN : 106 870 850 ;
- SIRET : 106 870 850 00018 ;
- numéro de TVA communiqué : FR14106870850, régime à vérifier avant paiement et facturation.

Aucune adresse professionnelle n’est inventée ou publiée.
