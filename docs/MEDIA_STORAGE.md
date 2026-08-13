# Architecture média durable

## Décision V0.6.3

La production utilise un stockage objet S3-compatible. Le fournisseur conseillé est Cloudflare R2, derrière l’interface applicative `MediaStorage` (`put`, `get`, `head`, `delete`, `createSignedUrl`). Le code catalogue et commande ne dépend pas du SDK R2 : seul l’adaptateur `lib/media/storage/s3.ts` utilise AWS SDK v3. AWS S3, Backblaze B2 ou un autre service suffisamment compatible peuvent donc remplacer R2 par configuration et validation, sans réécrire les services métier.

Le pilote local reste disponible pour le développement, les tests et la preview personnelle. Il reproduit les deux espaces et les flux streamés, mais il est refusé lorsque `MEDIA_DEPLOYMENT_ENV=staging|production` ou qu’un environnement Railway est détecté.

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

## Staging R2

Le seul environnement objet autorisé par la migration V0.6.3.1 est le staging. Ses deux buckets exacts sont :

- `lnx-studio-staging-public` ;
- `lnx-studio-staging-private`.

Ils sont configurés pour rester non publics au niveau R2 : « public » décrit la visibilité métier des médias servis par le proxy LNX Studio, pas un accès anonyme au bucket. Le canary vérifie le refus sur l’endpoint S3 ; l’absence de domaine `r2.dev` ou personnalisé public reste une vérification humaine dans le tableau de bord Cloudflare. Le bucket privé n’accepte jamais de lecture anonyme. Aucun CORS navigateur n’est nécessaire tant que les routes applicatives servent les médias.

Les variables à renseigner dans `.env.local` ignoré ou dans un gestionnaire de secrets sont uniquement :

- `MEDIA_STORAGE_DRIVER` ;
- `MEDIA_DEPLOYMENT_ENV` ;
- `MEDIA_STORAGE_PROVIDER` ;
- `MEDIA_S3_ENDPOINT` ;
- `MEDIA_S3_REGION` ;
- `MEDIA_S3_ACCESS_KEY_ID` ;
- `MEDIA_S3_SECRET_ACCESS_KEY` ;
- `MEDIA_PUBLIC_BUCKET` ;
- `MEDIA_PRIVATE_BUCKET` ;
- `MEDIA_S3_FORCE_PATH_STYLE` ;
- `DATABASE_URL` et `LNX_DATABASE_TARGET` pour lier le manifeste à la base staging exacte.

Ne jamais recopier leurs valeurs dans une commande, un rapport, une capture ou un log. La configuration R2 exige l’endpoint HTTPS du compte, la région `auto`, l’adressage non path-style, l’environnement staging et les deux noms de buckets ci-dessus. Toute cible production est refusée par le script de migration actuel.

Créer un token API distinct pour le staging, limité à **Object Read & Write** sur ces deux buckets seulement. Il ne doit avoir aucun droit d’administration de compte, aucun accès aux buckets de production et ne doit pas être réutilisé par un autre environnement. Conserver uniquement les deux identifiants résultants dans le gestionnaire de secrets ; les révoquer ou les faire tourner indépendamment des futurs credentials de production.

## Canary R2 staging explicite

Le canary réel est volontairement opt-in et refuse Railway, la production, des buckets différents ou l’absence de confirmation. Après configuration humaine de `.env.local`, l’unique commande autorisée est :

```sh
MEDIA_R2_STAGING_CONFIRM=run-r2-staging-canary npm run test:media:r2-staging
```

Il crée deux objets aléatoires temporaires, vérifie `PUT`, `HEAD`, `GET`, plusieurs `Range`, le refus d’un accès anonyme non signé au bucket public staging, une URL GET privée signée pendant 30 secondes et le refus du même objet privé sans signature. Ici, « public » désigne la portée applicative des médias servis par LNX Studio, pas un bucket R2 ouvert anonymement. Son bloc `finally` supprime les deux canaries puis vérifie leur absence. La commande ne doit afficher ni credential, ni URL signée, ni URL objet brute, ni contenu utilisateur. Ce canary complète `/api/health` ; le healthcheck applicatif ne remplace pas un test R2 réel.

## QA HTTP R2 isolée

Les parcours runtime réels ne s’exécutent jamais sur `lnx-studio-local-preview`. Ils exigent une base Prisma Dev jetable nommée `*-test`, une preuve `LNX_PRISMA_DEV_SERVER_FILE` concordante et active, `NODE_ENV=test`, `EMAIL_PROVIDER=capture`, une origine `AUTH_URL` loopback hors port 3000, un secret et un mot de passe QA, ainsi qu’un serveur `next start` déjà lancé avec exactement le même environnement. Les deux confirmations sont obligatoires :

```sh
MEDIA_R2_STAGING_CONFIRM=run-r2-staging-canary \
MEDIA_R2_STAGING_RUNTIME_CONFIRM=run-r2-staging-runtime-qa \
npm run test:media:r2-staging-runtime
```

Ce test crée uniquement des identités `example.invalid`, un projet privé, des commandes et des objets à clés aléatoires. Il contrôle remplacement/suppression cover et audio, `HEAD`/`GET`/`Range`, absence de fallback local, propriétaire, Admin, refus autre membre/anonyme/cross-order et protection d’origine, puis nettoie uniquement les objets dont la ligne DB QA a disparu.

Le contrôle WAV proche de 80 Mio ajoute une troisième confirmation et un `AUDIO_TEMP_ROOT` unique, inexistant, directement sous `/private/tmp/lnx-studio-r2-audio-qa-*` :

```sh
MEDIA_R2_STAGING_CONFIRM=run-r2-staging-canary \
MEDIA_R2_STAGING_RUNTIME_CONFIRM=run-r2-staging-runtime-qa \
MEDIA_R2_AUDIO_WAV_CONFIRM=run-r2-near-80mib-wav-http-qa \
npm run test:audio:r2-staging
```

Le script possède et marque sa racine temporaire avant de pouvoir la supprimer. Il utilise `ListObjectsV2` seulement pour prouver que le WAV source n’entre jamais dans le bucket et ne supprime jamais une clé découverte par cet inventaire. Le token staging doit donc exceptionnellement autoriser le listing du seul bucket public pendant cette QA ; si ce droit n’est pas accordé, le test s’arrête sans élargir le token silencieusement. Les uploads, fichiers, comptes, projets et objets QA sont supprimés en fin de scénario ; une interruption brutale exige un audit humain des préfixes QA avant relance.

## Sauvegarde et migration staging

La migration ne supprime jamais les sources locales. Elle accepte uniquement la base persistante locale `lnx-studio-local-preview`, servie par le runtime Prisma Dev loopback sur un port non standard et prouvée par son `server.json`; Railway, une base distante et toute cible production sont refusés. Backup et migration partagent le verrou fichier local `/private/tmp/lnx-studio-media-migration-v0631.lock`, créé atomiquement avec `wx`, puis retiré dans tous les chemins de sortie contrôlés. Un verrou existant provoque un échec fermé : il n’est jamais déclaré périmé ni supprimé automatiquement. Après une interruption brutale, inspecter humainement son PID et confirmer qu’aucun backup ou migration ne tourne avant toute suppression manuelle. Les opérations métier conservent ainsi les requêtes Prisma indépendantes et leurs commits par asset, sans transaction interactive ni seconde connexion de verrouillage susceptible de bloquer le runtime PGlite. Une échéance applicative de deux heures, strictement inférieure à douze heures, interrompt le traitement aux frontières d’asset si elle est dépassée. Pendant toute la séquence, mettre les écritures média en maintenance : aucun upload, remplacement, archivage ou suppression de projet ne doit être accepté entre le backup et la réconciliation finale. Les modes d’écriture exigent le flag `--maintenance-window`, `MEDIA_MIGRATION_MAINTENANCE_CONFIRM` et une confirmation distincte `MEDIA_MIGRATION_DATABASE_CONFIRM` nommant l’opération autorisée ; aucune de ces barrières ne remplace le gel réel des écritures.

Les commandes chargent les valeurs sensibles depuis `.env.local` ignoré. Ne jamais préfixer une commande avec `DATABASE_URL`, `MEDIA_S3_ACCESS_KEY_ID` ou `MEDIA_S3_SECRET_ACCESS_KEY`.
Dans les exemples suivants, remplacer `SUFFIXE` par un identifiant local unique et conserver exactement le chemin retourné par le script.

### 1. Métadonnées locales

Avec le pilote local et les racines locales historiques configurés, créer un premier backup lié à cet environnement :

```sh
npm run media:backup -- --output=/private/tmp/lnx-studio-v063-media-backup-local-SUFFIXE
npm run media:migrate:dry-run -- --backup=/private/tmp/lnx-studio-v063-media-backup-local-SUFFIXE
```

Après validation du manifeste et du dry-run, enrichir les métadonnées locales :

```sh
MEDIA_MIGRATION_CONFIRM=backfill-local-media-metadata \
MEDIA_MIGRATION_MAINTENANCE_CONFIRM=staging-media-migration-maintenance-approved \
MEDIA_MIGRATION_DATABASE_CONFIRM=backfill-lnx-studio-local-preview-media-metadata \
npm run media:migrate -- --backfill-local --maintenance-window --backup=/private/tmp/lnx-studio-v063-media-backup-local-SUFFIXE
```

### 2. Cible objet staging

Configurer ensuite R2 staging, exécuter le canary opt-in, puis créer un **nouveau** backup. Ce second manifeste lie la base et l’inventaire au provider, à l’endpoint et aux buckets staging exacts ; le premier manifeste local ne doit pas être réutilisé pour le transfert objet.

```sh
npm run media:backup -- --output=/private/tmp/lnx-studio-v063-media-backup-r2-staging-SUFFIXE
npm run media:migrate:dry-run -- --backup=/private/tmp/lnx-studio-v063-media-backup-r2-staging-SUFFIXE
```

Après comparaison humaine du nombre d’assets, du volume, de l’ensemble `id/clé/SHA-256` et de la cible staging :

```sh
MEDIA_MIGRATION_CONFIRM=migrate-local-media-to-object \
MEDIA_MIGRATION_MAINTENANCE_CONFIRM=staging-media-migration-maintenance-approved \
MEDIA_MIGRATION_DATABASE_CONFIRM=migrate-lnx-studio-local-preview-media-to-r2-staging \
npm run media:migrate -- --execute --maintenance-window --backup=/private/tmp/lnx-studio-v063-media-backup-r2-staging-SUFFIXE
```

Le script refuse un manifeste d’une autre base ou d’un autre environnement. Il vérifie les sources, réutilise uniquement un objet cible identique, contrôle taille et SHA-256 après lecture, journalise chaque asset, puis effectue une mise à jour DB conditionnelle qui détecte les changements concurrents. Un objet nouvellement envoyé est supprimé si la bascule DB échoue et que la DB ne le référence pas. Un échec ambigu reste marqué dans le journal pour réconciliation humaine.

La procédure est relançable : un asset déjà basculé n’est accepté qu’après revalidation intégrale de l’objet, et un objet staging identique peut être réutilisé. Relancer exige toujours le même gel des écritures, un backup encore conforme et les confirmations explicites. Aucun mode ne supprime automatiquement les sources locales.

Après transfert, vérifier le rapport et le journal, le nombre et le volume, les relations DB, `GET`/`HEAD`/`Range`, les covers, previews, photos privées et le refus IDOR. Vérifier aussi qu’aucun canary ni objet non référencé ne reste. La suppression éventuelle des sources locales est une opération future, humaine et séparée.

## Rollback et limites de sauvegarde

R2 fournit le stockage runtime durable ; **R2 n’est pas à lui seul une sauvegarde complète**. Le dossier `/private/tmp/lnx-studio-v063-media-backup-*` est une copie de travail temporaire et locale. Il ne remplace ni un backup PostgreSQL restaurable, ni une copie média durable hors fournisseur, ni une politique de versioning/rétention, ni un test périodique de restauration. La production devra définir ces quatre éléments avant toute suppression de source.

En cas d’échec staging, arrêter les écritures, conserver journaux et sources, puis restaurer les métadonnées `Asset` depuis un backup PostgreSQL validé ou une procédure de restauration dédiée. Le retour au pilote local n’est autorisé qu’en développement/preview locale, avec les lignes DB restaurées vers `LOCAL` et les racines locales intactes. Changer seulement `MEDIA_STORAGE_DRIVER` ne constitue pas un rollback des assets déjà marqués `OBJECT`.

Il n’existe aucun fallback local en staging, en production ou sur Railway : le démarrage doit échouer fermé plutôt que servir un filesystem éphémère. Ne jamais contourner ce garde-fou. Les buckets, credentials, manifestes, canaries et autorisations de production seront créés dans une étape future distincte ; la procédure staging actuelle refuse volontairement `MEDIA_DEPLOYMENT_ENV=production`.

## Diagnostic

- `CONFIGURATION` : variable absente, buckets identiques ou pilote local refusé en staging/production ;
- `INVALID_KEY` : clé hors namespace ou traversal ;
- `NOT_FOUND` : DB et stockage divergent ; restaurer depuis le backup avant toute suppression ;
- `INTEGRITY` : taille/checksum divergent ; ne pas basculer l’asset ;
- `PROVIDER` : service objet indisponible ou permission refusée ; aucun détail de secret ne doit atteindre l’UI.

Ne jamais journaliser credentials, cookies, fichiers, token ou URL signée complète. Les éléments sûrs sont l’asset id, backend, fournisseur, clé opaque, taille, opération et code d’erreur générique.
