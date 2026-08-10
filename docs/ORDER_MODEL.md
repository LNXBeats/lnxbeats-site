# Commandes personnalisées — V0.6

## Décision et frontière

La V0.6 transforme Commander en un parcours membre réel : brouillon privé, sauvegarde, reprise, suppression, photos de référence, calcul serveur, finalisation et suivi. Une finalisation produit une `Order` au statut `AWAITING_PAYMENT` et un événement client horodaté. Elle ne prouve ni paiement, ni acceptation artistique, ni démarrage de la prestation.

Aucun paiement, secret marchand, SDK PSP, webhook, facture ou email transactionnel n’est actif.

`Wero — moyen de paiement potentiel à évaluer dans le sprint paiement selon disponibilité technique et commerciale au moment de l’intégration.`

## Offre et prix

Tous les montants sont calculés côté serveur en centimes entiers, en EUR, puis figés dans la commande avec `pricingVersion = 2026-08-v1` :

| Élément | Montant |
| --- | ---: |
| Création pour usage personnel | 50 € |
| Exploitation commerciale étendue | 1 500 € au total pour la base |
| Cover | +10 € |
| Traitement prioritaire | +30 € |

Le serveur ignore tout prix envoyé par le client et persiste séparément base, cover, priorité et total. L’usage commercial place `contractRequired` à `true` : l’exploitation demeure interdite tant qu’un contrat spécifique n’a pas été conclu. Cette formulation ne transfère pas les droits moraux, ne promet pas une cession universelle et ne suppose aucune affiliation ou gestion automatique par la SACEM.

Le modèle prévoit un retour inclus (`revisionAllowance = 1`). Le délai public reste indicatif ; la priorité n’est pas une promesse automatique de date.

## Parcours membre

1. Un compte actif et vérifié ouvre ou crée un brouillon.
2. Le brief est sauvegardé explicitement en PostgreSQL ; aucune histoire sensible n’est déposée dans `localStorage`.
3. Les photos sont contrôlées puis ajoutées au brouillon privé.
4. Le serveur valide de nouveau le brief, recalcule le prix et finalise atomiquement la commande.
5. Le statut devient `AWAITING_PAYMENT`. La page privée présente le prix comme calculé mais rappelle que le paiement n’est pas disponible.

Seul un brouillon peut être modifié ou supprimé par le membre. La suppression efface ses jointures et ses fichiers privés orphelins. Une finalisation incomplète échoue sans transition partielle.

## Numéro et concurrence

Les références suivent `LNX-AAAA-NNNNNN`. Une séquence PostgreSQL dédiée garantit l’unicité sous concurrence ; elle n’est jamais calculée à partir d’un `count()` ni d’un dernier numéro lu par l’application. Les trous éventuels sont acceptables : une référence attribuée n’est pas recyclée.

## Autorisation et confidentialité

Chaque lecture ou mutation relit l’utilisateur depuis la session serveur. Un membre ne voit que les commandes dont `userId` correspond exactement à son compte. Un administrateur actif peut accéder au même service par une décision explicite côté serveur. Les absences et refus de propriété utilisent une réponse neutre afin de limiter l’énumération des références.

Les routes privées et leurs images sont dynamiques, `noindex`, hors sitemap et protégées contre l’IDOR. Les notes `INTERNAL` d’un `OrderEvent` ne sont jamais sérialisées vers le client ; seuls les événements `CLIENT` alimentent la timeline membre.

## Photos de référence

Les règles sont cumulatives :

- 10 photos maximum par commande ;
- 10 Mio maximum par fichier avant décodage ;
- JPEG, PNG ou WebP uniquement ;
- extension, `Content-Type`, signature binaire et décodage réel cohérents ;
- dimensions maximales 12 000 × 12 000 et 40 millions de pixels ;
- nom original traité comme une information d’affichage nettoyée, jamais comme un chemin ;
- clé de stockage générée par UUID côté serveur ;
- réencodage WebP et retrait des métadonnées EXIF ;
- contenu binaire hors PostgreSQL et hors `public/` ;
- service uniquement après autorisation du propriétaire ou de l’administration.

La V0.6 fournit seulement un adaptateur de stockage privé local pour développement et QA. Il refuse la production. Un stockage objet privé futur devra conserver la même interface, des clés non prévisibles et des URLs éphémères ou un proxy autorisé.

Le membre confirme qu’il peut communiquer les images et qu’elles concernent le projet. Cette confirmation ne remplace pas une analyse juridique des droits à l’image, de la conservation ni des demandes d’effacement.

Le décodage/réencodage réduit la surface d’attaque mais ne constitue pas une promesse « sans virus ». Un scan antivirus devra être évalué avant d’accepter d’autres formats ou documents.

## Limites du brief

L’histoire principale accepte 30 à 10 000 caractères. Le titre de repère est limité à 120 caractères ; destinataire et contexte à 200 ; direction et émotion à 500 ; détails à 4 000 ; mots à préserver et éléments à éviter à 2 000 ; prononciations à 1 000. Le JSON complet est borné à 128 Kio avant parsing. React affiche ces textes comme texte échappé, sans Markdown ni HTML utilisateur.

## Statuts

| Statut | Présentation client | Usage |
| --- | --- | --- |
| `DRAFT` | Brouillon | Modifiable et supprimable par son propriétaire. |
| `AWAITING_PAYMENT` | En attente de paiement | Demande finalisée ; aucun paiement encore disponible. |
| `PAYMENT_CONFIRMED` | Paiement confirmé | Réservé à une future preuve serveur. |
| `SUBMITTED` / `RECEIVED` | Histoire reçue | Réception métier. |
| `REVIEWING` | En cours d’étude | Analyse par LNX Beats. |
| `ACCEPTED` | Projet accepté | Périmètre accepté. |
| `IN_PROGRESS` | Création en cours | Service commencé. |
| `FIRST_VERSION_READY` | Première version prête | Version soumise au retour prévu. |
| `REVISION_REQUESTED` | Retour demandé | Retour inclus consommé selon les règles serveur. |
| `FINALIZING` | Finalisation | Préparation de la livraison. |
| `DELIVERED` | Livré | Livraison privée future. |
| `REFUSED` | Demande refusée | Le projet n’est pas accepté. |
| `CANCELLED` | Demande annulée | Projet arrêté. |
| `REFUND_PENDING` / `REFUNDED` | Remboursement | Réservé à une architecture de paiement future. |

Les transitions futures doivent passer par un service central, valider l’état précédent, appliquer les règles de révision et produire un `OrderEvent` dans la même transaction. Un bouton client ne peut jamais déclarer `PAYMENT_CONFIRMED`.

## Livraison WAV future

La cible produit est un WAV privé lié à la commande, visible seulement par son propriétaire et l’administration, pendant six mois à partir de `deliveredAt`. Le modèle impose la cohérence de `downloadExpiresAt`, mais aucun fichier audio, bouton ou URL de livraison n’est actif en V0.6. Une purge ou révocation devra préserver les obligations comptables et la traçabilité minimale.

## Paiement, facture et LNX Gestion — futur

Un futur modèle `Payment` devra séparer intention, preuve fournisseur, montant, devise, idempotence, remboursements et rapprochement. Un futur modèle `Invoice` devra avoir sa propre séquence légale, être immuable après émission et refléter le régime fiscal réellement validé. Une référence de commande n’est pas un numéro de facture.

LNX Gestion pourra recevoir des événements métier via une intégration authentifiée et idempotente, jamais par accès direct à la base. Les données minimales, la responsabilité du système source, les reprises et les échecs devront être spécifiés séparément.

Avant toute activation commerciale, il faut confirmer le régime de TVA associé au numéro communiqué `FR14106870850`, les mentions obligatoires, la rétractation, le commencement anticipé d’une prestation personnalisée, les annulations, remboursements, preuves de consentement, délais, licence et médiation.

## Notifications futures

Les changements de commande peuvent justifier des messages transactionnels, séparés des alertes artistiques et du marketing. Chaque envoi futur devra être idempotent, traçable sans contenu sensible et déclenché seulement après commit de la transaction. Aucun email de commande n’est envoyé en V0.6.

## Tests et environnement jetable

Les tests purs couvrent prix, validation, référence, accès, révision et fichiers. La suite runtime exige l’instance locale Prisma Dev jetable `lnx-studio-v060-test`, des identités `@example.invalid`, un stockage sous `/private/tmp` et des gardes interdisant toute base distante ou production. Elle vérifie notamment concurrence, rollback, IDOR, événements et nettoyage.

## Données professionnelles confirmées

- Ludovic Mathon ;
- LNX Beats ;
- Entrepreneur individuel ;
- activité déclarée : Autre création artistique — 9003B ;
- SIREN : 106 870 850 ;
- SIRET : 106 870 850 00018 ;
- numéro de TVA communiqué : FR14106870850, régime à vérifier avant paiement et facturation.

Aucune adresse professionnelle n’est inventée ou publiée.
