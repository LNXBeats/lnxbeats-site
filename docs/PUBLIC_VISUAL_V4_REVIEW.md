# Application visuelle V4 — dossier de revue Preview

Date : 4 octobre 2026. **Aucune autorisation visuelle Production n'est présumée.**

## Base, périmètre, coordination

- Pack PART1/PART2 assemblé dans `LNX_VISUEL_V4`, vérificateur : 34 fichiers conformes. Les 11 références et les 5 captures refusées ont été ouvertes, pas seulement inventoriées.
- Base fonctionnelle réutilisée : `5910c6c6816bdd43bab57cc5885674e407954c66`, tree `65144eed9ffddc03725b5720274c27516489a221`.
- Main réconcilié : `dc0ae1b4d9dc3ac753477b82252938882e30ed82`. Les fixes audio, worker dédié, jukebox, mémoire et Photos/Format en sont ancêtres. Pas de retour sur l'ancien singleton mémoire abandonné.
- Branche visuelle : `fix/premium-public-visual-v4`, dans le worktree Premium Public existant. Aucun fichier du dépôt historique modifié. Deux tâches auxiliaires indépendantes, terminées avant la QA et le déploiement.
- Preview réutilisée : `preview-v33-media`, environnement `c4b1622a-dba7-4a69-a619-c4194f44e0ed`. Aucun service créé, aucune configuration changée. Web et worker seront déployés sur le commit contenant ce rapport ; leur preuve de livraison et le SHA/tree exact sont consignés dans le reçu QA externe après déploiement.
- URL : https://lnxbeats-v33-preview-web-preview-v33-media.up.railway.app

## Fonctionnalités / conformité visuelle

| Zone | Fonctionnalité conservée | Correction visuelle V4 |
| --- | --- | --- |
| Home | Requêtes catalogue et véritables extraits | Hero lisible avec photographie intégrale ; mise en avant compacte ; trois cartes-liens ; suppression du dernier CTA Commander redondant |
| Trois portes | Mêmes destinations | 108 px à 390 px ; icône SVG 46 px ; titre/texte/flèche sur une ligne composée, aucune ligne CTA supplémentaire |
| Soutenir | Guards, montants, checkout et webhooks inchangés | Un panneau Home avec cœur SVG et une navigation ; sur la page, ne présenter que les providers de test configurés, sans exposer leurs secrets |
| Plateformes | Les sept URL réelles inchangées | YouTube featured en premier, 80 px ; six lignes 72 px ; SVG, casse naturelle, lien sur toute la ligne |
| Menu | Routes, compte, réseaux | Dialogue natif plein écran, groupes hiérarchisés, cibles 48 px, scroll, focus bouclé, Échap et restauration du focus |
| Créations | Catégories, sélection indépendante, lecteurs natifs, récupération réseau bornée | Bouton vidéo rond 52 px ; ratio réservé ; bandeau audio 111 px ; titre/seek/pause du média effectivement joué ; action distincte uniquement pour lire une autre sélection |
| Jukebox | Ordre spécifique, filtres, sélection/lecture, sources et coordination | Une seule commande par source dans le bandeau ; retrait de la pilule opaque sur la pochette. Une sélection différente du son joué dispose d'une action explicite distincte |
| Album | Métadonnées/tracklist/liens réels, aucun faux bouton sur les titres sans fichier | Extrait dans un bandeau compact, flèche SVG |
| Commander | Six étapes, données, options, prix, photos, retry, consentements | Flèches SVG alignées, aucun changement de handler |
| Boutique | Guards, produit/prix/stock/checkout | Titres et descriptions mobiles lisibles, une colonne étroite si nécessaire ; aucune activation de la Boutique pour obtenir une capture |
| À propos | Contenu et photographie d'origine | Photo entière, sans recoloration ni couche obscurcissante |

Les défauts provenaient de compositions empilées et de styles hérités (CTA de carte additionnels, grandes zones vides), de glyphes Unicode et de commandes de lecture redondantes. Home, menu, plateformes et bandeau audio utilisent des CSS modules ciblés. Pas de zoom, de scale global, de marges négatives ni de clamp du nouveau texte pour réduire artificiellement la hauteur.

## Identité protégée

Aucun fichier `public/`, aucune donnée Asset distante ni aucun objet R2 modifiés. Aucune pochette client téléchargée pour décorer le site.

| Fichier existant | SHA-256 avant = après |
| --- | --- |
| `public/assets/v3/hero-main-ludovic-dog-exact.jpg` | `2c4168c5c6964a08d229fe9e2d6575014804f84c13fe1e12b45654fad3efb2c7` |
| `public/assets/v3/lnx-beats-signature-source-apple-artist.jpg` | `0f86e74b10bcfb2ddec01e9941d60a50a6b0970968ebf52a653b77efad7993d7` |
| `public/assets/v3/lnx-beats-signature-transparent.png` | `b8b1d6e76541c2f2452d47ad7b0a30fb686b17b3532c919ed889bd663ddfee79` |

La photographie carrée est affichée intégralement dans un bloc mobile distinct : écart intentionnel aux collages, expressément permis par le contrat pour éviter du texte sur les visages. Aucun faux album, prix, favori, playlist, recherche ou produit des maquettes n'est ajouté.

## Mesures et preuves locales

Build Production réel avec PostgreSQL 18 isolé et médias synthétiques locaux. Ces fixtures sont des mires de test, **pas des pochettes de remplacement ni des contenus à importer**. Aucun service Web connecté à une copie de données clientes.

72 mesures : neuf pages × 360/375/390/430/768/1024/1440/1920 px CSS, après stabilisation des media queries. DPR 1, zoom 100 %. Aucun débordement horizontal de document. Les carrousels conservent leur défilement interne voulu.

| Mesure à 390 px | Avant | Après |
| --- | --- | --- |
| Trois cartes Home | 211,2 px chacune | 108 px chacune |
| Panneau Soutenir | 284 px, éléments dispersés | 270,3 px, une composition |
| YouTube | 96 px | 80 px |
| Six plateformes | 72 px | 72 px, hiérarchie et flèches corrigées |
| Header | 64 px | 64 px |
| CTA Home | — | 50 px |
| Liens menu | — | 48 px |
| Play vidéo | Pilule | 52 × 52 px |
| Bandeau audio Créations | Surcouche sur visuel | 111,2 px sous visuel |

À 360 px, le soutien peut naturellement atteindre 312 px : retour à la ligne accessible, pas une hauteur forcée ni un texte tronqué.

Preuves exécutées :

- Menu modal réel ; Shift+Tab ferme la boucle vers Instagram, Tab revient à Fermer ; Échap restaure le focus sur Ouvrir ; navigation ferme le menu ; bas accessible à 740 × 390.
- Sélection seule sans source audio chargée ni vidéo montée. Lecture réelle de MP3 et MP4 synthétiques. Audio A continue quand B est sélectionné ; métadonnées et seek restent sur A ; action explicite lance B.
- Pause audio sans reset (positions observées 0,184 s puis 1,301 s) ; seek clavier vers 0,4 s ; audio→vidéo puis vidéo→audio : une seule source joue.
- Vidéo paysage : cadre 310,2 × 174,5 px avant/après ; portrait 9:16 conservé ; controls, playsInline, preload=none, aucun autoplay.
- Sept médias synthétiques : GET/HEAD 200 ; quatre sources audio/vidéo : Range 206, 32 octets et Content-Range cohérent.
- La fin et la récupération réseau sont couvertes par les tests existants. Une nouvelle coupure réseau navigateur et le plein écran iPhone physique ne sont pas présentés comme exécutés.

Captures originales, mesures et comparaisons référence/avant/après hors Git applicatif : `LNX_VISUEL_V4_QA` dans l'espace d'artefacts local du chat. Aucune capture ne provient d'une image IA générée comme preuve.

## Tests

- npm ci standard ; Prisma format/validate/generate : PASS. Aucun delta schema/migration/lockfile.
- Canonique : 1 336 tests exécutés, 1 334 PASS, 1 ancienne assertion CSS devenue obsolète, 1 SKIP préexistant. L'assertion a été corrigée pour contrôler la même garantie de cover entière sur le CSS module V4, puis repassée.
- Après les finitions mineures : 113 tests Jukebox/Soutien/couverture PASS, 112 Créations/Audio PASS, 181 Jukebox/Orders PASS. Ces périmètres se recouvrent : **ne pas les additionner**.
- Cinq tests supplémentaires ont été ajoutés après le run canonique et ont passé dans ces groupes : configuration de présentation Soutien (3), média joué vs sélection (1), absence de doublon jukebox (1). Couverture consolidée : **1 340 tests distincts PASS, 1 SKIP préexistant** ; ce n'est pas un nouveau run canonique complet de 1 341 tests.
- Lint, TypeScript et build de Production finaux : PASS. Aucun affaiblissement d'assertion métier ni contournement d'authentification.
- Audit Production : 0 vulnérabilité. Audit complet : cinq HIGH dev-only déjà connues (`@next/eslint-plugin-next`, `eslint-config-next`, `fast-glob`, `micromatch`, `braces`), dépendances inchangées. Pas de nouvelle dépendance visuelle.
- npm ls --all et git diff --check : PASS. Scan du delta et des nouveaux fichiers : à inclure dans le reçu final.

## Limites honnêtes et gate humain

- Les zones prioritaires sont soumises à la comparaison visuelle réelle, et non déclarées validées humainement par les tests.
- Catalogue/album : la Preview ne possède pas de catalogue publié. La mise en page est éprouvée sur fixtures locales ; aucune fixture importée sur la Preview.
- Boutique produit : Preview OFF ; listing commercial et fiche produit sur cette Preview NOT_RUN. Ne pas activer un flux financier pour une preuve visuelle. Le fallback réel et les tests Boutique canoniques restent vérifiés.
- Commander Photos/Format : logique inchangée ; tests Orders conservés. La recette iPhone antérieure ne vaut pas recette physique du rendu V4.
- Smoke Admin authentifié, zoom navigateur natif 200 %, iPhone Safari physique et navigateur Gmail intégré : NOT_RUN, pas de faux PASS.
- Soutien : disponibilité test affichée honnêtement ; aucune clé/provider activé, aucun paiement ni email. Les gates Stripe/PayPal réels, juridiques et comptables restent distincts.
- Main et Production inchangés ; ancien patch mémoire staged vide conservé. Aucun push main/develop, aucune migration/ACL/configuration Railway/R2 et aucune donnée métier modifiée par V4.

HUMAN_VISUAL_APPROVAL=PENDING

PRODUCTION_DEPLOYMENT=NOT_RUN
