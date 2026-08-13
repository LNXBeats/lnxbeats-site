# Déploiement Railway

Ce document prépare le déploiement sans l’exécuter. Aucun domaine, DNS ou environnement de production n’est modifié dans le sprint V0.1.1.

## Configuration attendue

- Node.js 20.9 ou supérieur ;
- installation avec `npm ci` ;
- build avec `npm run build` ;
- démarrage avec `npm start` ;
- healthcheck `GET /api/health` ;
- variable publique serveur `SITE_URL=https://lnxbeats.fr` ;
- stockage média objet obligatoire (`MEDIA_STORAGE_DRIVER=s3`) avec deux buckets distincts ;
- `PORT` fourni automatiquement par Railway.

Le fichier `railway.toml` sélectionne Railpack, le start command et le healthcheck.

## Vérification avant déploiement

1. Confirmer que la branche à déployer n’est pas `main` tant que la V0.1.1 n’est pas validée.
2. Exécuter `npm ci`, `npm run lint`, `npm run typecheck` et `npm run build` dans un environnement propre.
3. Démarrer le build et exécuter `npm run test:smoke` contre son URL.
4. Vérifier visuellement les formats mobile, tablette et desktop.
5. Confirmer que `/api/health` retourne HTTP 200 avec `{"ok":true,"service":"lnx-studio"}`.
6. Vérifier que seules les variables documentées sont présentes.
7. Vérifier la présence de `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy` et `Permissions-Policy` sur les réponses publiques.
8. Valider la terminaison HTTPS et tous les sous-domaines avant d’activer HSTS ; ne pas utiliser `includeSubDomains` sans cet inventaire.
9. Demander une validation humaine avant tout déploiement de production.

## Médias durables

Railway ne doit jamais porter les covers, previews ou références privées sur son filesystem. Configurer les variables `MEDIA_*` détaillées dans [MEDIA_STORAGE.md](MEDIA_STORAGE.md), avec un bucket public et un bucket privé distincts, avant de lancer une migration. Le démarrage refuse explicitement le pilote local lorsqu’un environnement Railway est détecté.

La séquence d’activation est : backup local, dry-run, création des buckets/policies/credentials de staging, migration staging, tests HTTP et IDOR, puis procédure séparée de production. Ne jamais placer les secrets S3 dans une variable `NEXT_PUBLIC_*`, ni utiliser le bucket privé comme origine publique. Railway, R2 et DNS ne sont pas modifiés par V0.6.3.

## Rollback

Railway doit conserver le déploiement précédent. Le code du prototype antérieur reste également récupérable par son commit Git de départ, documenté dans le rapport du sprint.

Ne jamais employer un push forcé, supprimer un domaine Railway ou modifier les DNS OVH pour effectuer un rollback applicatif.

## Évolutions futures

Les variables de paiement ne seront ajoutées qu’avec la fonctionnalité correspondante. Tous les secrets restent dans Railway ou le fichier local ignoré, jamais dans le dépôt ni dans une variable `NEXT_PUBLIC_*`.
