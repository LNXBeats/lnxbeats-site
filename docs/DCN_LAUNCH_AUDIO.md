# DCN — validation audio avant lancement, 15 octobre 2026

## Écart reproduit et correction locale

La consolidation utilisait une analyse FFmpeg puis un décodage complet. Cependant, le décodage n'imposait pas `-xerror` et FFmpeg peut récupérer une entrée tronquée avec un code de sortie 0. Une durée déclarée ne prouve pas non plus que tous les octets audio attendus sont présents. Cette vérification n'était donc pas une preuve suffisante pour commercialiser de nouveaux imports.

Le nouveau pipeline conserve les fichiers historiques et ajoute, uniquement aux nouveaux imports :

- **WAV source** : inspection bornée des en-têtes RIFF/WAVE, longueur RIFF exacte, limites des chunks, présence unique de `fmt ` et de `data`, PCM entier/flottant ou extensible cohérent, alignement des échantillons, fréquence et débit cohérents. La durée est calculée depuis le nombre effectif d'échantillons, non simplement depuis un texte de diagnostic. Aucun chargement intégral du master en mémoire.
- **Décodage FFmpeg strict** : `-xerror -err_detect explode`, sortie nulle, progression finale contrôlée, erreurs rejetées et durée décodée rapprochée de la durée réelle. La tolérance de 100 ms couvre la présentation temporelle par FFmpeg et le bourrage MP3, pas un remplacement de source ; les limites RIFF et les frames MPEG manquantes sont vérifiées séparément.
- **MP3 privé et extrait public** : inspection de toutes les frames MPEG Layer III avec une fenêtre de lecture de 64 Kio, refus des frames tronquées, payloads finaux parasites et du nombre de frames incohérent avec Xing/Info. Le CBR attendu est contrôlé sur toutes les frames, puis le fichier est entièrement décodé. Les codecs et durées sont recoupés avec l'analyse FFmpeg.
- **Publication/vente nouvelle** : le marqueur d'encodage devient `ffmpeg-libmp3lame-cbr-v2-strict`. Le prédicat pur `digitalCommercialAudioReady` contrôle cette provenance, les deux formats privés, l'extrait public, MIME/checksums/durées/tailles et le bitrate. Le raccordement catalogue refuse une nouvelle commercialisation si cette preuve manque. Un ancien master `v1` n'est pas muté ni déclaré corrompu : les acquisitions historiques restent lisibles. La voie additive précise ci-dessous permet sa revalidation sans modifier l'historique.
- **Audit** : un nouvel événement `MASTER_VALIDATED` indique les contrôles RIFF/MPEG et le décodage strict. Aucun événement ni document antérieur n'est réécrit.

Les WAV compressés, RF64 et conteneurs non-WAV ne sont pas acceptés comme nouveaux masters. Ils doivent être exportés en WAV PCM approprié, sans inventer une qualité « lossless » à partir d'un MP3. Les métadonnées textuelles ou l'extension seule ne suffisent jamais.

## Revalidation additive d'un master v1 identique

Le refus général des checksums déjà présents aurait empêché de réimporter le WAV original pour produire la preuve stricte exigée par la nouvelle vente. Le worker autorise donc une seule exception étroite, **après l'inspection et le décodage complets** : le SHA-256 identique correspond à un unique master, de cette même piste, encore dernier master attendu, `READY`, WAV privé et marqueur exact `ffmpeg-libmp3lame-cbr-v1`. Un autre track, un marqueur inconnu ou déjà `v2-strict`, plusieurs correspondances, un état non prêt ou une version devenue obsolète restent refusés.

Procédure Admin : réimporter le **WAV original exact** sur sa piste, avec la version attendue actuelle et la confirmation de remplacement déjà existante ; attendre la fin de la validation ; vérifier la nouvelle version `v2-strict`, le MP3 et l'extrait ; effectuer la revue des droits ; puis seulement réactiver/revoir l'offre commerciale. L'import utilise de nouveaux identifiants, une nouvelle clé WAV privée, un nouveau MP3 et un nouvel extrait. Les nouveaux droits sont `PENDING`, jamais recopiés aveuglément de l'ancien master. Ne renommer ni ne réécrire les assets et snapshots acquis pour obtenir cette preuve.

Un verrou transactionnel par piste conserve le contrôle `expectedVersion` ; un verrou advisory supplémentaire par checksum sérialise la vérification des imports identiques entre pistes. Aucun appel réseau, traitement audio ou transfert de fichier n'est effectué sous cette transaction. L'événement append-only `MASTER_VALIDATED` contient `revalidation.kind=ADDITIVE_STRICT_REVALIDATION`, l'identifiant/version/asset/marqueur du précédent master et le checksum source. Aucun `UPDATE` du master précédent, de ses assets, de ses droits ou de ses acquisitions n'est nécessaire.

## Bornes et environnement

Le binaire réellement utilisé est `ffmpeg-static` déjà installé par le projet ; aucune installation, mise à jour ou requête réseau n'a eu lieu. `ffprobe` n'a pas été trouvé dans les chemins système précis vérifiés (`/usr/bin`, `/usr/local/bin`, `/opt/homebrew/bin`) ni dans le paquet FFmpeg du projet. La validation effective repose donc sur **FFmpeg réel + parseurs structuraux bornés**, pas sur un résultat FFprobe inventé. L'exigence fonctionnelle de validation est exécutée ; une exigence contractuelle d'outillage FFprobe nommément imposé resterait une opération de packaging séparée.

Bornes conservées : WAV 512 Mio/30 minutes ; MP3 privé moins de 96 Mio ; extrait au plus 3 Mio et **60 secondes physiques**, avec génération plafonnée à 59,9 secondes avant bourrage ; deux slots audio ; FFmpeg un thread/allocations bornées ; décodage 180 s, analyse 15 s et conversion 180 s ; limites RSS Node 512 Mio et FFmpeg 256 Mio ; réserve disque 1 Gio et répertoire propre au job. Inspection RIFF au plus 4 096 chunks et inspection MP3 au plus 100 000 frames/15 secondes. Seul l'extrait borné peut être tamponné ; masters et MP3 complets restent en flux/fichiers privés.

Si la surveillance RSS devient indisponible pendant un processus, le processus est arrêté et le job retourne en quarantaine ; la mesure manquante n'est pas assimilée à une réussite. Les fichiers dérivés temporaires sont supprimés seulement dans le répertoire du nouveau job et via les références non adoptées par la base. Aucun master/acquisition historique n'est nettoyé.

## Contrôles réellement exécutés

Commande locale, sans fournisseur ni base Production :

```sh
NODE_OPTIONS=--conditions=react-server node --import tsx --test tests/digital/audio-formats.test.ts tests/digital/audio-validation.test.ts
NODE_OPTIONS=--conditions=react-server node --import tsx --test tests/digital/audio-revalidation.test.ts
npx eslint lib/digital/audio.ts lib/digital/formats.ts lib/digital/mp3-validation.ts lib/digital/wav-validation.ts lib/digital/media-worker.ts tests/digital/audio-validation.test.ts
git diff --check
```

Résultat : **8 tests PASS, 0 FAIL, 0 SKIP** ; lint ciblé et diff-check PASS. Les tests utilisent des fichiers synthétiques réels et FFmpeg local, pas des doubles du décodeur :

1. WAV PCM 24 bits réel et conversion MP3 privée, ZIP WAV/MP3 et conservation des octets source.
2. Bitrates autorisés 192/256/320 et refus des paramètres invalides.
3. Source MP3 refusée comme master WAV, lease interrompue refusée.
4. WAV tronqué, taille RIFF corrigée mais chunk audio incomplet, HTML déguisé et débit PCM contradictoire refusés.
5. WAV flottant 32 bits réel accepté ; Matroska réel à deux streams audio renommé `.wav` refusé.
6. MP3 réel accepté ; frame partielle, dernière frame complète supprimée, HTML ajouté, faux MP3, bitrate et durée contradictoires refusés.
7. Source réelle de 65 secondes : extrait final physiquement inférieur ou égal à 60 secondes.
8. Publication conditionnée au marqueur strict et aux métadonnées cohérentes ; ancien marqueur, format manquant/public ou durée contradictoire refusés, sans mutation de l'objet historique.

Une première exécution dans le sandbox restreint a échoué sur `ps` (`EPERM`), pas sur les octets audio. Le traitement de cette erreur a été durci pour éviter toute exception asynchrone hors contrôle ; la suite a ensuite été exécutée avec la seule permission locale nécessaire à FFmpeg/`ps`, sans accès réseau.

Les preuves Stripe TEST, R2 et Safari Mac antérieures restent conservées ; elles ne sont ni rejouées, ni présentées comme une qualification externe du nouveau marqueur `v2-strict`. Aucun appel prestataire, push, merge ou déploiement n'a été effectué.

Contrôles supplémentaires de la revalidation additive : **5 tests de politique locale**, avec acceptation v1 courante, preuve d'audit et absence de mutation sur objet gelé, refus des doublons ambigus/autres pistes/v2/non prêts/incohérents, refus de version obsolète et réemploi d'identifiant/clé, refus d'une fausse provenance stricte. Ces doubles de métadonnées ne sont pas une nouvelle recette prestataire ni une mutation d'un master historique réel. La preuve FFmpeg réelle des octets reste apportée par les huit tests audio ci-dessus.
