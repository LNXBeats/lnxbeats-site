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

## Non-rétroactivité

Les nouvelles conditions d’usage personnel sont stockées seulement lors de la finalisation des nouvelles commandes (`version`, hash SHA-256, timestamp serveur). Les commandes antérieures gardent des champs nuls : aucune acceptation ne leur est imputée artificiellement. Elles peuvent afficher l’information actuelle sans produire une preuve rétroactive.
