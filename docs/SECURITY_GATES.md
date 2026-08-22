# Security gates

## Prisma / deepmerge-ts

État revu le 22 août 2026 :

- `prisma` 7.9.1 ;
- `@prisma/client` 7.9.1 ;
- `@prisma/config` 7.9.1 ;
- `deepmerge-ts` 8.0.2, dépendance transitive unique résolue par un override npm ciblé.

La dernière version Prisma stable reste 7.9.1 et fixe encore `deepmerge-ts` 7.1.5. V0.7.7 conserve Prisma 7.9.1, refuse Prisma 8 RC et impose `deepmerge-ts` 8.0.2 après un probe complet de compatibilité. L’installation complète et l’installation `--omit=dev` retournent zéro vulnérabilité.

Reachability : le bundle applicatif n’importe pas `deepmerge-ts`. La dépendance est atteinte par la CLI/config Prisma ; `prisma.config.ts` construit un objet statique à partir de chaînes d’environnement et ne transmet pas de graphe récursif contrôlé par un utilisateur.

Décision : **SECURITY ADVISORY RESOLVED**. Les faits, probes, limites de l’override et conditions de retrait sont consignés dans [SECURITY_ADVISORIES.md](SECURITY_ADVISORIES.md).

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
