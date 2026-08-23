# Bootstrap Production contrôlé

V0.8.0.4 fournit trois CLI indépendants. Ils sont prêts dans le code mais **n'ont jamais été exécutés contre Production**. Ils ne sont appelés ni par le build, ni par `npm start`, ni par Prisma Migrate, et aucune route HTTP ne les expose.

## Invariants communs

Les trois outils sont dry-run par défaut. Ils exigent `NODE_ENV=production`, `LNX_DATABASE_TARGET=lnx-studio-production`, `AUTH_URL=https://www.lnxbeats.fr`, `APP_CANONICAL_URL=https://www.lnxbeats.fr` et une URL PostgreSQL distante ne portant aucun marqueur local, staging, QA ou test. L'apply nécessite en plus `--apply` et une confirmation exacte dédiée.

Les logs ne montrent ni `DATABASE_URL`, ni credential, ni mot de passe. Les confirmations sont des phrases d'armement non secrètes ; les mots de passe et credentials restent des secrets temporaires du coffre Railway.

## Premier ADMIN

Dry-run :

```bash
npm run admin:bootstrap:production
```

Apply contrôlé :

```bash
ADMIN_BOOTSTRAP_CONFIRM=bootstrap-first-production-admin \
ADMIN_BOOTSTRAP_PASSWORD=<temporary-secret> \
npm run admin:bootstrap:production -- --apply
```

`ADMIN_EMAIL` doit être l'adresse propriétaire déjà approuvée par le code. L'adresse est masquée dans les logs. Si le compte n'existe pas, une identité `ACTIVE`, vérifiée et `ADMIN` est créée avec le même Argon2id que Better Auth. Cette vérification administrative est une exception one-shot explicite : elle ne constitue pas une vérification publique par e-mail. Si un compte `MEMBER` vérifié et actif existe déjà, seul son rôle est promu ; son credential n'est pas remplacé. Un compte inactif ou non vérifié provoque un refus. Un ADMIN existant produit un no-op idempotent.

Supprimer `ADMIN_BOOTSTRAP_CONFIRM` et `ADMIN_BOOTSTRAP_PASSWORD` immédiatement après l'opération. Le script reste alors inerte sans confirmation.

## Catalogue canonique

La source canonique est la fixture versionnée et gelée `data/discography.ts`, version `v0.6.0.3-legacy-1`, soit 25 projets. La DB staging n'est jamais une source.

Dry-run :

```bash
npm run catalog:import:production
```

Apply :

```bash
CATALOG_PRODUCTION_CONFIRM=import-canonical-production-catalog \
npm run catalog:import:production -- --apply
```

L'import valide toutes les données avant écriture, refuse les marqueurs QA/staging, les projets inattendus et les divergences, puis crée uniquement les projets absents dans une transaction protégée par verrou advisory. Une deuxième exécution identique ne crée rien. Aucun update destructif et aucune suppression ne sont réalisés.

## Médias canoniques

`data/production-media-manifest.json` fige 14 identités : 10 covers WebP et 4 previews MP3, avec UUID, projet, rôle, taille, MIME, clé opaque et SHA-256. Les binaires restent hors Git dans la racine locale canonique contrôlée par `MEDIA_PRODUCTION_SOURCE_ROOT`.

Dry-run local et DB, sans appel R2 :

```bash
MEDIA_PRODUCTION_SOURCE_ROOT=<approved-canonical-media-root> \
npm run media:import:production
```

Apply :

```bash
MEDIA_PRODUCTION_SOURCE_ROOT=<approved-canonical-media-root> \
MEDIA_PRODUCTION_CONFIRM=import-canonical-production-media \
npm run media:import:production -- --apply
```

L'apply accepte uniquement `lnx-studio-production-public` et `lnx-studio-production-private`. Tout bucket staging/QA/test est refusé. Toutes les sources et tous les états DB sont validés avant le premier appel provider. Le provider ne possède aucune opération DELETE. Il inspecte chaque cible, skippe un contenu identique, refuse un contenu différent et crée une cible absente avec `If-None-Match: *`. Il ne remplace rien silencieusement.

Après les PUT vérifiés, les lignes `Asset` et `ProjectAsset` sont créées transactionnellement. Si la DB échoue après un PUT, l'objet n'est pas supprimé : le runbook impose un fix-forward et la relance reconnaît le checksum identique.

Le bucket public peut rester sans accès anonyme Cloudflare ; l'application sert les médias via ses propres routes. Le bucket privé reste privé et utilise les contrôles d'accès/signatures existants. Aucun domaine R2.dev n'est requis.

## Ordre Production futur

1. désactiver auto-deploy et maintenir paiements/notifications OFF ;
2. déployer le nouveau code avec `npx prisma migrate deploy` ;
3. vérifier `/api/health`, `payments:diagnostic` et `payments:preflight` en `SAFE_DISABLED` ;
4. prendre un backup PostgreSQL post-migrations ;
5. Admin dry-run, apply, suppression des variables temporaires et preuve de login ;
6. catalogue dry-run puis apply ;
7. média dry-run puis apply ;
8. deuxième dry-run catalogue/média pour prouver l'idempotence ;
9. QA publique, Auth/Admin et R2 ;
10. backup des données importées ;
11. seulement plus tard : revue juridique/comptable, notifications puis paiements Live via leurs gates propres.

## Ancien site

L'ancien `origin/main` écrivait `data/orders.json`, `data/contacts.json` et `uploads/` sous `PERSISTENT_ROOT`, ou dans la racine de l'application si cette variable était absente. La preuve humaine indique qu'aucun volume Railway et aucun `/data` ne sont présents. Les écritures runtime étaient donc éphémères entre redéploiements. Les deux JSON suivis dans Git sont des tableaux vides. Cela retire le gate hypothétique d'un volume `/data`, sans prétendre qu'aucune donnée historique n'a jamais existé ailleurs.

## Rollback et fix-forward

- Catalogue : transaction PostgreSQL, aucun demi-import silencieux.
- Média : aucune suppression R2 ; un PUT validé suivi d'un échec DB est repris par relance.
- Admin : verrou transactionnel et no-op idempotent.
- Aucune opération ne remet les migrations à zéro.
- Ne jamais importer les utilisateurs, commandes, paiements, contrats, notifications ou fixtures staging.
