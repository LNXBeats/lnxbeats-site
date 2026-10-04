# V4 — préparation de release, soutien fermé

Approbation visuelle explicite acquise. Aucun changement de DOM, assets, rendu,
players, mémoire, Photos/Format, worker ou pipelines audio/jukebox dans ce correctif.
Base de promotion : `dc0ae1b4d9dc3ac753477b82252938882e30ed82`.
Candidat visuel : `2cf378806ea2a73638853109c289d5757ce5c8db`.

## Sécurité Preview traitée en premier

Le 04/10/2026 à 10:51:06Z, rotation effective du mot de passe PostgreSQL Preview,
mise à jour des seuls consommateurs Preview, fermeture de l'ancienne connexion.
Nouvelle connexion fraîche : succès ; ancien authentifiant : rejet PostgreSQL
`28P01`. Aucune modification du credential Production ni du rôle propriétaire.
Web/worker Preview redéployés au même candidat existant ; 22 contrôles HTTP et
médias passent. Aucun secret dans ces preuves. Une ancienne sortie exposée ne
peut pas être déclarée effacée ; l'accès correspondant est révoqué.

## Migration et sauvegarde

Une seule migration nouvelle autorisée : `20261004010000_support_contributions`.
Trois tables, trois PK, dix indexes supplémentaires, trois FK et CHECK de domaine.
Aucune réécriture historique. `users` est référencée avec DELETE SET NULL ; les
relations internes utilisent DELETE RESTRICT. Montants 100–50000 cents, EUR,
mode TEST uniquement. Migration déjà utilisée en Preview laissée byte-identique.

Snapshot Production frais : 2026-10-04T11:07:10.730Z. PostgreSQL 18.6.
Dump custom chiffré age : 931136 octets ; clé séparée dans le Trousseau existant.
SHA-256 : `06bad39ae646831b218e2d3dcb894da074eefc153420d0a0a513d9a7fee81c93`.
Restauration réelle sur stockage FileVault : 78 tables, 373 indexes,
1161 contraintes, 12 triggers applicatifs, 7 séquences, 39 migrations.
Compteurs et digests de toutes les tables concordants. Ownership et ACL conservés.
Quatre CHECK reparsés localement produisent exactement la représentation restaurée.

Méthode EXISTING_DB_NO_CREATE : UTF8, locale Linux en_US.utf8 vers macOS
en_US.UTF-8. Aucun objet de collation métier spécifique ; preuve de récupération
des données/schéma, pas une certification d'identité des tris libc entre OS.
Une restauration Production future doit reproduire PostgreSQL/Linux/locale source.

Upgrade local : 39 → 40 migrations, 78 → 81 tables, trois tables soutien vides,
données et schéma historiques conservés. `prisma migrate status` propre.
47 contrôles de moindre privilège, deux runtimes distincts du propriétaire,
provisionnement quatre fois, ACL historiques inchangées. Dump clair/cluster/logs
sensibles supprimés après le test. Archives historiques conservées.

## Release fermée et retour arrière

Les flags soutien Production sont absents : défaut OFF, contexte Production
explicitement refusé même si les flags étaient activés. Aucun nouveau paiement,
checkout, webhook LIVE, produit, prix ou remboursement. Aucun cron soutien.
Paiements Commander/Boutique existants et leurs configurations conservés.

Le Web garde `prisma migrate deploy` puis `database:provision-creations-runtime`.
Le worker garde son build dédié et ne lance aucune migration. Le provisionneur
soutien ajoute seulement un groupe de lecture dédié (voir `lib/support/README.md`).

Gates locaux : npm ci standard, Prisma format/validate/generate, lint, types,
build Web et worker PASS ; canonique 1341 PASS / 0 FAIL / 1 SKIP préexistant.
Le test supplémentaire couvre le refus des routes soutien avant DB/provider.
Audit Production : 0 ; audit complet : cinq HIGH dev-only strictement identiques
à l'audit précédent. Aucun upgrade de dépendance ni audit-fix.

Rollback applicatif possible vers la base prérelease : migration additive,
anciens objets et permissions inchangés, aucune donnée de soutien au lancement.
Ne pas supprimer les tables ni restaurer la DB Production automatiquement.
Après tout rollback, vérifier les flags effectifs. Les identifiants de déploiement,
SHA final et smokes post-release sont consignés dans le rapport opérationnel.
