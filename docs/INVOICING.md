# Facturation LNX STUDIO — fondation Phase 4B

> Fondation locale/QA. Les PDFs portent « DOCUMENT QA — SANS VALEUR COMPTABLE ». Aucun document Phase 4B n’est activé en Production.

## Déclencheur et atomicité

Une facture est créée uniquement dans la transaction PostgreSQL qui confirme un `Payment` `SUCCEEDED` et son parent (`Order` ou `ShopOrder`). Un paiement pending, failed, canceled ou expired ne produit aucun document. L’échec de l’émission annule la confirmation locale, l’événement métier et l’outbox dans la même transaction.

## Numérotation et immutabilité

La séquence PostgreSQL globale `invoice_sequence` produit `LNX-AAAAMMJJ-NNNN`; la date est celle d’Europe/Paris et le compteur ne repart pas à zéro. `credit_note_sequence` produit indépendamment `AV-LNX-AAAAMMJJ-NNNN`. Les contraintes uniques et verrous advisory assurent l’idempotence. Les triggers PostgreSQL refusent tout `UPDATE` ou `DELETE` sur une facture ou un avoir émis.

Les séquences PostgreSQL ne réutilisent pas une valeur consommée par une transaction ensuite annulée : un trou justifiable peut donc exister, sans collision ni renumérotation. La Phase 4B ne livre volontairement aucun mutateur de séquence Production. Avant activation, l’inventaire comptable humain fixe les deux prochaines valeurs ; toute future commande de bootstrap devra être dry-run par défaut, refuser une valeur inférieure au maximum archivé et exiger une confirmation Production exacte.

Une correction passe par un avoir. Plusieurs avoirs partiels sont possibles tant que leur somme ne dépasse jamais le total d’origine. Chaque remboursement fournisseur confirmé possède au plus un avoir via `refundAttemptId` et une clé d’idempotence stable.
Une rétractation acceptée peut être reliée explicitement à l’avoir ; le lien est vérifié contre le même parent métier et n’autorise jamais un remboursement fournisseur.

## Snapshots et montants

La facture conserve l’identité vendeur, l’identité client B2C/B2B, lignes, adresse de facturation lorsqu’elle existe, commande, paiement, prix, devise, frais de livraison, TVA, conditions acceptées et empreinte SHA-256. La Boutique reprend `shippingCents` de la `ShopOrder`; aucune grille courante n’est recalculée.

Régime snapshoté actuel : `FRANCHISE_EN_BASE_TVA`, TVA collectée 0, mention centralisée : « TVA non applicable, article 293 B du CGI ». Un changement fiscal futur crée de nouveaux snapshots sans modifier l’historique. Le numéro de TVA communiqué n’est pas utilisé comme preuve automatique d’assujettissement.

## B2C et B2B

Le client particulier n’a aucun champ professionnel. Un client professionnel doit fournir raison sociale et peut fournir SIREN/SIRET, adresse de facturation et numéro de TVA lorsque pertinent. Ces champs sont validés côté serveur et snapshotés ; ils ne confèrent aucun droit métier. Les CGV B2B finales restent soumises à revue.

## Accès et PDF

Les pages HTML essentielles sont disponibles dans le Compte et l’Admin. Les routes PDF exigent une session active et vérifiée ; un MEMBER ne peut accéder qu’aux parents qu’il possède, un ADMIN peut auditer le registre. Les réponses sont `private, no-store`, `nosniff`, `noindex`. Les numéros opaques par eux-mêmes ne contournent jamais l’autorisation. Chaque génération de PDF ajoute un événement d’audit, sans modifier le document.

## Conservation et sécurité

Factures, avoirs et pièces comptables : dix ans. Les purges de compte doivent les exclure. Ne jamais journaliser snapshot client, PDF, e-mail complet, adresse, identifiant fournisseur ou secret. Sauvegardes chiffrées, contrôles de restauration, restriction des accès et exports comptables restent des gates Production.

## Runbook Production futur

1. Revalider régime fiscal et identité vendeur auprès du professionnel comptable.
2. Inventorier toute facture émise hors système et choisir sans collision la prochaine séquence.
   La procédure reste humaine/conceptuelle dans cette phase : aucun `setval` Production exécutable n’est ajouté.
3. Faire approuver les templates, mentions B2C/B2B et CGV ; enregistrer versions/hashes.
4. Appliquer la migration sur un environnement de promotion contrôlé.
5. Vérifier séquences et triggers d’immutabilité.
6. Émettre une facture fictive autorisée, contrôler HTML/PDF et permissions.
7. Tester un avoir partiel puis total, idempotence et borne cumulée.
8. Vérifier sauvegarde/restauration et conservation dix ans.
9. Vérifier les obligations de facturation électronique avant ouverture.
10. N’activer les documents sans watermark qu’après décision humaine explicite.
