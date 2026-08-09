# Déploiement Railway

Ce document prépare le déploiement sans l’exécuter. Aucun domaine, DNS ou environnement de production n’est modifié dans le sprint V0.1.

## Configuration attendue

- Node.js 20.9 ou supérieur ;
- installation avec `npm ci` ;
- build avec `npm run build` ;
- démarrage avec `npm start` ;
- healthcheck `GET /api/health` ;
- variable publique serveur `SITE_URL=https://lnxbeats.fr` ;
- `PORT` fourni automatiquement par Railway.

Le fichier `railway.toml` sélectionne Railpack, le start command et le healthcheck.

## Vérification avant déploiement

1. Confirmer que la branche à déployer n’est pas `main` tant que la V0.1 n’est pas validée.
2. Exécuter `npm ci`, `npm run lint`, `npm run typecheck` et `npm run build` dans un environnement propre.
3. Démarrer le build et exécuter `npm run test:smoke` contre son URL.
4. Vérifier visuellement les formats mobile, tablette et desktop.
5. Confirmer que `/api/health` retourne HTTP 200 avec `{"ok":true,"service":"lnx-studio"}`.
6. Vérifier que seules les variables documentées sont présentes.
7. Demander une validation humaine avant tout déploiement de production.

## Rollback

Railway doit conserver le déploiement précédent. Le code du prototype antérieur reste également récupérable par son commit Git de départ, documenté dans le rapport du sprint.

Ne jamais employer un push forcé, supprimer un domaine Railway ou modifier les DNS OVH pour effectuer un rollback applicatif.

## Évolutions futures

Les variables de base de données, SMTP, PayPal et stockage ne seront ajoutées qu’avec les fonctionnalités serveur correspondantes. Elles devront être créées dans les secrets Railway, jamais dans le dépôt ni dans une variable `NEXT_PUBLIC_*`.
