# LNX Beats V3.3 — Créations / collaborations / jukebox multimédia

Rapport de candidat local — 13 septembre 2026.

## 1. Base Git et périmètre

- Base réelle : `origin/main` à `acb8cde94d3723526e56cc08857db836a8435277`.
- Tree de départ : `a5c046d7640913a4ccc00ed732e8b5b2ee1ab763`.
- Branche : `feature/v3.3-creations-multimedia`.
- Worktree isolé : `/private/tmp/lnxbeats-v33-creations-multimedia`.
- Le worktree principal historique et ses fichiers non suivis suffixés ` 2` n'ont pas été modifiés.
- V3.3 reste additive : la Discographie, Commander, la Boutique, les paiements et Rights conservent leur logique métier.
- Aucun push vers `main`/`develop`, merge, déploiement, accès DB Production, objet R2 Production ou appel provider n'a été effectué. Le seul push autorisé après les gates de cette revue est celui de la branche feature V3.3.

## 2. Audit de l'existant

### Frontend et Jukebox

- Le site utilise l'App Router Next.js, un Header/Footer partagé, des CSS dédiées par univers et des media queries incluant `prefers-reduced-motion`.
- Le Jukebox Discographie possède déjà les responsabilités séparées `selectedProject` et `playingProject`; ses métadonnées restent calculées depuis `playingProject ?? selectedProject`.
- Il n'existait pas de store média global. Les lecteurs audio se coordonnaient par un événement navigateur limité à l'audio.
- Cette architecture a été conservée : V3.3 ajoute seulement un coordinateur transversal de revendication de lecture.

### Admin, Prisma et sécurité

- L'Admin existant repose sur `requireAdmin`, des actions/routes serveur, Prisma et les protections same-origin existantes.
- Le catalogue musical historique n'est pas un bon conteneur pour les collaborations audiovisuelles : son cycle de vie, ses types éditoriaux et son affichage restent propres à la Discographie.
- Le modèle générique `Asset` est en revanche adapté et est réutilisé pour tous les médias V3.3.
- Les opérations concurrentes Admin utilisent un `lockVersion`, des mises à jour conditionnelles et un verrou transactionnel PostgreSQL par création.

### Stockage et diffusion

- Le stockage existant prend en charge un backend local de QA et un backend objet compatible S3/Cloudflare R2, avec buckets public/privé et clés contrôlées côté serveur.
- Les images et l'audio conservent leur trajet serveur borné. La vidéo ne transite plus dans le corps d'une requête Railway : elle utilise un multipart direct signé vers la quarantaine privée R2, puis un worker la télécharge de manière bornée pour validation.
- Le driver objet existant effectue les gros transferts par multipart borné.
- Les médias objets publics sont diffusés directement par une URL GET signée d'une heure après une redirection `307`; le flux vidéo n'est donc pas proxyfié par Railway pendant la lecture.
- Le backend local implémente les réponses `200`, `206` et `416`, `Accept-Ranges`, `Content-Range`, longueur, ETag et cache immuable.

### SEO

- Les helpers canoniques, metadata, Open Graph, sitemap dynamique et JSON-LD existants ont été étendus sans créer de seconde infrastructure SEO.
- Les pages publiques, le détail et le sitemap partagent la même projection fail-closed afin qu'une création incohérente ne soit jamais indexée.

## 3. Architecture retenue

### Routes publiques

- `/creations` : introduction « Créations & collaborations », Media Stage, rail horizontal accessible et catalogue complet.
- `/creations/[slug]` : fiche individuelle avec média, contenu éditorial, crédits, liens externes et autres créations.
- Les deux routes restent distinctes de `/discographie` et n'altèrent pas son catalogue.
- L'empty state fonctionne lorsque la base ne contient aucune création publiée.

### Media Stage

- `selectedCreation` désigne la création affichée.
- `selectedMedia` désigne l'onglet média présenté dans cette création.
- `activeMedia` désigne la source réellement en lecture.
- Sélectionner une autre création ne lance rien et ne coupe pas arbitrairement la source courante.
- Une création audio + vidéo présente un sélecteur compact « Écouter l'audio » / « Voir le clip » et ne monte jamais deux gros lecteurs simultanément.
- Les cartes n'embarquent que cover/poster et texte. La balise `<video>` n'est montée qu'après une demande explicite de lecture.

### Coordination globale

- `lib/media/playback-coordinator.ts` publie une revendication `{ ownerId, kind }` sur un événement navigateur unique.
- Audio Discographie, audio des autres composants, audio Créations et vidéo Créations écoutent ce même canal.
- Toute nouvelle lecture met les autres sources en pause sans remise à zéro de `currentTime`.
- Le Jukebox conserve son état de sélection, sa source chargée et sa position après une pause externe.

## 4. Modèle de données et migration locale

### Modèles réutilisés

- `Asset` reste la source de vérité des métadonnées, du stockage, de la visibilité, des droits, du checksum, des dimensions et de la durée.
- Les enums/types existants `AssetType`, `AssetVisibility`, `AssetRightsStatus`, `MediaStorageBackend` et `MediaStorageProvider` restent utilisés.

### Modèles ajoutés

- `Creation` : slug immuable, titre, résumé, description, collaborateur, crédits, catégorie, média principal, position, statut, dates, SEO et version optimiste.
- `CreationAsset` : association unique par rôle `COVER`, `VIDEO_POSTER`, `AUDIO` ou `VIDEO` vers `Asset`.
- `CreationExternalLink` : libellé, URL HTTPS et ordre.
- Cycle de vie : `DRAFT`, `PUBLISHED`, `ARCHIVED`.

### Migration

- Migrations additives : `20260913180000_creations_multimedia_foundation` (inchangée) puis `20260913220000_creation_direct_upload_pipeline`.
- Elle crée 3 enums, 3 tables, leurs index, contraintes de cohérence et clés étrangères `ON DELETE RESTRICT`.
- Une ligne publiée doit avoir un résumé, un média principal et une date de publication; le service impose en plus un média audio/vidéo public, autorisé et cohérent.
- Le SQL ne modifie aucune table historique et ne contient aucune charge Rights V4.
- La migration corrective ajoute uniquement les sessions d'upload durables, leur statut, leurs baux worker, index et contraintes fail-closed.
- Validation réelle depuis une base PostgreSQL locale vide : 36 migrations appliquées. Upgrade simulé : 34 migrations `origin/main`, insertion d'un asset canari, puis les 2 migrations V3.3; canari conservé et schéma final cohérent.
- `prisma format`, `prisma validate` et `prisma generate` passent.
- Aucune migration n'a été appliquée à Production.

## 5. Médias, R2 et upload

### V3.3 corrective media pipeline

Le flux vidéo est désormais :

1. l'Admin authentifié demande une session same-origin ;
2. le serveur vérifie création, version optimiste, rôle, droits, MIME, extension et taille puis génère la clé `creations/quarantine/<creationId>/<uploadUuid>/video.mp4` ;
3. le navigateur envoie directement des parts de 8 Mio vers R2 avec au maximum deux requêtes simultanées et des URL PUT présignées 5 minutes ; à la limite exacte de 200 Mio, le plan contient donc 25 parts, pas 24 ;
4. la progression vient des octets réellement envoyés par `XMLHttpRequest` et distingue les octets confirmés par R2 des octets en vol ; une part échouée remet uniquement sa progression volatile à zéro, puis est retentée au maximum trois fois sans renvoyer les parts déjà confirmées ;
5. le navigateur ne conserve en `sessionStorage` qu'un token opaque lié à l'Admin, la création et le rôle, jamais un credential R2 ;
6. la finalisation compare les ETag client à la liste canonique R2, puis vérifie par `HEAD` taille, MIME et métadonnées de session ;
7. l'objet reste privé en `QUARANTINE`; un worker dédié le revendique par bail atomique, le télécharge dans un fichier `0600` imprévisible et borné, le décode intégralement, puis seulement le promeut ;
8. l'activation utilise un Asset réservé déterministe afin qu'un crash après activation mais avant marquage `READY` soit rejouable sans double Asset ; la même transaction verrouille la session d'upload et revérifie son bail juste avant l'attachement, de sorte qu'un worker ayant perdu son bail ne peut pas publier ;
9. abort, expiration, rejet et succès passent d'abord leur statut terminal par CAS avant suppression; un marqueur `*_CLEANUP_REQUIRED` rend le nettoyage rejouable.

Les sessions expirent après une heure. Les multipart abandonnés sont abortés opportunistement; l'abort automatique R2 des multipart incomplets (7 jours par défaut) reste le filet final.

Références : [Cloudflare R2 multipart](https://developers.cloudflare.com/r2/objects/upload-objects/), [URL présignées R2](https://developers.cloudflare.com/r2/api/s3/presigned-urls/), [limites Railway](https://docs.railway.com/networking/public-networking/specs-and-limits) et [upload direct recommandé par Railway](https://docs.railway.com/storage-buckets/uploading-serving).

### Configuration R2 requise avant Production

La CSP du site autorise uniquement l'origine exacte du endpoint R2 account-scoped configuré. Le bucket privé doit recevoir une CORS minimale, sans wildcard :

```json
[
  {
    "AllowedOrigins": ["https://www.lnxbeats.fr"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

Le staging doit utiliser sa propre origine et son propre bucket. Une lifecycle rule limitée à `creations/quarantine/` doit expirer les objets complétés orphelins après une courte rétention contrôlée (recommandation : 2 jours). Aucune configuration R2 Production n'a été modifiée.

Références : [CORS R2](https://developers.cloudflare.com/r2/buckets/cors/) et [Object Lifecycles R2](https://developers.cloudflare.com/r2/buckets/object-lifecycles/).

Le worker se lance séparément avec `CREATION_MEDIA_WORKER_ENABLED=true npm run creations:media-worker`. Il est idempotent, concurrence-safe, possède un bail renouvelé, trois tentatives avec backoff et un nettoyage des états terminaux. `SIGINT`/`SIGTERM` interrompent proprement le décodage actif (FFmpeg reçoit d'abord `SIGTERM`, puis `SIGKILL` après 2 secondes au maximum), libèrent le cycle et laissent la session reprenable. Aucun service Railway n'a été créé ici.

### Contrats acceptés

| Rôle | Entrée validée | Stockage normalisé | Limite |
| --- | --- | --- | ---: |
| Cover | JPEG, PNG ou WebP décodable | WebP | 10 Mio |
| Poster vidéo | JPEG, PNG ou WebP décodable | WebP | 10 Mio |
| Audio | MP3 réel et entièrement décodable | MP3 | 80 Mio |
| Vidéo | MP4, H.264, AAC si piste audio | MP4 | 200 Mio |

- La durée vidéo maximale est de 20 minutes.
- La validation finale FFmpeg (`-v error -xerror`, deux threads de décodage) exige exactement une piste vidéo H.264, vérifie que toutes les pistes audio éventuelles sont AAC, puis décode intégralement ces flux vers `null`; aucune fenêtre de 30 secondes ne subsiste.
- Le parseur multipart serveur reste utilisé uniquement pour les petits médias; la route historique refuse `VIDEO` avant toute lecture du corps.
- Les fichiers sont écrits avec permissions privées dans un répertoire temporaire, inspectés, hashés en SHA-256, puis nettoyés.
- Les clés sont générées côté serveur sous `creations/<creation-id>/<role>/<asset-id>.<ext>` et validées par une allowlist stricte.
- L'Admin doit confirmer les droits de diffusion. Les nouveaux assets sont `PUBLIC`, `CLEARED` et `CONFIRMED` seulement après validation.
- Le remplacement est compensé : un objet stagé ou obsolète n'est supprimé qu'après vérification qu'il est réellement orphelin.
- Les aperçus Admin sont authentifiés et `private, no-store`.
- Les médias publics ont un cache `public, max-age=31536000, immutable`; les clés uniques rendent ce cache sûr.

### Vidéo dans le navigateur

- Élément `<video controls playsInline preload="none">` natif.
- Aucun autoplay sonore.
- `object-fit: contain` et dimensions intrinsèques supportent 16:9, 9:16, 1:1 et ratios raisonnables sans recadrage.
- Poster/cover et halo ambiant sont affichés avant la demande de lecture.
- Architecture prête à recevoir une piste WebVTT ultérieurement, sans sous-titres fictifs.

## 6. Admin

- Navigation « Créations » ajoutée dans le groupe Contenu.
- Liste paginée, recherche et filtres `DRAFT` / `PUBLISHED` / `ARCHIVED`.
- Création et édition des champs éditoriaux/SEO, position, média principal et liens externes.
- Gestion séparée des quatre rôles média avec aperçu, remplacement et retrait confirmé.
- Pour la vidéo : états Préparation, Envoi, Nouvelle tentative, Finalisation, Validation intégrale, Prêt, Erreur ou Annulé; progression réelle, reprise et annulation restent accessibles sur mobile. La validation est volontairement indéterminée (« Analyse en cours »), car aucun pourcentage fiable n'est exposé par le décodeur.
- Publication fail-closed : titre, résumé, média principal, média jouable, visibilité publique, droits `CLEARED`, type et MIME cohérents.
- Une édition d'une création déjà publiée est soumise aux mêmes invariants.
- Dépublication avant archivage; aucune suppression destructive de création.
- Slug unique et immuable après création.
- Toutes les routes/actions sont protégées par l'authentification Admin et les garde-fous d'origine existants.

## 7. UX, responsive et accessibilité

- Direction conservée : noir, blanc, or, halo discret et transitions courtes sans moteur d'animation supplémentaire.
- Layout fluide par Grid/Flex, `clamp`, `aspect-ratio`, contraintes de hauteur et paliers fondés sur l'espace disponible.
- Mobile : média pleine largeur utile, informations sous la scène, rail scroll-snap, cibles tactiles observées à 48 px minimum.
- Sur 360–430 px, les trois sélecteurs de média utilisent une grille 2+1 sans défilement horizontal; chaque libellé reste complet dans une cible de 48 px.
- Tablette/laptop : bascule progressive; le viewport 1366×768 reste sans découpe ni overflow horizontal.
- Desktop/grand écran : largeur utile bornée; le contenu ne s'étire pas artificiellement à 2560 px.
- Vidéo verticale QA : source 540×960 rendue 308×550 environ à 390 px, `contain`, sans overflow.
- Dans « Toutes les créations », catégorie/collaborateur sont limités visuellement à 2 lignes et le titre à 3 lignes. Le texte complet reste dans le DOM et le H1 de la fiche n'est pas concerné.
- Rail navigable au clavier, boutons réels, labels/états accessibles, focus visible et contrôles vidéo natifs.
- `prefers-reduced-motion: reduce` neutralise les translations/transitions non essentielles.
- La navigation expose « Créations » sur mobile comme sur desktop et l'état actif est segment-safe.

## 8. SEO

- Metadata distinctes pour la liste et chaque fiche.
- Canonicals sous `https://www.lnxbeats.fr/creations...`.
- Open Graph utilise cover/poster quand il existe.
- `/creations` et uniquement les fiches réellement publiables sont ajoutées au sitemap dynamique.
- JSON-LD de fiche : `BreadcrumbList` + `CreativeWork`; les liens externes ordinaires ne sont plus détournés en `sameAs`.
- `VideoObject` est ajouté uniquement si une vidéo publiée dispose d'une URL de contenu, d'une miniature et d'une vraie date de publication.
- Une création audio seule ne reçoit pas de `VideoObject`.
- URLs structurées limitées à HTTPS sans identifiants; slug canonique validé; sérialisation JSON-LD anti-injection conservée.

## 9. Validation technique

### Tests automatisés

- Suite Créations corrective finale : 76/76 PASS, incluant UUID strict, multipart direct, séparation confirmé/en vol, worker, formats vidéo réels et corruption tardive.
- Suites ciblées finales : média 63/63, Admin 45/45, sécurité 16/16, Jukebox 78/78 et SEO 27/27, toutes PASS.
- Runtime direct-upload sur PostgreSQL local et stockage R2 simulé : PASS (5 sessions : liaison acteur/session, clés serveur, finalisation, validation asynchrone, Asset déterministe, replay après crash, interdiction d'attacher après perte de bail, abort, expiration et rejet d'un `HEAD` incohérent).
- Suite canonique complète finale : 1216/1216 PASS, 0 échec.
- Couverture de non-régression incluse : Discographie/Jukebox, audio, Admin, catalogue, Boutique, checkout, paiements, auth, sécurité, Rights et contrats.
- `npm run lint` : PASS.
- `npm run typecheck` : PASS.
- `npm run build` : PASS avec les nouvelles routes publiques, Admin et média.
- `npm run prisma:format` : PASS.
- `npm run prisma:validate` : PASS.
- `npm run prisma:generate` : PASS.
- `npm audit` : 0 vulnérabilité.
- `npm audit --omit=dev` : 0 vulnérabilité.
- `npm ls --all` : PASS.
- `git diff --check` : PASS.
- Bundle client `.next/static` : environ 2,2 Mio, aucun fichier nouveau supérieur à 1 Mio, aucune dépendance frontend ajoutée.

### QA locale réelle

- PostgreSQL local jetable initialisé depuis une base vide.
- 5 créations fictives locales : audio seul, vidéo paysage, audio + vidéo portrait, vidéo carrée et brouillon masqué.
- 12 médias QA réels et décodables (WebP, MP3, MP4 H.264/AAC); aucun n'est versionné.
- 4 créations publiées rendues; la création brouillon reste absente et sa fiche répond 404.
- Vérification interaction : lecture audio A, sélection B sans autoplay, puis lecture vidéo B qui met A en pause.
- Aucun appel, paiement, email, stockage ou donnée Production.

## 10. Captures QA

Répertoire temporaire non versionné : `/private/tmp/lnx-v33-qa-captures`.

### Matrice `/creations`

- `creations-360x640.png`
- `creations-375x667.png`
- `creations-390x844.png`
- `creations-430x932.png`
- `creations-768x1024.png`
- `creations-1024x768.png`
- `creations-1366x768.png`
- `creations-1440x900.png`
- `creations-1728x1117.png`
- `creations-1920x1080.png`
- `creations-2560x1440.png`

### États média et Admin

- `creation-video-landscape-playing-1366x768.png`
- `creation-audio-video-portrait-390x844.png`
- `creation-video-portrait-playing-390x844.png`
- `admin-creation-edit-1440x1000.png`
- Mesures automatisées : `/private/tmp/lnx-v33-qa-captures/qa-report.json`.

Sur les 11 viewports : `scrollWidth === clientWidth`, aucun scroll initial parasite, aucune vidéo montée au chargement, menu mobile jusqu'à 768 px et navigation desktop complète dès 1024 px. Les captures ont été inspectées visuellement après correction du scroll vertical involontaire du rail.

### Polish final avant push feature

Répertoire temporaire non versionné : `/private/tmp/lnx-v33-polish-qa`.

- Fiche audio + vidéo : `creation-detail-audio-video-{360x640,375x667,390x844,430x932}-polish.png`.
- Grille avec titre long : `creations-grid-long-title-{390x844,1366x768,1920x1080}-polish.png`.
- Rapport mesuré : `/private/tmp/lnx-v33-polish-qa/qa-report.json`.
- Viewports contrôlés : 360, 375, 390, 430, 768, 1366×768 et 1920×1080.
- Tous les sélecteurs sont contenus, leurs libellés sont complets, leur hauteur est de 48 px et aucune page ne présente d'overflow horizontal.

### Correctif pipeline vidéo Admin

Répertoire temporaire non versionné : `/private/tmp/lnx-v33-corrective-qa`.

- États desktop Préparation / Upload / Finalisation / Validation / Prêt / Erreur : `admin-upload-states-desktop-1440.png`.
- Reflow mobile Admin à 390 px : `admin-upload-mobile-390.png`.
- Cette revue locale a utilisé un rendu statique Quick Look sans requête réseau; elle valide la composition et complète les assertions CSS automatisées, mais ne remplace pas le futur essai navigateur réel avec un objet R2 de staging.

### Preuve composant Admin réelle avant push

Répertoire temporaire non versionné : `/private/tmp/lnx-v33-admin-component-evidence`.

- 27 captures du composant React de production, soit 9 états (`preparation`, `upload`, `retry`, `finalization`, `validation`, `ready`, `resume`, `error`, `cancelled`) sur `390×844`, `430×932` et `1440×900`.
- Exemples : `admin-video-upload-390x844.png`, `admin-video-validation-430x932.png`, `admin-video-ready-1440x900.png`.
- Rapport mesuré : `qa-report.json`.
- Résultat : aucun overflow horizontal, boutons visibles de 48 px sur mobile, 200 Mio affichés en unités binaires cohérentes, 25 parts de 8 Mio, progression fondée sur les octets réels et validation sans faux pourcentage.
- Le harnais de rendu était une route locale temporaire; elle a été supprimée avant le commit et n'appartient pas au diff.

## 11. Plan Preview isolé — non exécuté

Ce plan prépare la validation manquante sans repointer un service existant et sans réutiliser une donnée Production. L'état Railway observé pendant la revue reste : le service Web Production suit `main`; le Web staging existant suit une ancienne branche sans rapport avec V3.3; aucun service media worker V3.3 n'existe. Aucun service, variable, bucket ou domaine n'a été créé ou modifié.

### Topologie cible

1. créer un Web Preview isolé sur le SHA feature exact, avec domaine Preview distinct et healthcheck `/api/health` ;
2. créer un worker média Preview distinct sur le même SHA, commande exacte `CREATION_MEDIA_WORKER_ENABLED=true npm run creations:media-worker`, concurrence applicative actuelle de un job par processus ;
3. attribuer une base PostgreSQL Preview dédiée et jetable aux deux services, jamais une URL Production ; le Web applique les migrations additives à cette base avant démarrage ;
4. attribuer deux buckets R2 Preview distincts (public et privé/quarantaine) et des credentials restreints à ces seuls buckets ;
5. vérifier dans l'image Railway du worker `ffmpeg -version` avant tout essai média ; aucune validation réelle ne commence si FFmpeg est absent ou d'une version imprévue.

Variables nécessaires, par nom uniquement : `DATABASE_URL`, `MIGRATION_DATABASE_URL` pour le pre-deploy Web, `AUTH_URL`, `SITE_URL`, `APP_CANONICAL_URL`, `AUTH_SECRET`, `MEDIA_STORAGE_DRIVER`, `MEDIA_DEPLOYMENT_ENV`, `MEDIA_STORAGE_PROVIDER`, `MEDIA_S3_ENDPOINT`, `MEDIA_S3_REGION`, `MEDIA_S3_ACCESS_KEY_ID`, `MEDIA_S3_SECRET_ACCESS_KEY`, `MEDIA_PUBLIC_BUCKET`, `MEDIA_PRIVATE_BUCKET`, `MEDIA_S3_FORCE_PATH_STYLE` et, pour le worker seulement, `CREATION_MEDIA_WORKER_ENABLED`. Les secrets ne doivent jamais être copiés dans un rapport ou transmis au navigateur.

Le Preview n'hérite d'aucun provider de paiement, email réel, cron notification, maintenance Boutique ou accès Production. L'authentification Admin utilise uniquement des comptes QA sur l'origine Preview. Les rôles PostgreSQL et R2 sont limités aux ressources Preview.

### CORS et lifecycle Preview

- conserver toute règle existante sans l'écraser et ajouter une règle minimale pour l'origine HTTPS Preview exacte : méthode `PUT`, header `Content-Type`, header exposé `ETag`, preflight 3600 s, aucun wildcard ;
- tester séparément les lectures publiques/signées : elles ne nécessitent pas d'élargir la CORS d'upload si le lecteur suit la redirection normalement ;
- activer l'abort automatique des multipart incomplets sur un délai court documenté, puis une règle distincte limitée au préfixe `creations/quarantine/` pour les objets complétés mais orphelins ;
- exclure explicitement les clés finales `creations/<creationId>/video/...` de toute règle de quarantaine.

### Matrice de validation Preview

- Upload : MP4 réel H.264/AAC représentatif, proche de 200 Mio et de 20 minutes, au moins HD et avec fréquence d'image réaliste; observer durée, CPU, mémoire, disque temporaire, progression, retry d'une part, reprise et annulation. Les seuils CPU/RAM du worker seront définis depuis ces mesures, pas inventés avant le benchmark.
- Worker : arrêt `SIGTERM` pendant téléchargement puis pendant FFmpeg, reprise par un autre cycle, bail perdu, absence de double Asset, nettoyage temp/quarantaine et état Admin lisible.
- Range : requêtes `bytes=0-`, plage médiane et fin de fichier; attendre `206`, `Accept-Ranges`, `Content-Range` et longueurs cohérentes. Tester lecture, pause, reprise et renouvellement après expiration d'une URL signée d'une heure.
- Coordination : Discographie audio vers vidéo Créations, vidéo vers Discographie, audio Créations vers vidéo, vidéo vers audio, sélection seule et pause sans reset.
- Safari : Safari macOS réel puis iPhone réel, Wi-Fi et réseau mobile raisonnable, lecture inline, poster, seeking début/milieu/fin, pause/reprise et rotation. Playwright WebKit seul ne vaut pas cette preuve matérielle.

Résultats externes restant obligatoires : `CONTROLLED R2 CONFIGURATION REQUIRED BEFORE PRODUCTION`, `REAL R2 END-TO-END = PENDING`, `SAFARI MACOS AND IPHONE SEEKING = PENDING` et `MEDIA WORKER DEPLOYMENT = PENDING`.

## 12. Risques et limites avant Production

1. **Migration non déployée.** La migration V3.3 devra être revue puis appliquée par le mécanisme Production habituel seulement après une autorisation distincte.
2. **Configuration contrôlée R2.** La CORS privée et la lifecycle quarantaine doivent être appliquées humainement sur staging puis Production. `CONTROLLED R2 CONFIGURATION REQUIRED BEFORE PRODUCTION`.
3. **Premier média réel.** Aucun objet vidéo R2 Production n'a été créé. Le `HEAD`, les ETag CORS, le `Range`, le seeking et la lecture Safari/iPhone doivent être validés sur un bucket de staging réel. `REAL R2 + SAFARI/IPHONE SEEKING VALIDATION REQUIRED`.
4. **Validation asynchrone.** La validation locale d'un MP4 synthétique H.264/AAC de 20 minutes (160×90, 5 fps) a pris environ 0,49 s après une génération de 1,87 s. Ce chiffre ne représente pas un fichier réel haute résolution/200 Mio; le worker asynchrone reste nécessaire pour supprimer tout couplage à une fenêtre de requête Railway.
5. **Exposition après dépublication.** Une URL publique déjà signée peut rester valable au plus une heure; ce TTL est conservé pour permettre les Range requests et n'est pas présenté comme DRM.
6. **Contenu.** Aucun contenu Production n'est fourni par la migration. Les premières créations, covers, posters, textes, crédits et liens devront être ajoutés humainement dans l'Admin.
7. **Sous-titres.** WebVTT est prévu par l'architecture mais aucun fichier de sous-titres n'est inventé ou obligatoire dans cette V1.

## 13. Étapes requises avant Production

1. Autoriser uniquement le push de la branche feature.
2. Effectuer une revue humaine du diff, du SQL et des captures.
3. Configurer CORS/lifecycle sur le bucket R2 de staging et tester un vrai MP4 représentatif : upload multipart, ETag, reprise, abort, validation worker, Safari, Range et seeking.
4. Autoriser séparément l'intégration puis un déploiement contrôlé incluant la migration additive.
5. Créer et publier les contenus réels depuis l'Admin après validation éditoriale et des droits.

Prochaine décision maximale :

`AUTHORIZE V3.3 CORRECTIVE FEATURE BRANCH PUSH`

## 14. V3.4 — ingest vidéo normalisé et collaborateurs

### Pipeline vidéo

- Entrées fermées : `.mp4` (`video/mp4`), `.mov` (`video/quicktime` ou `video/mp4`), `.m4v` (`video/x-m4v` ou `video/mp4`) et `.webm` (`video/webm`). Le serveur vérifie l'accord extension/MIME avant toute session multipart.
- Codecs source acceptés après inspection FFmpeg : H.264, HEVC, VP8 ou VP9, avec zéro ou une piste AAC, MP3, Opus ou Vorbis. Une seule piste vidéo est autorisée; sous-titres, données, pièces jointes et pistes supplémentaires sont refusés.
- Plafonds centralisés et autoritaires : 500 Mio source, 20 minutes, 4096 px par axe, 4096×4096 pixels et 120 fps. La sortie normalisée est elle aussi bornée à 500 Mio.
- Le navigateur envoie toujours directement vers le bucket R2 privé/quarantaine en parts de 8 Mio avec trois envois concurrents au maximum. Railway Web ne reçoit jamais le corps vidéo lourd.
- Le worker passe explicitement par `ANALYZING`, `TRANSCODING` si nécessaire, puis `VALIDATING`. Une source déjà H.264/AAC est remuxée; toute autre combinaison acceptée est normalisée en MP4 progressif H.264 High/yuv420p + AAC 192 kbit/s, CRF 22, preset `fast`, `+faststart`, maximum 1920 px sans upscale et deux threads encodeur.
- La validation finale décode intégralement vidéo et audio avec `-xerror`. La source de quarantaine n'est supprimée qu'après remplacement atomique de l'Asset; l'ancien Asset reste actif en cas d'échec. Les fichiers temporaires vivent dans un répertoire aléatoire en mode privé et sont supprimés en `finally`.
- La migration V3.4 élargit les deux contraintes `CHECK` historiques taille/MIME. PostgreSQL ne sachant pas modifier une expression `CHECK` en place, elle remplace uniquement ces contraintes nommées sans supprimer colonne, table, type ni donnée.

### Mesure locale représentative

Fixture synthétique non versionnée : MOV H.264/MP3, 1920×1080, 30 fps, 80 s, 341 676 779 octets (325,85 Mio). Avec deux threads encodeur : inspection 11 ms, normalisation 22,78 s, décodage intégral 3,34 s, total 26,13 s; pic arbre Node+FFmpeg observé 467 648 Kio et pic processus 261 % CPU. La sortie H.264/AAC validée pèse 69 079 065 octets, soit une réduction de 79,8 %. Cette mesure locale justifie le maintien de la cible 500 Mio, mais ne remplace pas la preuve R2/Railway réelle exigée en Preview.

### Collaborateurs et liens officiels

- `CreationCollaborator` est propre à une création : nom obligatoire, rôle libre facultatif, position et relation 0..N.
- `CreationCollaboratorLink` autorise plusieurs liens ordonnés par personne. Les plateformes reconnues sont YouTube, Instagram, TikTok, Spotify, Apple Music et Deezer, avec Site web et Autre comme extensions HTTPS.
- Les URLs sont normalisées et refusent protocole actif, HTTP, credentials et hostname incohérent pour une plateforme connue. Une contrainte DB HTTPS complète la validation applicative; l'unicité personne+URL bloque le doublon exact.
- L'Admin propose des cartes empilées responsives pour ajout, édition, ordre et suppression. La suppression est création-scoped et efface explicitement uniquement les liens locaux avant le collaborateur; aucune entité artiste globale n'existe.
- La fiche publique n'affiche la section qu'en présence de collaborateurs. Les liens sont des ancres externes directes avec `target="_blank"`, `rel="noopener noreferrer"` et libellé accessible; aucun `dangerouslySetInnerHTML` et aucune URL collaborateur n'est attribuée à `sameAs` de LNX Beats.

### Validation migration locale

- Base PostgreSQL 17 vierge : 37/37 migrations appliquées par `prisma migrate deploy`, schéma à jour.
- Upgrade simulé : 34 migrations `origin/main`, puis fondation V3.3, pipeline direct V3.3 et migration V3.4. La création, l'Asset, la relation média, le crédit historique et la session d'upload préexistants sont restés identiques.
- Le plafond DB accepte exactement 524 288 000 octets et refuse la valeur suivante. Les FKs collaborateurs/liens restent `RESTRICT`; aucun artefact `publication_license_contract_v4` n'est introduit.

### Gates restant propres à la Preview

La preuve finale doit encore utiliser les buckets R2 Preview existants et le worker Railway Preview sur le même SHA : upload réel de chaque format, fichier réellement supérieur à 315 Mo, états Admin, remplacement atomique, Range/seek, renouvellement d'URL signée et lecture Safari macOS. L'iPhone physique demeure une recette humaine et ne peut pas être remplacé par une simulation WebKit.
