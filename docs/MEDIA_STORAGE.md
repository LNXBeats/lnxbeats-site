# Architecture média durable

## Décision V0.6.3

La production utilise un stockage objet S3-compatible. Le fournisseur conseillé est Cloudflare R2, derrière l’interface applicative `MediaStorage` (`put`, `get`, `head`, `delete`, `createSignedUrl`). Le code catalogue et commande ne dépend pas du SDK R2 : seul l’adaptateur `lib/media/storage/s3.ts` utilise AWS SDK v3. AWS S3, Backblaze B2 ou un autre service suffisamment compatible peuvent donc remplacer R2 par configuration et validation, sans réécrire les services métier.

Le pilote local reste disponible pour le développement, les tests et la preview personnelle. Il reproduit les deux espaces et les flux streamés, mais il est refusé lorsque `MEDIA_DEPLOYMENT_ENV=production` ou qu’un environnement Railway est détecté.

## Public et privé

Deux buckets distincts sont obligatoires en production :

- public : `catalog/covers/…`, `catalog/audio-previews/…` et futurs visuels publics ;
- privé : `orders/<orderId>/…`, puis futurs `deliveries/` et `documents/`.

Les clés sont opaques, générées côté serveur et validées par une allowlist. Un nom client ne devient jamais une clé. Le bucket privé n’a aucune lecture anonyme. Les références de commande restent accessibles via la route authentifiée qui vérifie propriétaire ou `ADMIN`; connaître l’UUID ne suffit pas. L’interface sait générer des URLs signées privées de 30 à 900 secondes, mais aucune URL signée n’est persistée en base ni exposée tant que la future livraison ne l’exige pas.

## Métadonnées PostgreSQL

`Asset` conserve la clé, le backend `LOCAL|OBJECT`, le fournisseur, la visibilité `PUBLIC|PRIVATE`, le SHA-256, le nom original sûr, le MIME, la taille, dimensions/durée, droits et relations projet/commande. Aucun blob n’entre dans PostgreSQL.

Les anciens enregistrements reçoivent `LOCAL`/`local`. La migration déduit `PUBLIC` uniquement pour les relations catalogue `COVER` et `AUDIO_PREVIEW`; les médias de commande restent `PRIVATE`. Le backend est porté par chaque asset : une migration progressive et relançable peut donc mélanger temporairement local et objet sans casser les lectures.

## Cohérence des remplacements

Cover, preview audio et référence privée suivent la séquence :

1. valider/normaliser ;
2. écrire le nouvel objet et vérifier sa taille ;
3. créer/échanger la relation dans une transaction PostgreSQL ;
4. supprimer l’ancien objet seulement après commit.

Si l’étape DB échoue, le nouvel objet est supprimé. Une suppression de l’ancien objet qui échoue après commit est journalisée de façon générique et peut être réconciliée depuis l’inventaire DB. Une transaction SQL ne prétend pas couvrir le fournisseur externe.

## Covers

- entrée JPEG/PNG/WebP, 10 Mio maximum et 40 millions de pixels ;
- signature, MIME, extension et décodage vérifiés ;
- réencodage WebP carré 1 600 × 1 600 sans EXIF ;
- objet public à clé unique, SHA-256 et `Cache-Control: public, max-age=31536000, immutable` ;
- route stable `/media/catalog/[assetId]` compatible avec `next/image`, sans domaine distant permissif.

La clé change à chaque remplacement : aucune purge de l’ancienne URL n’est nécessaire pour afficher la nouvelle cover.

## Previews audio

Le morceau source MP3/WAV (80 Mio maximum) est reçu en streaming dans un fichier temporaire privé, analysé et transcodé par FFmpeg. Seule la dérivée MP3 (60 secondes maximum, environ 1,5 Mio) est envoyée au stockage durable ; le source complet est supprimé dans tous les chemins terminaux.

La route publique conserve le même player et relaie le petit objet avec `GET`, `HEAD`, `Range`, `206`, `416`, `Accept-Ranges`, ETag SHA-256 et cache immutable. Elle ne charge pas le WAV en mémoire. Ce proxy même origine évite une configuration `next/image`/CORS et conserve les contrôles d’autorisation Admin. Une diffusion CDN directe pourra être activée plus tard pour les objets publics, après validation Safari d’un domaine précis.

## Références de commande et futures livraisons

Les images de référence restent limitées à 10 Mio, contrôlées par signature/MIME/extension, décodées, réencodées WebP sans métadonnées et enregistrées dans le bucket privé. Les réponses sont `private, no-store`, `nosniff` et utilisent un nom de téléchargement neutralisé. La route applique session active, email vérifié, relation commande et contrôle propriétaire/Admin centralisé.

L’interface de stockage possède déjà les primitives de stream et URL signée courte nécessaires à un futur master WAV, mais V0.6.3 ne construit ni upload final, ni livraison, ni paiement. Un futur gros fichier devra préférer multipart ou PUT pré-signé avec taille/MIME/checksum imposés, plutôt qu’un buffer Node complet.

## Configuration locale

```dotenv
MEDIA_STORAGE_DRIVER=local
MEDIA_DEPLOYMENT_ENV=local-preview
MEDIA_LOCAL_PUBLIC_ROOT=/chemin/absolu/catalog-media
MEDIA_LOCAL_PRIVATE_ROOT=/chemin/absolu/order-media
```

`MEDIA_STORAGE_ROOT` et `ORDER_UPLOAD_DIR` restent des alias de compatibilité. Les tests QA imposent une base nommée `*-test` et une racine privée sous `/private/tmp`.

## Configuration Railway / R2

À ajouter comme variables secrètes Railway au moment du déploiement, jamais dans Git :

```dotenv
MEDIA_STORAGE_DRIVER=s3
MEDIA_DEPLOYMENT_ENV=production
MEDIA_STORAGE_PROVIDER=r2
MEDIA_S3_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com
MEDIA_S3_REGION=auto
MEDIA_S3_ACCESS_KEY_ID=…
MEDIA_S3_SECRET_ACCESS_KEY=…
MEDIA_PUBLIC_BUCKET=lnx-studio-public-production
MEDIA_PRIVATE_BUCKET=lnx-studio-private-production
MEDIA_S3_FORCE_PATH_STYLE=false
```

Créer des identifiants et buckets différents pour staging et production. Le bucket privé reste privé. Si un accès navigateur direct est ajouté plus tard, sa CORS doit limiter l’origine exacte LNX Studio, les méthodes et headers nécessaires (`Range` public, jamais `*` privé).

## Sauvegarde et migration

La première migration ne supprime jamais les sources locales.

1. Créer un inventaire logique DB et une copie byte-for-byte :

   `npm run media:backup`

2. Vérifier la migration sans écriture :

   `npm run media:migrate:dry-run`

3. Après application de la migration Prisma, enrichir uniquement les métadonnées locales :

   `MEDIA_MIGRATION_CONFIRM=backfill-local-media-metadata npm run media:migrate -- --backfill-local --backup=/private/tmp/lnx-studio-v063-media-backup-…`

4. Avec les variables objet configurées, transférer :

   `MEDIA_MIGRATION_CONFIRM=migrate-local-media-to-object npm run media:migrate -- --execute --backup=/private/tmp/lnx-studio-v063-media-backup-…`

Le script inventorie les relations, compare tailles et SHA-256, réutilise un objet cible strictement identique, vérifie après upload, puis bascule l’asset individuellement en DB. Il est relançable et garde la source locale. Le rapport JSON est écrit dans le dossier de sauvegarde.

Après transfert : comparer nombre/volume, vérifier les relations DB, `GET`/`HEAD`/`Range`, covers, photos privées et refus IDOR. La suppression différée des sources locales nécessite une validation humaine séparée.

## Diagnostic

- `CONFIGURATION` : variable absente, buckets identiques ou pilote local refusé en production ;
- `INVALID_KEY` : clé hors namespace ou traversal ;
- `NOT_FOUND` : DB et stockage divergent ; restaurer depuis le backup avant toute suppression ;
- `INTEGRITY` : taille/checksum divergent ; ne pas basculer l’asset ;
- `PROVIDER` : service objet indisponible ou permission refusée ; aucun détail de secret ne doit atteindre l’UI.

Ne jamais journaliser credentials, cookies, fichiers, token ou URL signée complète. Les éléments sûrs sont l’asset id, backend, fournisseur, clé opaque, taille, opération et code d’erreur générique.
