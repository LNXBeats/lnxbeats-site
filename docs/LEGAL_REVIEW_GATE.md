# Legal review gate

## Principe

`DRAFT → AWAITING_LEGAL_REVIEW → APPROVED → RETIRED` est un workflow versionné. L’approbation n’est pas un booléen d’environnement : elle exige une mutation Admin, un Admin actif, un timestamp et une référence de revue ; PostgreSQL la refuse sinon.

Tant que le modèle n’est pas approuvé :

- PDF filigrané « PROJET — NON ACTIF — VALIDATION JURIDIQUE REQUISE » ;
- aucun droit actif ;
- aucun paiement 150 €/1 500 € ;
- aucune déclaration SACEM définitive ;
- aucune présentation comme contrat définitif.

V0.7.2 va plus loin : deux triggers PostgreSQL refusent tout statut `ACTIVE` pour les demandes et documents, quel que soit l’appelant. Une future migration explicitement relue sera nécessaire pour ouvrir l’activation.

## Références d’architecture

- [CPI L131-3](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000006278958/2022-08-01) : chaque droit doit être distingué et son exploitation délimitée par étendue, destination, territoire et durée ; d’où `RightsGrant` plutôt qu’un texte unique.
- [CPI L121-1](https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000006278891/2021-07-12) : droit moral attaché à la personne, perpétuel, inaliénable et imprescriptible ; aucun transfert automatique.
- [Code civil 1127-2](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032007506/2026-03-16) : écran de vérification et correction avant acceptation.
- Code civil [1366](https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000032042461/2026-07-07) / [1367](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032042456/2026-05-11) : identité, intégrité et lien entre preuve et acte.
- Code de la consommation [L213-1](https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000032226994/2024-03-24), [D213-1](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032807208) / [D213-2](https://www.legifrance.gouv.fr/jorf/article_jo/JORFARTI000032798142) : conservation des contrats électroniques concernés.
- Code de la consommation [L221-18](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032226842?idSecParent=LEGISCTA000032226890) / [L221-28](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000044563170/2025-01-01) : rétractation et exceptions à qualifier, jamais pré-cochées ou inventées.

Ces textes sont des garde-fous de conception et non une consultation juridique. Une relecture par un professionnel de la propriété intellectuelle est obligatoire avant l’ouverture publique.
