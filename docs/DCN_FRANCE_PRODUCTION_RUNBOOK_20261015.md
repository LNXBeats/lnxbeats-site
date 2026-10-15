# Préparer la mise en service DCN en France

Ce plan ne lance aucune opération distante. Le commerce DCN reste local, TEST-only et fermé aux nouveaux paiements externes. Il réutilise l'EI, CM2C, les documents approuvés des autres activités et les recettes prestataires déjà acquises. L'OVH Free 100M reste BLOCKED et ne fait pas partie de ce lancement.

## Conditions préalables

1. Faire approuver le nouveau texte DCN France, ses trois choix explicites, sa garantie, sa confirmation durable et la politique de résidence. Les documents actuels restent DRAFT ; les afficher et les accepter en QA n'est pas une approbation juridique LIVE.
2. Faire confirmer les seules qualifications fiscales/sociales nouvelles dans `DCN_FRANCE_COMMERCIAL_FISCAL_DOSSIER_20261015.md`. Renseigner ensuite la règle exacte `FR-MET`, ses preuves privées, ses dates et le contrat approuvé. Aucun taux ou régime n'est inféré d'une ancienne réponse sur le soutien.
3. Préparer un premier vrai album via `DCN_FIRST_REAL_ALBUM_LAUNCH.md`, puis le complément de guide de ce lot : fichiers et cover réels, droits de chaque version, prix librement décidés, extraits écoutés, WAV/MP3 et deux ZIP contrôlés. Aucun tarif de maquette n'est définitif.

## Frontière technique encore fermée

`digitalEnabled` et `requireDigitalEnvironment` refusent LIVE ; les passerelles DCN et la génération documentaire sont TEST-only. Les notifications actuelles exigent le transport `capture` et des destinataires fictifs. Le complément gratuit est lui aussi limité à la capacité locale précise. Un déploiement ou un changement de flag seul ne peut donc pas ouvrir légalement le commerce.

Après les validations ci-dessus, un futur lot explicitement autorisé devra adapter **ces seules frontières DCN** : environnements, identité marchande, clés et signatures séparées, règles territoriales/contrat, séquences de facture/avoir et transport de confirmation. Réutiliser les abstractions fiables ; ne pas toucher aux flags ou aux webhooks des commandes, Boutique et soutien. Ne pas présumer que les credentials ou webhooks existants de ces autres domaines couvrent DCN.

Noms déjà utilisés à conserver, sans valeur dans les rapports : `DCN_ENABLED`, `DCN_MODE`, `DCN_NEW_PAYMENTS_ENABLED`, `DCN_EXTERNAL_TEST_AUTHORIZED`, `DCN_STRIPE_SECRET_KEY`, `DCN_STRIPE_ACCOUNT_ID`, `DCN_STRIPE_WEBHOOK_SECRET`, `DCN_PAYPAL_ENVIRONMENT`, `DCN_PAYPAL_CLIENT_ID`, `DCN_PAYPAL_CLIENT_SECRET`, `DCN_PAYPAL_MERCHANT_ID`, `DCN_PAYPAL_WEBHOOK_ID`. Vérifier les noms dans le code candidat avant toute future injection ; ne pas inventer une nouvelle convention ou réutiliser une clé LIVE en QA.

Le worker DCN audio/ZIP dédié doit conserver ses slots bornés, leases, reprise et plafonds disque/mémoire. Ne pas le remplacer par un travail lourd en requête Web. Les paramètres de stockage et d'e-mail devront être ceux déjà supportés par leurs adaptateurs, dans un environnement explicitement autorisé ; ce plan ne les modifie pas.

## Schéma et privilèges

Inventorier les migrations effectivement appliquées au moment de la future release, puis comparer au candidat ; aucune ancienne migration ne doit être éditée. La lignée DCN locale comprend commerce, fourniture, formats, crédits de complétion, règles territoriales, rétractation puis `20261015050000_digital_free_completion` et `20261015060000_digital_master_equivalence`. Ne pas les appliquer aveuglément en bloc sans comparaison Production.

La nouvelle migration distingue une attribution gratuite `GRANTED` d'un paiement. Elle autorise le zéro uniquement dans ce parcours et refuse tentative de paiement ou fausse facture pour cette attribution. Les historiques positifs et leurs documents ne sont pas réécrits. Son essai actuel concerne une **nouvelle copie QA locale**, pas une répétition de restauration Production.

La seconde migration remplace uniquement le corps du contrôle des crédits consommés. Elle conserve les contrôles historiques et accepte une équivalence directionnelle source → cible, même piste canonique, justifiée par un événement Admin append-only. L'application vérifie la dernière décision valide sous verrou partagé ; la migration ne se substitue pas à ce contrôle. Aucun droit acquis ni fichier n'est automatiquement transféré. Les éditions utilisant des identifiants de piste différents restent en revue manuelle. Révoquer une équivalence bloque un nouvel usage mais ne réécrit pas les acquisitions déjà figées.

Avant toute mutation Production future : sauvegarde fraîche chiffrée avec clé séparée, SHA-256, restauration réelle isolée, canaris historiques, upgrade SQL exact transactionnel et tests avec rôle runtime non propriétaire. Réutiliser `provisionDigitalRuntime`, sans GRANT global, ownership, DELETE ou DDL runtime. Préserver l'ACL des autres domaines. Imposer les sessions PostgreSQL UTC pour les nouvelles preuves DCN et comparer epoch SQL natif, ISO figé et lecture applicative.

## Recettes et publication futures

Rejouer uniquement les scénarios affectés sur les environnements nommément autorisés : version de contrat France, première fourniture, complément zéro/payé, incohérences de résidence et vrai catalogue. Les anciennes preuves Stripe TEST, PayPal SANDBOX, R2 et Safari Mac restent conservées avec leur SHA et périmètre ; elles ne sont ni relancées ici, ni étendues fictivement au nouveau code. Safari iPhone reste NOT_RUN, validation facultative différée.

Définir le SHA/tree final, relire le diff avec le main réel, exécuter les gates utiles, autoriser séparément push/promotion/déploiement, puis vérifier tous les services au même SHA. Ce lot n'autorise ni fetch réseau, ni push, ni fusion, ni Preview distante.

Smokes post-déploiement à prévoir : health, discographie/album, panier numérique et physique séparés, compte vérifié, France/Corse seules, autres résidences refusées avant engagement, conditions exactes, confirmations, bibliothèque privée et refus autre utilisateur, extraits publics seulement, WAV/MP3 et deux ZIP acquis, Administration des droits et prévisualisation privée. Aucun faux achat LIVE ni remboursement de recette. Boutique physique, Commander, Créations, Rights, soutien, Ads OFF, médias privés, jukebox et mémoire doivent rester inchangés.

## Retour arrière compatible

Fermer d'abord **les nouveaux achats DCN**, sans empêcher la réception des événements financiers, la réconciliation, les documents et les accès déjà acquis. Conserver commandes, crédits consommés, événements, factures/avoirs et fichiers versionnés. Aucun paiement n'est effacé ou remboursé automatiquement.

La migration zéro élargit les états lus par l'application : un binaire antérieur ignorant `GRANTED` ne doit pas être redéployé après une attribution gratuite sans revue de compatibilité. Le rollback doit également savoir lire les preuves d'équivalence figées sans les réinterpréter ni restituer leurs crédits. Préparer un candidat de rollback qui ferme les nouvelles attributions tout en sachant lire ces états. Ne pas restaurer une ancienne base par-dessus des transactions récentes, ni supprimer les attributions pour satisfaire un ancien CHECK. Tester cette fermeture sur copie avant ouverture LIVE.

## Seules autorisations restantes

- Validation humaine des nouveaux documents et du traitement fiscal/social DCN France.
- Fichiers réels, preuves de droits et prix saisis par LNX pour le premier catalogue.
- Autorisation future de configuration/recette externe affectée, de sauvegarde/upgrade et de promotion Production.

Aucune nouvelle adhésion CM2C, création d'entreprise, démarche mondiale, Merchant of Record ou reprise OVH n'est nécessaire à cette checklist. Le lancement n'est pas déclaré prêt Production.
