# Stockage des covers du catalogue

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

## Audio futur

Une future preview audio devra enregistrer un `Asset` audio, le projet ou la piste associée, le MIME, la taille, la durée de l’extrait et un éventuel offset de début. Seul un extrait choisi et autorisé par le propriétaire pourra devenir public ; un WAV de livraison restera dans un namespace privé distinct. Aucun lecteur, upload audio ou query jukebox n’est implémenté en V0.6.0.3.
