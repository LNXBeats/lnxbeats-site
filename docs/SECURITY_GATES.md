# Security gates — V0.7.2

## Prisma / deepmerge-ts

Versions relevées le 20 août 2026 :

- `prisma` 7.9.1 ;
- `@prisma/client` 7.9.1 ;
- `@prisma/config` 7.9.1 ;
- `deepmerge-ts` 7.1.5, dépendance transitive unique de `@prisma/config`.

`npm audit` rapporte [GHSA-ggr8-5vv4-36mx / CVE-2026-40345](https://github.com/advisories/GHSA-ggr8-5vv4-36mx) sur `deepmerge-ts < 8.0.0`. La correction existe en deepmerge-ts 8, mais la [dernière version Prisma stable installée, 7.9.1](https://github.com/prisma/prisma/releases/tag/7.9.1), fixe encore 7.1.5 et Prisma 8 n’est disponible qu’en release candidate. Aucun override incompatible et aucune RC ne sont introduits.

Reachability : le bundle applicatif n’importe pas `deepmerge-ts`. La dépendance est atteinte par la CLI/config Prisma ; `prisma.config.ts` construit un objet statique à partir de chaînes d’environnement et ne transmet pas de graphe récursif contrôlé par un utilisateur. Cela réduit la surface observée sans supprimer l’avis.

Décision : **PRODUCTION BLOCKED — SECURITY ADVISORY OPEN**. Un sprint sécurité séparé doit mettre à niveau Prisma dès qu’une version stable officiellement compatible avec deepmerge-ts 8 existe.

## Contrats

- authentification active + email vérifié ;
- propriété Order/demande/document, Admin distinct ;
- mutations same-origin et payload JSON borné ;
- prix/type serveur, champs inattendus refusés ;
- verrou advisory + contraintes uniques contre les doubles clics ;
- templates allowlistés, texte échappé, pas de code/HTML client ;
- PDF sans ressource distante ni JS ;
- hash SHA-256, Assets R2 privés, clés opaques ;
- documents acceptés immuables et non supprimables ;
- pas de Payment/Checkout/PaymentIntent pour les droits ;
- pas de donnée contractuelle envoyée à Stripe ;
- notifications droits limitées au transport `capture` avant validation humaine.

## Données et migrations

Migration additive uniquement ; aucun `reset`, `db push`, backfill d’acceptation ou modification des anciennes migrations. L’ancien `CommercialLicense` est conservé comme archive en lecture seule et importé une seule fois vers `RightsRequest` lors de la migration. Aucune source de vérité runtime ne l’écrit.

Les QA runtime doivent viser exclusivement `lnx-studio-v072-test`, avec preuve Prisma Dev exacte, PID vivant, PostgreSQL loopback non standard, comptes `@example.invalid`, transport capture et cleanup ciblé. La base personnelle exige inventaire + backup frais avant `prisma migrate deploy`.
