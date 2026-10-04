# Premium Public VFinal — livraison et limites

## Périmètre

Lot isolé issu de Premium `655f41e`. La promotion doit attendre la clôture du
lot worker/audio/jukebox puis intégrer son main réel, sans écraser ses corrections.
Les pages existantes et leurs domaines métier sont conservés. Les changements
Commander sont uniquement rédactionnels/visuels, pas les six étapes ni les photos.

## Revue des références

Avant : Accueil, Discographie, Album, Créations, Commander, Boutique, À propos,
Contact et navigation classés PARTIAL visuellement, même lorsqu'ils fonctionnaient.
Compte, produit et fiche Création sont conservés et contrôlés en non-régression.

Après : composition éditoriale Accueil (pochette, histoire, player, univers,
plateformes), cartes Boutique verticales et album cover-first. Identité noir,
charbon et or, sans nouvelle iconographie générée. Les deux assets exacts du pack
restent byte-identiques aux fichiers source déjà présents dans `public/assets/v3`.
Le JPEG du logo garde son fond blanc original dans la section éditoriale ; le
logo transparent déjà approuvé reste au header pour éviter une plaque blanche.

Les données figurant dans les maquettes ne sont pas importées : catalogue réel
en Production, données synthétiques explicitement QA dans la recette locale.
Les compteurs, titres, prix et couvertures ne sont jamais inventés pour imiter
une maquette. Les liens DistroKid et les flux Boutique restent inchangés.

Recette navigateur aux largeurs 390, 768, 1440 et 1920 : aucun overflow de page.
Les cartes Boutique sont en deux colonnes jusqu'à 900px, leurs boutons font
48px, les liens d'action au moins 44px. Le player Accueil utilise toute la largeur
de sa colonne ; aucune logique de lecture/sélection n'est modifiée.
Les captures desktop sont enregistrées à demi-échelle par l'outil navigateur,
avec le viewport CSS exact relevé séparément. Elles ne sont pas des maquettes.
La recette physique Safari/iPhone de ce nouveau lot reste PENDING.

## Soutien : activation séparée

`/soutenir`, section Accueil et lien footer sont conditionnés par le flag.
Le registre Admin reste consultable lorsque la collecte est désactivée.
La livraison est volontairement TEST/SANDBOX uniquement, **OFF en Production**.
Un flag seul ne suffit pas : contexte Production et credentials Live sont refusés,
et le CHECK de la base impose TEST. Aucun paiement Live QA n'est autorisé.

Le soutien libre ne crée ni commande, facture, reçu fiscal, droit, priorité,
avantage, email ou consentement marketing. Le texte fiscal n'affirme pas une
exonération fiscale/TVA ; la qualification des recettes reste au conseil comptable.
Les registres/export affichent montants bruts, statut et références, pas de frais
nets inventés. Vue/export bornés aux 200 dernières écritures, explicitement indiqués.

Architecture, variables et webhooks dédiés : `lib/support/README.md`.
Migration additive unique : `20261004010000_support_contributions` (trois tables).
Les anciennes migrations ne changent pas. Pour la release fermée, le groupe
dédié `lnx_support_readonly` reçoit seulement SELECT sur le registre et ses
événements ; aucun droit sur les tentatives, aucune écriture. Le groupe Créations
ne porte aucun privilège soutien. Une future ouverture TEST exige son propre
provisionnement revu ; le provisionneur de release n'ouvre aucun encaissement.

## Preuves et réserves

Tests de signature Stripe SDK et transport PayPal simulé : preuves de code,
pas de transactions chez les prestataires. Tests PostgreSQL local réels :
concurrence, reprise, idempotence, propriétaire opaque et invariants financiers.
HTTP local : origine, limites de montant, session opaque et accès Admin.
Navigateur : presets 3/5/10/20, montant personnalisé, erreur maîtrisée, retry/reload
réutilisant une seule contribution et zéro session provider.

La Preview ne disposait pas des credentials des deux providers lors de l'inventaire.
Les recettes Stripe TEST et PayPal SANDBOX réelles restent donc PENDING ; aucune
simulation n'est comptée comme un règlement réel. Le pack autorise explicitement
la publication visuelle avec Soutien OFF tant que ces gates ne sont pas acquis.

## Gate de promotion

Réconciliation main, tests du SHA final, Preview Web/worker au même SHA, nouvelle
sauvegarde chiffrée et restauration réelle, test de l'unique migration sur copie
restaurée, vérification du patch mémoire vide, puis seulement push fast-forward.
Pre-deploy Web conservé : Prisma migrate deploy puis provisionnement runtime.
Aucune migration depuis le worker. Aucun import de fixtures QA en Production.
Pas de rollback DB automatique ; rollback applicatif seulement après contrôle
de compatibilité de l'ancien code avec le schéma additif.
