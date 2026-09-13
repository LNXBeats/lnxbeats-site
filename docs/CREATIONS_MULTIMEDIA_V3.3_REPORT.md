# LNX Beats V3.3 — Créations / collaborations / jukebox multimédia

Rapport de candidat local — 13 septembre 2026.

## 1. Base Git et périmètre

- Base réelle : `origin/main` à `acb8cde94d3723526e56cc08857db836a8435277`.
- Tree de départ : `a5c046d7640913a4ccc00ed732e8b5b2ee1ab763`.
- Branche : `feature/v3.3-creations-multimedia`.
- Worktree isolé : `/private/tmp/lnxbeats-v33-creations-multimedia`.
- Le worktree principal historique et ses fichiers non suivis suffixés ` 2` n'ont pas été modifiés.
- V3.3 reste additive : la Discographie, Commander, la Boutique, les paiements et Rights conservent leur logique métier.
- Aucun push, merge, déploiement, accès DB Production, objet R2 Production ou appel provider n'a été effectué.

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
- L'upload V3.3 transite par l'application pour permettre la validation réelle par Sharp/FFmpeg, puis le fichier temporaire validé est envoyé au stockage par flux. Le processus Next.js ne conserve pas la vidéo entière en mémoire.
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

- Migration additive : `20260913180000_creations_multimedia_foundation`.
- Elle crée 3 enums, 3 tables, leurs index, contraintes de cohérence et clés étrangères `ON DELETE RESTRICT`.
- Une ligne publiée doit avoir un résumé, un média principal et une date de publication; le service impose en plus un média audio/vidéo public, autorisé et cohérent.
- Le SQL ne modifie aucune table historique et ne contient aucune charge Rights V4.
- Validation réelle depuis une base PostgreSQL locale vide : 35 migrations appliquées, schéma V3.3 utilisable.
- `prisma format`, `prisma validate` et `prisma generate` passent.
- Aucune migration n'a été appliquée à Production.

## 5. Médias, R2 et upload

### Contrats acceptés

| Rôle | Entrée validée | Stockage normalisé | Limite |
| --- | --- | --- | ---: |
| Cover | JPEG, PNG ou WebP décodable | WebP | 10 Mio |
| Poster vidéo | JPEG, PNG ou WebP décodable | WebP | 10 Mio |
| Audio | MP3 réel et entièrement décodable | MP3 | 80 Mio |
| Vidéo | MP4, H.264, AAC si piste audio | MP4 | 200 Mio |

- La durée vidéo maximale est de 20 minutes.
- Le parseur multipart exige `Content-Length`, un seul fichier, les champs attendus exactement et ferme le flux dès dépassement.
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
- Publication fail-closed : titre, résumé, média principal, média jouable, visibilité publique, droits `CLEARED`, type et MIME cohérents.
- Une édition d'une création déjà publiée est soumise aux mêmes invariants.
- Dépublication avant archivage; aucune suppression destructive de création.
- Slug unique et immuable après création.
- Toutes les routes/actions sont protégées par l'authentification Admin et les garde-fous d'origine existants.

## 7. UX, responsive et accessibilité

- Direction conservée : noir, blanc, or, halo discret et transitions courtes sans moteur d'animation supplémentaire.
- Layout fluide par Grid/Flex, `clamp`, `aspect-ratio`, contraintes de hauteur et paliers fondés sur l'espace disponible.
- Mobile : média pleine largeur utile, informations sous la scène, rail scroll-snap, cibles tactiles observées à 48 px minimum.
- Tablette/laptop : bascule progressive; le viewport 1366×768 reste sans découpe ni overflow horizontal.
- Desktop/grand écran : largeur utile bornée; le contenu ne s'étire pas artificiellement à 2560 px.
- Vidéo verticale QA : source 540×960 rendue 308×550 environ à 390 px, `contain`, sans overflow.
- Rail navigable au clavier, boutons réels, labels/états accessibles, focus visible et contrôles vidéo natifs.
- `prefers-reduced-motion: reduce` neutralise les translations/transitions non essentielles.
- La navigation expose « Créations » sur mobile comme sur desktop et l'état actif est segment-safe.

## 8. SEO

- Metadata distinctes pour la liste et chaque fiche.
- Canonicals sous `https://www.lnxbeats.fr/creations...`.
- Open Graph utilise cover/poster quand il existe.
- `/creations` et uniquement les fiches réellement publiables sont ajoutées au sitemap dynamique.
- JSON-LD de fiche : `BreadcrumbList` + `CreativeWork`.
- `VideoObject` est ajouté uniquement si une vidéo publiée dispose d'une URL de contenu, d'une miniature et d'une vraie date de publication.
- Une création audio seule ne reçoit pas de `VideoObject`.
- URLs structurées limitées à HTTPS sans identifiants; slug canonique validé; sérialisation JSON-LD anti-injection conservée.

## 9. Validation technique

### Tests automatisés

- Suite Créations : 48/48 PASS.
- Tests ciblés finaux (Créations, média, SEO, Merchant, Jukebox, audio, Admin) : tous PASS.
- Suite canonique complète : 1184/1184 PASS, 0 échec.
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

## 11. Risques et limites avant Production

1. **Migration non déployée.** La migration V3.3 devra être revue puis appliquée par le mécanisme Production habituel seulement après une autorisation distincte.
2. **Premier média réel.** Aucun objet vidéo R2 Production n'a été créé. Il faudra valider sur staging ou lors d'une procédure contrôlée le `HEAD`, le `Range`, le seeking Safari et les headers réels du premier MP4.
3. **Upload serveur.** Le trajet navigateur → Railway → fichier temporaire → R2 est nécessaire ici pour les validations Sharp/FFmpeg, mais un fichier de 200 Mio sur une liaison lente peut rencontrer la fenêtre d'upload Railway. Railway exige actuellement qu'un corps de requête soit entièrement envoyé en cinq minutes; un essai réel doit donc précéder Production. Voir [Railway — Specs & limits](https://docs.railway.com/networking/public-networking/specs-and-limits).
4. **Évolution possible.** Si cette fenêtre est trop courte en conditions réelles, la suite logique est un multipart direct signé vers R2, suivi d'une finalisation Admin et d'une validation serveur; ce n'est pas nécessaire pour le candidat actuel et ne doit pas contourner la validation. Railway recommande les URL présignées pour servir/téléverser les objets sans faire transiter leur contenu par le service : [Uploading & serving files](https://docs.railway.com/storage-buckets/uploading-serving).
5. **Validation appareils.** Chromium automatisé couvre la matrice responsive; un passage humain Safari iPhone et Safari macOS reste requis avant mise en Production.
6. **Contenu.** Aucun contenu Production n'est fourni par la migration. Les premières créations, covers, posters, textes, crédits et liens devront être ajoutés humainement dans l'Admin.
7. **Sous-titres.** WebVTT est prévu par l'architecture mais aucun fichier de sous-titres n'est inventé ou obligatoire dans cette V1.

## 12. Étapes requises avant Production

1. Autoriser uniquement le push de la branche feature.
2. Effectuer une revue humaine du diff, du SQL et des captures.
3. Tester un vrai MP4 représentatif en staging, notamment upload lent, Safari, Range et seeking R2.
4. Autoriser séparément l'intégration puis un déploiement contrôlé incluant la migration additive.
5. Créer et publier les contenus réels depuis l'Admin après validation éditoriale et des droits.

Prochaine décision maximale :

`AUTHORIZE V3.3 FEATURE BRANCH PUSH`
