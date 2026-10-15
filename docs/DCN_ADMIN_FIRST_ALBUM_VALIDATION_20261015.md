# DCN validation du premier album réel dans l’Admin

Le premier album peut être créé, renseigné, importé et prévisualisé dans les formulaires existants, sans modification du code, script d’import ou SQL pour cet album. Cette conclusion repose sur les écrans et services relus après `d0e995e612e353230a318ad4214daa9cb3697795` et sur les preuves locales déjà acquises. Elle ne signifie ni import d’un véritable album pendant cette revue, ni ouverture des ventes réelles.

L’exploitant doit avoir configuré l’application, la base, le stockage et un worker audio opérationnel. L’envoi Web ne lance pas le worker : sans lui, les fichiers attendent leur traitement et ne deviennent pas prêts automatiquement. Les justificatifs privés et leur SHA‑256 restent aussi à préparer hors de l’Admin.

## Prérequis avant la saisie

Pour l’exploitant : compte Admin actif à e-mail vérifié, accès aux écrans Catalogue et Musique numérique, DCN autorisé en TEST, base et stockage disponibles, worker audio et ZIP actif, FFmpeg et espace temporaire suffisants. Les nouvelles preuves exigent l’horodatage PostgreSQL UTC. Ces éléments sont des prérequis d’exploitation, pas des commandes à demander à l’artiste pour chaque album. Les paiements réels restent fermés.

Pour LNX Beats : l’édition exacte à préparer, les WAV définitifs privés, la pochette et ses droits, les titres dans l’ordre, les débuts d’extraits souhaités, les crédits vérifiés et les vrais prix à décider. Préparer les autorisations de composition, master, interprétation/collaborations, samples/reprises, extraits et éventuelles exclusivités. Conserver ces pièces dans une archive privée ; préparer une référence `private-evidence:…` et le SHA‑256 du justificatif ou d’un manifeste identifiant les versions couvertes. Le formulaire n’héberge pas ces pièces et ne calcule pas leur SHA‑256.

Les prix sont fixés par le vendeur, pas par l’acheteur. Aucune maquette ni somme de fixture ne vaut tarif de lancement. Un inédit peut être préparé sans lien Spotify ou Apple Music ; cela ne dispense d’aucun droit.

## Procédure exacte pour un album de douze titres

Douze est ici la taille du premier dossier de travail, pas une obligation du logiciel.

Dans ce lot, maintenir le véritable projet brouillon et masqué, avec ses offres inactives. L’étape de publication et d’activation ci-dessous est conditionnelle : elle attend une autorisation explicite de release dans l’environnement concerné. Ce guide ne constitue pas cette autorisation.

1. Ouvrir `/admin/catalogue`. Reprendre le projet s’il correspond déjà à la bonne édition ; sinon ouvrir `/admin/catalogue/nouveau`. Choisir explicitement le type **Album** : le type initial est Projet. Saisir le titre, puis « Créer le projet ». Garder Brouillon, « Visible sur le site » décoché et Aucun jukebox. L’adresse est créée depuis le titre si elle n’est pas renseignée.
2. Dans `/admin/catalogue/{slug}`, compléter titre, sous-titre, date, descriptions et crédits. Enregistrer les informations du projet. Les crédits de cet écran portent sur le projet ; aucun éditeur distinct de crédits structurés par piste n’est présent. La précision libre d’un crédit peut identifier son rôle ou les titres concernés, sans remplacer le dossier de droits.
3. Dans la section cover, choisir le JPEG, PNG ou WebP, confirmer les droits de publication de l’image puis « Ajouter la cover ». Le texte alternatif est facultatif. Si la vignette Catalogue reste indisponible sur un brouillon masqué, contrôler la pochette dans la prévisualisation privée DCN de l’étape 8 ; ne pas publier le projet pour contourner cette vignette.
4. Dans « Ajouter une piste », saisir chacun des douze titres, puis « Ajouter la piste ». La durée peut rester vide si elle est inconnue. Garder le statut Annoncé ou Non listé pendant la préparation. Contrôler l’ordre avec Monter/Descendre et enregistrer les corrections. **Il n’y a pas d’import CSV de titres ou de métadonnées** ; le lot de WAV ne crée pas la tracklist.
5. Ouvrir le menu « Musique numérique · TEST », puis « Gérer » sur ce projet, ou directement `/admin/musique/{slug}`. Le lien « Identité, cover et publication Catalogue » permet de revenir à sa fiche. Il n’existe pas encore de lien contextuel inverse Catalogue vers cette fiche DCN ; le passage par le menu reste disponible.
6. Dans « Importer les WAV et préparer les extraits », utiliser « Ajouter un ou plusieurs masters WAV au lot ». Sélectionner les douze fichiers. **Associer explicitement chaque ligne au bon titre**, puis choisir son début d’extrait en secondes, jusqu’à trois décimales. Deux fichiers vers la même piste sont refusés. Toutes les lignes en attente doivent être valides avant l’envoi groupé. Aucun rapprochement n’est déduit du nom du fichier.
7. Envoyer un premier fichier pour contrôler l’association, puis utiliser « Envoyer / reprendre le lot associé ». Attendre le WAV validé, le MP3 privé et l’extrait prêts, pas seulement 100 % d’envoi. Suspendre/reprendre ne relance pas les fichiers réussis. Après une erreur réseau, conserver le même fichier et les mêmes réglages. Si le serveur a définitivement refusé un fichier et qu’aucune session n’est encore récupérable, retirer cette ligne du lot puis ajouter le fichier corrigé ; ne pas recommencer les onze succès. Retirer une ligne prête ne supprime pas son master.
8. Ouvrir « Prévisualiser avant publication » sur la même fiche, ancre `#edition-preview`. Contrôler pochette, métadonnées, crédits, douze titres, ordre, versions et extraits ; écouter chaque extrait et vérifier son début. Cette prévisualisation authentifiée fonctionne avec projet brouillon et pistes annoncées, avant approbation des droits. Elle ne publie rien et ne fournit aucun WAV ou MP3 complet. L’extrait éditorial facultatif du Catalogue est un autre média : il ne remplace pas les extraits DCN générés par piste.
9. Dans « Droits et collaborateurs — par version audio », sélectionner uniquement les versions réellement couvertes, ou « Sélectionner les versions éligibles » après vérification du lot. Choisir la décision, renseigner la référence privée et le SHA‑256, attester l’examen puis enregistrer. Vérifier le nouvel état et l’historique. Une approbation concerne les identités et empreintes exactes de chaque version ; un nouvel import ne la recopie pas. La case de droits de l’offre est un contrôle séparé.
10. Préparer « Offre de l’album complet » et les éventuelles « Offre du titre à l’unité ». Leurs prix sont indépendants ; vendre tous les titres séparément n’est pas obligatoire. Choisir la distribution réelle, dont « Inédit / non distribué ». Sans tarif validé, laisser le prix vide et l’offre inactive. L’avertissement d’un prix complet supérieur à la somme des titres ne crée ni remise automatique ni interdiction.
11. Quand les choix de publication locale sont explicitement autorisés, passer les douze pistes incluses à Publiée, puis le projet à Publié et visible dans le Catalogue. Une piste annoncée ou non listée reste exclue de l’édition vendue. Activer seulement les offres TEST souhaitées, après prix et droits confirmés. Le diagnostic doit alors annoncer douze pistes incluses, avec tous les fichiers et droits prêts. Recontrôler la prévisualisation privée, puis la fiche publique `/album/{slug}`. Publié ne signifie pas paiement réel ouvert.

Pour un single, les mêmes écrans emploient « Offre du single complet » et « Offre du titre à l’unité ». Ce sont toujours deux offres distinctes ; les libellés ne changent ni les prix, ni les identités d’offres, ni les règles serveur.

## Formats et bornes à vérifier

| Élément | Borne ou comportement existant |
| --- | --- |
| Pochette | JPEG, PNG ou WebP authentique ; 10 Mo maximum et 40 millions de pixels maximum. |
| WAV source | RIFF PCM entier ou flottant cohérent ; 512 Mio et 30 minutes maximum par fichier. Un MP3 renommé WAV n’est pas accepté. |
| Lot navigateur | 50 fichiers maximum ; plusieurs lots possibles ; deux traitements de lot au maximum. |
| Extrait | Début positif ou nul, inférieur à 1 800 secondes et à la fin réelle du WAV ; durée physique de 60 s et taille de 3 Mio maximum. |
| MP3 complet | Créé depuis le WAV ; privé ; 320 kbit/s par défaut, stéréo 44,1 kHz, moins de 96 Mio. Pas de second master MP3 à fournir. |
| Prix ordinaire | Montant explicite de 0,01 à 1 000 EUR par offre selon la borne technique actuelle ; prix vide permis uniquement pour une offre inactive. |
| Revue de droits | 100 versions maximum par lot ; pièces et empreinte du manifeste préparées hors Admin. |
| ZIP | Deux archives distinctes après acquisition : WAV et MP3. 100 entrées maximum et moins de 4 Gio avec les en-têtes ; ZIP64 absent. Vérifier le poids cumulé des WAV avant de promettre cette archive. |

Le WAV conserve ses octets d’origine. MP3 et extrait sont dérivés séparément ; leur succès technique ne certifie ni la qualité artistique du mix ni les autorisations. Une correction de début d’extrait après import passe par une nouvelle version additive, avec nouveaux droits en attente. Une erreur d’association déjà validée exige une revue et une nouvelle version appropriée ; déplacer aveuglément le même WAV vers un autre identifiant de piste reste refusé.

La prévisualisation Admin ne génère pas de ZIP prévente et ne permet pas d’écouter les fichiers complets. Les deux ZIP et téléchargements individuels sont préparés pour les identités effectivement acquises dans la bibliothèque client, après le parcours contractuel autorisé. Leur recette constitue une étape QA distincte, pas une raison de fabriquer un achat réel. Un ZIP en revue ne dispose pas d’un bouton Admin de reprise dans ce parcours.

## Vérifications et preuves réutilisées

La lecture des formulaires Catalogue, des composants Admin DCN, de `lib/digital/catalog.ts`, du service de droits, de l’upload, du worker audio, des archives et de la bibliothèque confirme les étapes ci-dessus. Les nouveaux libellés sont limités à la présentation ; les conditions de vente et d’accès restent les mêmes.

| Preuve existante | Ce qu’elle établit et sa portée |
| --- | --- |
| `output/dcn-consolidation/formats-runtime.json` | PostgreSQL, FFmpeg et fichiers locaux synthétiques : douze WAV et MP3, deux ZIP de douze entrées, checksums, accès propriétaire et conservation des anciennes versions. Preuve de consolidation conservée, pas nouvelle campagne. |
| `output/dcn-france-commercial/admin-preparation-runtime-9d063091-fe2e-432a-bdae-53dd46988e2f.json` | Dix contrôles intégrés locaux : deux imports stricts d’un même WAV synthétique avec débuts 0 et 12,345 s, droits neufs, identités et octets antérieurs intacts, routes privées et refus des complets/publics sur le brouillon. |
| `output/dcn-france-commercial/browser-review.json` | Prévisualisation privée, lecture/pause réelle de l’extrait, revue des captures desktop 1440 et mobile 390 sans débordement. Navigateur intégré local, pas nouvelle preuve Safari physique. Le point d’entrée général `/admin` reste bloqué dans ce profil QA restreint par une permission hors DCN ; l’accès direct à l’Admin musique a fonctionné, sans élargissement d’ACL. |
| `docs/DCN_LAUNCH_AUDIO.md` | Preuve audio stricte déjà acquise : structures WAV/MP3, décodage entier, source tronquée refusée et extrait physique de 60 s maximum. Aucun nouveau traitement FFmpeg exécuté pour ce guide. |

Les anciens guides qui conditionnent toute prévisualisation à la publication décrivent la fiche publique. Pour préparer l’édition masquée, suivre désormais la prévisualisation privée DCN de l’étape 8. La vignette Catalogue publique et son lien « Voir sur le site » ne constituent pas une preuve de cette prévisualisation privée.

## Critère de fin de préparation

L’album est préparé quand son identité et sa tracklist sont exactes, chaque WAV a ses dérivés attendus, chaque extrait a été écouté, les droits de chaque version sont réellement examinés, les prix sont décidés et les disponibilités choisies. Si douze pistes doivent être vendues, le contenu publié doit en contenir exactement douze. Un fichier prêt ne remplace aucune de ces décisions.

Les validations juridiques, fiscales, de territoire et d’exploitation restent celles du dossier de lancement. Les preuves Stripe, PayPal, R2 et Safari déjà acquises ne sont ni rejouées ni étendues par cette lecture. Aucun véritable album, prix, droit, achat, document historique, prestataire ou e-mail réel n’a été modifié. **Préparation Admin techniquement disponible ; pas prêt Production.**
