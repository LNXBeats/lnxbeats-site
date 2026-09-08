# Droits et autorisations — V0.7.2

> Documentation d’architecture, pas consultation juridique. Toute ouverture publique exige la validation d’un professionnel du droit de la propriété intellectuelle.

## Trois niveaux séparés

1. **Création personnelle** — grille courante `2026-08-v2` : 20 €, 30 €, 50 € ou 60 € selon Illustration/Priorité. Les Orders historiques `2026-08-v1` conservent leurs montants de 50 €, 60 €, 80 € ou 90 €. La version tarifaire et la version acceptée des conditions d’usage personnel sont figées sur chaque `Order`. Elles ne valent pas autorisation de publier, distribuer, monétiser, revendiquer la qualité d’auteur/compositeur ou obtenir une quote-part SACEM.
2. **Licence de publication** — tarif cible serveur 150 € (`15_000` centimes). Elle prépare une autorisation délimitée par droits, destination, supports, territoire et durée. V0.7.2 n’encaisse rien.
3. **Partenariat d’exploitation** — tarif cible serveur 1 500 € (`150_000` centimes). Il ouvre une étude manuelle des contributions, rôles, IA et paramètres contractuels. Une proposition 70/30 est facultative, volontairement créée par l’Admin et non automatique.

Une demande exige un utilisateur actif et vérifié, propriétaire d’une `Order` payée, `DELIVERED`, possédant un master privé publié. Un autre membre obtient une réponse neutre ; l’Admin possède une vue dédiée. Une contrainte partielle PostgreSQL interdit deux demandes actives de même type pour une même commande.

## Workflow

Les statuts techniques sont traduits en libellés humains. Le workflow couvre brouillon, soumission, informations requises, étude, préautorisation, préparation/lecture du contrat, acceptations séparées, étape future de paiement, rejet et annulation. `ACTIVE` existe pour l’évolution du modèle mais un trigger V0.7.2 interdit toute insertion ou transition vers cet état.

Une licence peut précéder une étude de partenariat. Aucun remboursement, crédit ou réduction n’est calculé automatiquement. Une demande rejetée est historique ; une nouvelle demande peut être créée selon la contrainte d’unicité active.

## Contributions et SACEM

Les déclarations du client sont conservées comme affirmations à vérifier. L’Admin dispose de l’évaluation interne `NOT_REVIEWED`, `HUMAN_CONTRIBUTION_DOCUMENTED`, `LEGAL_REVIEW_REQUIRED`, `DECLARATION_NOT_RECOMMENDED` ou `POTENTIALLY_ELIGIBLE`.

Le produit ne calcule ni ne promet de répartition SACEM et ne soumet aucune déclaration. La formulation client reste conditionnelle : lorsque l’œuvre et les contributions sont éligibles, LNX Beats peut effectuer les démarches correspondant aux droits qu’il détient.

Références d’architecture : [CPI L121-1](https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000006278891/2021-07-12), [CPI L131-3](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006278958/2022-08-01) et [documentation SACEM sur l’apport créatif humain et les contenus assistés par IA](https://societe.sacem.fr/actuimg/fr/live/v4/Createurs-Editeurs/Actualites/2025/semestre_1_2025/Sacem_IA_FR.pdf). Ces références ne remplacent pas une analyse du dossier concret.

## V1.2 — readiness commerciale fail-closed

La V1.2 expose dans l’Admin un diagnostic par offre fondé sur les tarifs serveur et les modèles réellement présents. Ce diagnostic ne constitue ni une validation juridique, ni une ouverture commerciale. Ses états sont :

- `BLOCKED` : au moins un prérequis juridique ou technique manque ;
- `READY_NOT_OPEN` : tous les prérequis seraient démontrés, mais une ouverture explicite resterait nécessaire ;
- `OPEN` : état réservé à une évolution future. Le code actuel ne peut pas l’atteindre.

Les deux montants restent ceux des offres LNX Beats : 150 € pour la licence de publication et 1 500 € pour le partenariat d’exploitation. Les 1 500 € ne sont pas un tarif SACEM et ne garantissent ni l’éligibilité d’une œuvre, ni une déclaration, ni une répartition. Le prix est lu depuis `data/rights-offer.ts`; les formulaires client ne peuvent pas le redéfinir.

Le commerce reste `BLOCKED` même si une ligne `ContractTemplate` porte le statut `APPROVED`, pour les raisons techniques vérifiées suivantes :

1. `sourceMarkup`, objet de l’approbation versionnée, est validé et conservé dans le snapshot, mais le PDF est actuellement construit par les sections codées dans `lib/rights/document-presentation.ts`. Le contenu approuvé n’est donc pas encore lié au renderer effectif.
2. Les documents produits portent encore le statut et les clauses d’un projet non actif. Ils ne doivent pas devenir actifs par un simple changement de statut.
3. `Payment` et `Invoice` ne possèdent aucun rattachement à `RightsRequest`; aucun checkout, paiement, événement provider, facturation ou finaliseur d’activation Droits n’est implémenté.
4. PostgreSQL refuse toujours tout passage de `RightsRequest` ou `ContractDocument` à `ACTIVE`. Cette protection ne doit être remplacée que par une migration additive apportant des invariants au moins équivalents.

L’ouverture future devra lier de manière immuable le modèle juridiquement validé, le renderer réellement utilisé, le document exact et ses acceptations. Elle devra ensuite rattacher un paiement serveur au dossier, émettre la pièce comptable appropriée et finaliser l’activation de façon idempotente. Aucune de ces étapes ne peut être simulée par un bouton Admin ou une variable distante isolée.

Tant que cet état est `BLOCKED`, les cartes et formulaires de création d’une nouvelle demande ne sont pas exposés aux membres, et l’API membre refuse la création avant toute écriture. Une demande historique existante reste accessible à son propriétaire par sa route de suivi et conserve son prix/version figés ; elle n’est ni supprimée ni reconstruite depuis le tarif courant. Ce verrou de création est une constante de code fail-closed, pas un secret ni un réglage distant.

### Préparation SACEM : anomalie connue

`SACEM_PREPARATION` ne soumet rien à la SACEM. Une incohérence subsiste dans le workflow actuel : l’interface propose sa génération pour `ADMIN_VALIDATED` ou `READY_FOR_PAYMENT`, alors que le service rejette d’abord `READY_FOR_PAYMENT`; le parcours normal passe directement de l’acceptation client à `READY_FOR_PAYMENT`. L’audience est aussi à décider : le libellé décrit un document privé Admin, tandis que le lecteur de documents autorise actuellement le propriétaire de la commande. Aucune correction implicite n’est appliquée dans ce lot de readiness. La portée, l’audience et le moment de génération doivent être décidés avant toute utilisation réelle.

Cette section décrit des barrières techniques. Le contenu final des contrats, la nature juridique des offres, la rétractation, les annulations/remboursements, la fiscalité et toute démarche de gestion collective restent soumis à une décision humaine et à la revue du professionnel compétent.

## Non-rétroactivité

Les nouvelles conditions d’usage personnel sont stockées seulement lors de la finalisation des nouvelles commandes (`version`, hash SHA-256, timestamp serveur). Les commandes antérieures gardent des champs nuls : aucune acceptation ne leur est imputée artificiellement. Elles peuvent afficher l’information actuelle sans produire une preuve rétroactive.
