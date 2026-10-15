# DCN — résidence France, workflow local V2

15 octobre 2026. Préparation locale uniquement, sans approbation fiscale/juridique et sans ouverture DCN LIVE. La politique V1 et les acquisitions antérieures restent conservées ; ce document décrit le nouveau workflow `DCN-FR-RESIDENCE-2` pour les nouveaux engagements.

## Correction opérationnelle livrée

Le contrôle V1 exigeait une preuve serveur mais ne livrait aucun moyen d'enregistrer la déclaration et sa revue. V2 ajoute un parcours privé utilisable, sans prétendre transformer deux déclarations en preuve indépendante et sans système KYC systématique :

1. Dans le checkout, le client authentifié enregistre sa déclaration et une adresse minimale : numéro/voie ou lieu-dit, code postal, ville, pays fixé à `FR`. Le code postal de facturation reste distinct. Aucun téléphone, date de naissance, nationalité, photo ou pièce d'identité n'est demandé.
2. Le serveur normalise l'adresse, exige un compte actif et un e-mail vérifié, refuse outre-mer/Monaco/CEDEX et enregistre un nouvel événement privé append-only `FR_RESIDENCE_DECLARED_V2`. Le pays et les deux codes postaux sont métropole/Corse seulement ; la syntaxe n'atteste pas l'existence ni la résidence effective.
3. L'Admin ouvre `/admin/musique/residences`, puis la déclaration. Il voit uniquement les données nécessaires, le contexte de facturation réellement disponible et la décision précédente. Il peut laisser en revue, révoquer ou enregistrer une revue manuelle proportionnée avec motif, source d'examen et attestation explicite. Une référence privée opaque est facultative ; aucune copie d'identité n'est imposée.
4. Sans examen valide, le nouvel engagement reste bloqué, y compris depuis la nouvelle interface QA. Une décision Admin `VERIFIED` ne valide ni fiscalité, ni contrats, ni tarifs et n'ouvre aucun paiement LIVE.

Un échange proportionné avec le client ou l'examen d'un dossier existant doit être réellement effectué par l'opérateur avant son attestation. Le logiciel ne prétend pas que cet examen a déjà eu lieu pour un vrai client. L'échéance choisie (1 à 365 jours, 90 proposé dans l'interface) est un paramètre opérationnel local, **pas une durée légale approuvée**.

## Facturation disponible, absence et conflit

Ce service lit au maximum les dix dernières factures DCN TEST immuables appartenant au seul utilisateur concerné. Il vérifie leur hash et ne consulte ni objets privés, ni factures d'autres clients, ni API prestataire. Les anciennes factures DCN ne contenant aucune adresse restent `ABSENT` : aucune adresse n'est inventée ou ajoutée rétroactivement. L'absence n'est ni une contradiction ni une preuve.

Une adresse de facture saisie par le client reste une donnée **déclarative locale**, pas une adresse confirmée par Stripe/PayPal. Si le contexte disponible correspond au pays/code postal de facturation déclaré, il porte l'état `DECLARED_LOCAL_CONSISTENT`, pas « preuve indépendante ». La plus récente adresse de facture disponible donne le statut de cohérence ; les projections et hashes des autres factures chargées restent attachés au contexte affiché pour examen.

Adresse ancienne différente, code ultramarin ou pays étranger produit `CONFLICT`. Aucun déblocage automatique : seule une revue fraîche par un Admin actif/vérifié peut résoudre explicitement cette incohérence, avec motif documenté, attestation et hash exact du contexte. Un changement légitime d'adresse peut ainsi être examiné sans imposer systématiquement une pièce d'identité. Le territoire courant doit toujours rester métropole/Corse. Les informations de facturation déjà présentes dans les réponses de paiement peuvent être contrôlées séparément par les hooks commerciaux, sans nouvelle requête API ni inférence « pays de carte = résidence ».

## Concurrence, intégrité et historique

- Déclaration et revue prennent le même verrou utilisateur transactionnel `digital-user:<id>` que le checkout. Aucune transaction réseau n'est ajoutée.
- Chaque mutation porte une clé d'idempotence et l'identifiant du dernier état connu. Une page obsolète ne remplace pas silencieusement une nouvelle déclaration/revue. Un retry ancien ne ressuscite pas l'ancien état ; il renvoie le dernier état effectif ou un conflit bloquant.
- Une déclaration ne peut être remplacée pendant un engagement `PENDING`, `REQUIRES_REVIEW` ou `DISPUTED`. Une révocation Admin reste traçable ; les hooks revalident la dernière preuve avant une nouvelle capture/première fourniture.
- Le serveur relit l'acteur Admin en base, les dates, l'échéance et les hashes ; une entrée `REVIEW`/`REVOKED`, expirée, altérée ou issue d'un acteur désactivé bloque. Le JSON client ne peut fournir ni acteur, ni statut vérifié, ni approbation, ni preuve PSP.
- Le snapshot de checkout `franceResidenceV2` ne contient que les identifiants/hashes de déclaration et de revue, pays/codes postaux, dates et identifiants de factures gelés. Aucune voie, ville, note de revue ou référence privée complète n'y est copiée.
- Les identifiants de factures sont gelés et relus à l'identique : la première facture générée après paiement ne provoque pas une boucle de revalidation. Une facture gelée disparue ou modifiée bloque. Une liste vide gelée ne se transforme pas en nouvelle recherche implicite.
- Les anciens snapshots V1 et droits déjà délivrés ne sont ni réécrits, ni supprimés, ni soumis rétroactivement à un nouveau contrôle d'adresse pour télécharger les achats déjà acquis.

## Confidentialité et conservation

Une adresse et son hash sont des **données personnelles** ; le hash est une pseudonymisation, jamais une anonymisation. L'adresse complète demeure dans le journal privé de déclaration et la réponse privée au titulaire/à l'Admin habilité, pas dans les URL, logs, pages publiques, rapports ou captures. Les réponses API portent `private, no-store` ; les mutations exigent origine autorisée, session, rate-limit et contrôle frais côté service.

Le lot n'exporte aucune adresse réelle et ne collecte aucune pièce. La base légale, l'information du client, les habilitations, la durée de conservation et le traitement d'une demande d'effacement doivent être validés pour le nouveau commerce DCN. Aucun nettoyage historique automatique ou destructif n'est exécuté. Une éventuelle adresse nécessaire sur un futur justificatif doit rester limitée à cette finalité et versionnée sans modification des factures passées.

## Modules et contrôles locaux

- `lib/digital/france-residence-v2-policy.ts` : normalisation, contexte de facture, intégrité, évaluation et snapshot pur fail-closed.
- `lib/digital/france-residence-v2-service.ts` : chargement privé, déclaration/revue append-only, idempotence et revalidation.
- `/api/digital/residence` : GET du titulaire et POST de déclaration ; `/api/admin/digital/residence-reviews` : POST Admin.
- `components/digital-checkout.tsx`, `components/digital-residence-review.tsx` et `/admin/musique/residences[/<id>]` : collecte minimale et examen privé.
- Le raccordement commercial reste dans `checkout-jurisdiction.ts` : nouvelles commandes V2 ; ancienne V1 préservée ; contexte local QA exactement borné. Aucun pays LIVE approuvé n'est inséré dans le registre.

Commande exécutée :

```sh
NODE_OPTIONS=--conditions=react-server node --import tsx --test tests/digital/france-residence-v2.test.ts tests/digital/france-launch.test.ts tests/digital/france-checkout.test.ts
```

**40 PASS, 0 FAIL, 0 SKIP**, dont 21 nouveaux tests V2. Tests des fonctions/services/hooks réels avec doubles de dépôt uniquement : aucun PostgreSQL réel ni vrai client examiné, aucun PSP, réseau, e-mail ou approbation juridique. Cas couverts : minimisation/Corse/outre-mer/CEDEX, injection client, propriétaire, compte frais, acteur Admin frais, revue/échéance/révocation, conflit explicite, snapshots minimisés, déclaration remplacée/retry, état expiré non affiché `VERIFIED`, documents propres et immuables, conservation du binding après première facture, hooks de réservation/retry/pré-capture et fermeture DRAFT malgré revue valide.

Les contrôles SQL de concurrence réels et la recette navigateur de ce nouveau formulaire sont distincts : ils ne sont pas marqués PASS par ces doubles. Aucun acquis Stripe/R2/Safari précédent n'est relancé.

**État : workflow local livré ; aucune résidence réelle validée par l'agent ; aucune ouverture commerciale ou Production.**
