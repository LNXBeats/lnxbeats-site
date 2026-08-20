# Contrats électroniques — V0.7.2

> Les documents fournis sont des projets techniques soumis à revue juridique. Aucun document non approuvé n’est présenté comme définitivement applicable.

## Données et versions

- `ContractTemplate` : type, version, source allowlistée, état `DRAFT` / `AWAITING_LEGAL_REVIEW` / `APPROVED` / `RETIRED`, approbateur Admin et référence de revue.
- `ContractPartySnapshot` : coordonnées privées versionnées et confirmation explicite. Une correction future ne réécrit pas le snapshot d’un document existant.
- `RightsGrant` : droit séparé, autorisation, exclusivité, destination, plateformes/supports, territoire, durée, monétisation, adaptation, publicité, synchronisation, Content ID, sous-licence, crédit et restrictions.
- `ContractDocument` : numéro stable, versions modèle/document, snapshot source, hash SHA-256, Asset privé et relation de remplacement.
- `ContractAcceptance` : compte, rôle client/Admin, nom saisi, hash du document, version, Order, demande, empreinte de session et éventuellement user-agent hashé.

Une acceptation client produit en plus un PDF privé `ACCEPTANCE_RECEIPT`. Cette preuve séparée reprend l'identité confirmée, la date serveur, le numéro et le hash exacts du document lu, sa version, l'Order et la demande. Elle ne remplace jamais le contrat accepté et ne qualifie pas l'action de signature électronique qualifiée.

Un modèle utilisé ne peut plus changer de type, version, titre ou source. Un document accepté ne peut plus être supprimé ni voir son contenu, sa version, son hash ou son Asset modifié. Une correction génère une nouvelle version et conserve l’ancienne.

## Legal review gate

Un modèle ne passe `APPROVED` qu’avec une action Admin authentifiée, une date, un Admin actif et une référence de revue juridique. Une contrainte/trigger PostgreSQL applique aussi la règle. Tant qu’il n’est pas approuvé, le PDF porte le filigrane :

`PROJET — NON ACTIF — VALIDATION JURIDIQUE REQUISE`

Même après acceptation QA, aucun droit ni paiement n’est activé en V0.7.2.

## Acceptation électronique

Le client doit être connecté, actif, email vérifié et propriétaire. Le document privé doit avoir été servi avec succès au compte avant l’acceptation. L’interface ne pré-coche rien et exige : lecture intégrale déclarée, accord explicite, nom exact et confirmation du mot de passe. Le serveur vérifie le hash Argon2, l’identité confirmée, le hash PDF et l’unicité de l’acceptation.

Pour un partenariat, la validation Admin est distincte. Elle n’active pas le contrat ; elle place seulement le dossier dans un état « prêt pour une étape future », sans bouton Payer.

Cette preuve n’est pas qualifiée de signature électronique qualifiée. Un prestataire spécialisé pourra être requis après revue juridique. Les [articles 1366](https://www.legifrance.gouv.fr/loda/article_lc/LEGIARTI000032042461/2026-07-07) et [1367](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032042456/2026-05-11) du Code civil guident l’identification, l’intégrité et le lien entre consentement et acte ; [l’article 1127-2](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032007506/2026-03-16) guide l’écran de vérification/correction préalable.

## Rétractation

V0.7.2 n’invente aucune exception et ne pré-coche aucune renonciation. La structure conserve les avertissements et prévoit une évolution après qualification juridique du service/contenu/personnalisation au regard des articles [L221-18](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000032226842?idSecParent=LEGISCTA000032226890) et [L221-28](https://www.legifrance.gouv.fr/codes/article_lc/LEGIARTI000044563170/2025-01-01) du Code de la consommation.
