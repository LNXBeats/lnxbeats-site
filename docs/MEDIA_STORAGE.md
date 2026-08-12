# Stockage des médias du catalogue

## Frontière de stockage

Les covers normalisées sont écrites sous la racine absolue `MEDIA_STORAGE_ROOT`, hors `public/` et hors Git. La preview utilise un dossier `.local-media/` ignoré. Les photos privées de commande conservent leur adaptateur et leur namespace séparés : aucune route catalogue ne peut lire un asset de commande.

## Validation

- formats d’entrée : JPEG, PNG ou WebP ; SVG et formats animés refusés ;
- taille maximale : 10 Mo ; limite de 40 millions de pixels au décodage ;
- rotation d’après l’orientation, recadrage carré 1 600 × 1 600 et encodage WebP ;
- métadonnées EXIF non recopiées ; original non conservé ;
- clé opaque générée côté serveur, chemin résolu dans le namespace `catalog/covers/` ;
- métadonnées, dimensions, taille, éventuel override d’alt et droits confirmés persistés dans `Asset` ; le fallback public est calculé depuis le titre PostgreSQL.

Le remplacement écrit d’abord le nouveau binaire, puis échange la relation `ProjectAsset` dans une transaction. Un échec supprime le nouveau fichier ; après succès, l’ancien fichier est retiré. La route `/media/catalog/[assetId]` ne sert que les covers WebP liées à un projet public.

L’envoi Admin passe par un Route Handler dédié, et non par la limite globale des Server Actions. Le transport multipart est plafonné à 10 Mo plus 256 Kio d’enveloppe, puis le fichier lui-même reste limité à 10 Mo et 40 millions de pixels. Avec le `Content-Length` émis par un navigateur, le Route Handler confie le multipart original au parseur natif de la requête afin de préserver exactement sa boundary WebKit ou Chromium. Un client sans longueur déclarée passe par un fallback bufferisé et borné. La signature binaire, le MIME déclaré, le décodage et les dimensions sont vérifiés avant une normalisation WebP carrée de 1 600 × 1 600 px. Le réencodage retire les métadonnées ; l’original volumineux n’est pas conservé, car seule la dérivée web est nécessaire au site.

## Production

Ce sprint valide un adaptateur local privé pour la preview et la QA. Un déploiement multi-instance devra remplacer cet adaptateur par un stockage objet durable, conserver le même namespace logique et définir sauvegarde, réplication, cache et procédure de suppression avant activation en production.

## Extraits audio V0.6.0.4

Les extraits publics utilisent le namespace distinct `catalog/audio-previews/`. Le binaire normalisé est un MP3 192 kbit/s, 44,1 kHz sans tags ID3, nommé par une clé opaque et stocké sous `MEDIA_STORAGE_ROOT`. PostgreSQL ne conserve que l’identité de l’asset, sa clé, `audio/mpeg`, sa taille, sa durée mesurée et ses droits confirmés.

Le morceau complet MP3/WAV reçu par la route Admin est écrit en streaming sous un dossier temporaire privé `lnx-studio/catalog/audio-sources-temp/`, hors `MEDIA_STORAGE_ROOT`. Il sert uniquement à l’analyse et au transcodage FFmpeg, puis il est supprimé dans tous les chemins terminaux. Les abandons de plus d’une heure sont nettoyés opportunément. Ni la source complète ni un WAV découpé ne sont servis ou enregistrés comme `Asset`.

La livraison privée d’un morceau complet reste hors périmètre et ne doit jamais réutiliser ce namespace. Un futur adaptateur objet durable devra conserver cette séparation logique, ainsi que la suppression de l’ancien fichier après remplacement réussi.
