# Previews audio — V0.6.0.4

## Choix technique

L’administration accepte le morceau source complet en MP3 ou WAV, jusqu’à 80 Mio. Le navigateur lit localement le `File` par object URL pour afficher sa durée et choisir le début ; aucun fichier n’est publié pour cette écoute préparatoire. Le serveur produit ensuite un MP3 public de 60 secondes maximum. Une source plus courte donne un extrait de sa durée réelle et une sélection proche de la fin est ajustée à la durée restante avec une indication dans l’interface.

M4A a été évalué mais n’est pas ouvert dans cette révision : MP3 et WAV couvrent le besoin confirmé sans élargir les signatures, MIME et scénarios de compatibilité.

## FFmpeg reproductible

Le développement local utilise `ffmpeg-static` 5.3.0, qui fournit actuellement FFmpeg 6.0 avec `libmp3lame`. Le package est une dépendance runtime et Next le conserve externe au bundle serveur ; aucun chemin utilisateur n’est écrit dans le code. `FFMPEG_PATH` peut sélectionner un binaire système explicite.

Pour un futur déploiement Railway/Railpack, installer FFmpeg comme paquet système (`RAILPACK_DEPLOY_APT_PACKAGES=ffmpeg`) puis définir `FFMPEG_PATH=/usr/bin/ffmpeg`. Le déploiement devra figer et contrôler la version effective avant activation. Aucune configuration Railway, aucun push et aucun déploiement ne font partie de cette version.

La commande de sortie sélectionne le premier flux audio, retire vidéo, sous-titres, chapitres et métadonnées, n’applique aucune normalisation de volume, puis encode en MP3 stéréo 192 kbit/s à 44,1 kHz. Les tags ID3v1/v2 source ne sont jamais propagés.

## Transport et source temporaire

Le Route Handler Admin vérifie l’origine et la session `ADMIN`, puis parse le multipart en streaming avec Busboy. La limite métier du fichier est 80 Mio ; la limite de transport est 81 Mio pour l’enveloppe. Le serveur écrit chaque chunk directement dans un fichier privé mode `0600`, sans appeler `request.formData()` ni dupliquer arbitrairement le source dans plusieurs buffers.

Extension, MIME et signature MP3/WAV sont contrôlés avant FFmpeg. La source complète vit uniquement sous le namespace temporaire `lnx-studio/catalog/audio-sources-temp/`, distinct de `MEDIA_STORAGE_ROOT`. Elle est supprimée après succès, refus, conflit ou erreur. Un nettoyage opportuniste retire les fichiers abandonnés de plus d’une heure. Les sources complètes ne deviennent jamais des `Asset` et ne sont jamais servies.

## Génération et concurrence

Le formulaire envoie `expectedAudioAssetId`. Après les validations peu coûteuses, le service vérifie cette identité sous verrou consultatif avant FFmpeg. Après génération et validation du MP3, une seconde vérification sous le même verrou précède l’activation transactionnelle. Un conflit tardif renvoie `409`, supprime la nouvelle dérivée et conserve l’ancienne preview gagnante.

La dérivée validée est écrite sous une clé opaque `catalog/audio-previews/*.mp3`. PostgreSQL conserve `audio/mpeg`, la taille, la durée mesurée, les droits confirmés et la nouvelle identité d’asset. L’ancienne preview n’est supprimée qu’après la transaction réussie. `Track.durationSeconds` reste la durée du morceau complet et n’est jamais modifié.

## Diffusion et lecteurs

`/media/catalog/audio/[assetId]` ne sert que les assets `AUDIO_PREVIEW`, droits `CLEARED`, liés à un projet `PUBLISHED`. Un projet `IN_DEVELOPMENT`, un brouillon ou une archive reçoit `404`. L’administration dispose d’une route protégée séparée.

La réponse utilise `audio/mpeg`, `Accept-Ranges: bytes`, `X-Content-Type-Options: nosniff`, une identité ETag et les codes `200`, `206` ou `416`. Le fichier est streamé depuis le stockage. Les lecteurs publics et le Jukebox consolidé n'ont ni autoplay initial ni téléchargement proposé, fonctionnent au clavier, conservent la continuité audio validée et empêchent deux lectures simultanées. Phase 5E ne modifie aucun composant Jukebox/audio ni ses cadrages responsive.

## QA et performance

Les tests destructifs utilisent exclusivement `lnx-studio-v0604-test` et des stockages `/private/tmp/lnx-studio-v0604-audio-qa-*`. Les fixtures MP3/WAV sont des silences synthétiques libres de droits. La base personnelle ne reçoit aucun audio artistique pendant la QA automatisée.

Le vrai composant navigateur valide un MP3 complet de 2 min 30, la durée locale, un début à 45 secondes, le clic de production, une requête Route Handler unique, une réponse 2xx et le lecteur de 60 secondes. La suite HTTP couvre également WAV, fichier proche de 80 Mio, dépassement, faux format, vide, source courte, fin de source, conflits, MIME, `HEAD`, `Range` et confidentialité. Sur la machine de QA, le parcours HTTP mesuré a pris environ 216 ms pour le MP3, 250 ms pour le WAV et 289 ms pour un WAV synthétique proche de 80 Mio ; la dérivée 60 s pèse environ 1,44 Mo. Ces valeurs sont indicatives, pas un engagement de production.

Le stockage local valide le contrat d’adaptateur, pas un déploiement multi-instance. Avant production, il faudra un stockage objet durable, sauvegardes, réplication, politique de cache/suppression et observabilité, sans mélanger previews publiques et livraisons privées.
