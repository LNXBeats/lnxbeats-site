# Premium V3 — diagnostic Linux et correctif mémoire Web

## Périmètre

La base Production auditée est `ee7fb063a306348378fb43faf5be420b38047791`.
Le candidat Premium avant ce correctif est
`908e6a6b09ea1e75e61879de0c10341b807ce397`.
Les fonctionnalités et captures Premium déjà validées ne sont pas refaites.
Les 39 migrations Production et Preview concordent avec le candidat, checksums
compris. Aucune migration ni modification métier n'est ajoutée ici.

## Observations réellement effectuées

Les essais du 3 octobre 2026 utilisent le conteneur Linux Web Preview existant,
PostgreSQL et R2 Preview, une authentification QA normale et des images
synthétiques. Aucun média client n'est téléchargé. Les brouillons de diagnostic
sont supprimés par le mécanisme applicatif réservé à leur propriétaire.

Le premier parcours dure 19,69 minutes : 395 requêtes réussies, quatre cycles
de quatre photos JPEG de 4032 × 3024 pixels, sauvegardes Commander, Admin,
recherche, aperçus/téléchargements privés et lectures publiques mélangées.
Les photos font environ 4,13 Mio chacune, avec de vrais pixels bruités, pas du
remplissage ajouté à une petite image. Les quatre brouillons sont nettoyés.

| Point | RSS observé (Mio) |
| --- | ---: |
| Après public et repos | 228,46 |
| Après Admin et repos | 245,84 |
| Pic échantillonné pendant les photos | 690,29 |
| Après cinq minutes de repos final | 479,38 |

Au repos final : heapUsed 90,06 Mio, external 25,79 Mio et arrayBuffers 4,88 Mio.
`arrayBuffers` est inclus dans `external` : ces valeurs ne doivent pas être
additionnées. Une instance Prisma a été réellement construite/observée ; le
pool monte à dix connexions puis revient à zéro, sans attente persistante.
Il ne s'agit pas d'une preuve universelle sur toutes les routes possibles.

Le cache applicatif Sharp était **déjà désactivé**, avec concurrence **1**.
Ces protections ne sont pas réimplémentées. Le défaut ne peut pas être attribué
à une multiplication de Prisma dans ce parcours. Les buffers et le heap seuls
n'expliquent pas la hausse de RSS ; les pages anonymes natives augmentent.

## Expérience causale sur l'allocateur

Sur glibc 2.41, trois processus frais exécutent successivement la même séquence
de seize conversions JPEG → WebP, mêmes fichiers, cache Sharp désactivé,
concurrence un, sans DB, sans R2 et sans GC forcé.

| Configuration | Pic RSS (Mio) | Repos final (Mio) | Conversion cumulée (s) |
| --- | ---: | ---: | ---: |
| Défaut A | 551,76 | 168,68 | 58,62 |
| Deux arènes B | 471,25 | 219,84 | 59,88 |
| Défaut A confirmé | 565,81 | 259,79 | 58,26 |

Le repos natif varie : le micro-test ne suffit pas seul à valider une release.
La comparaison HTTP suivante utilise le même SHA, les mêmes quatre fichiers
(empreintes identiques), les mêmes requêtes et le même repos final :

| Configuration HTTP | Pic RSS (Mio) | RSS pendant le repos final (Mio) | Upload moyen (ms) |
| --- | ---: | ---: | ---: |
| Défaut | 677,49 | 408,55 | 4 985 |
| Deux arènes | 572,63 | environ 323 | 4 710 |

Cela isole une contribution importante de l'allocateur natif au coût du
traitement d'images : environ 15,5 % de moins au pic et 21 % au repos dans ce
parcours. Cela ne prouve ni l'absence universelle de fuite, ni l'explication de
chaque pic historique Production. La lecture agrégée des métadonnées existantes
montre des références allant jusqu'à 24,47 Mpx ; un test prolongé doit aussi
couvrir des dimensions supérieures aux 12 Mpx du témoin.

La [documentation officielle Sharp](https://sharp.pixelplumbing.com/performance/)
décrit la fragmentation glibc et le réglage de deux ou quatre arènes avant le
démarrage de Node. Ici, ce réglage n'est retenu qu'après les comparaisons Linux.

## Correctif minimal

- `npm start` fournit `MALLOC_ARENA_MAX=2` avant le démarrage du processus Next.
  Cela borne les arènes glibc ; ce n'est pas une limite de heap V8 ni de RAM.
- `experimental.imgOptConcurrency: 1` préserve explicitement la concurrence du
  chemin Next/Image à froid. La présence de `MALLOC_ARENA_MAX` permet sinon à
  Sharp de reprendre un défaut basé sur le nombre de CPU sous Linux.
- Aucun changement du cache existant, du pipeline photo, des données, de la
  qualité WebP ou de la taille admissible. Aucun GC forcé ni redémarrage périodique.
- Les commandes du worker média, des notifications, de la maintenance et du
  provisionneur restent inchangées. Aucun réglage global Railway n'est ajouté.

## Diagnostic temporaire et limites

Le harnais est hors Git, limité à la Preview exacte et à un port loopback.
Il ne crée aucun endpoint public. Les snapshots mesurent mémoire Node,
`/proc/self/status`, GC naturel, handles/listeners et pools observés ; un hook
temporaire en mémoire compte les constructions Prisma sans journaliser de DB,
requête, environnement, cookie ou URL signée. Les métriques absentes sont
`NOT_MEASURED`, pas zéro. Les processus diagnostiques ont une durée bornée.

La première matrice utilise un échantillonnage de dix secondes et des points
avant/après opération. La comparaison utilise en plus un pic RSS échantillonné
toutes les 100 ms. Ce sont des pics observés, pas une garantie de maximum absolu.
Le parcours Commander est exercé par son contrat HTTP ; ce n'est pas une nouvelle
recette physique iPhone. La recette iPhone déjà acquise n'est pas remplacée.

## Ancien patch Railway

Le contenu exact du patch `6e55d95b-e01d-4b13-b1a0-80a5e013118e` a été relu.
Il épinglait une ancienne source et supprimait trois variables diagnostiques.
Le « resource update » n'était pas une augmentation de RAM.
Après vérification des quatre changements, son contenu a été vidé explicitement
sans commit/deploy Railway. La relecture retourne un patch vide et aucun staged
change Web. L'enregistrement historique vide peut conserver son ID ; il ne
contient plus de configuration ancienne susceptible d'être appliquée.

## Gates restant obligatoires pour la promotion

Cette note ne constitue pas une autorisation de sauter les gates :

1. Suite canonique, lint, TypeScript, build, Prisma, audit, diff et secrets sur
   le candidat final ; zéro vulnérabilité Production.
2. Preview au SHA final et soak représentatif de 60–120 minutes, sans croissance
   continue, crash ou OOM ; images, Admin, Commander et médias privés compris.
3. Nouvelle sauvegarde Production chiffrée et restauration réelle isolée.
4. Fetch final, fast-forward uniquement, déploiement du SHA exact et maintien du
   pre-deploy Prisma puis `database:provision-creations-runtime`.
5. Smoke et observation mémoire Production, sans paiement/email QA ni mutation
   d'une commande réelle. Analytics peut rester PENDING ; soutien désactivé.

Le rollback applicatif rétablit aussi l'ancienne commande `npm start`, sans
restauration de DB ni down migration. Aucun changement de plan ou de limite RAM
n'est nécessaire pour ce correctif. Les résultats finaux du soak, du backup et
de la promotion doivent être consignés séparément avec leurs timestamps réels.

## Incident préexistant découvert pendant l'observation après promotion

Le Web a effectivement atteint `SUCCESS` sur `655f41e` le 3 octobre à
19:56:32 UTC, après tous les gates préalables, 72 minutes de soak et une nouvelle
restauration complète. À 20:12, un POST Admin catalogue audio réel a cependant
retourné 400 : le proxy avait tronqué son multipart à 10,06 Mio alors que le
handler audio accepte 80 Mio. Cette limite globale était déjà dans le main de
départ `ee7fb06`, pas introduite par le correctif d'allocateur.

Le correctif local suivant exclut les API du proxy de canonicalisation. Celui-ci
retournait déjà `none` pour ces routes : aucune authentification ni règle d'origine
n'est retirée. Les handlers gardent leurs limites autoritaires (photos 10 Mio,
audio catalogue 80 Mio), leur streaming et leur contrôle Admin/same-origin.
Le parseur catalogue observe immédiatement ses erreurs de flux, attend la fin de
l'écriture avant nettoyage et ne laisse plus de promesse rejetée non traitée.

Un test synthétique reproduit `Unexpected end of form` et l'unhandled rejection
avant correction ; il passe après. La recette HTTP locale isolée accepte des WAV
de 17 199 102 et 83 613 702 octets, produit un extrait MP3 de 60 secondes, refuse
l'accès public au brouillon, sert un Range authentifié 206 et nettoie ses fichiers.
Cette preuve locale n'est pas présentée comme une nouvelle recette R2 Production.

Un build automatique du worker sur `655f41e` a échoué après être resté à
« Collecting page data using 31 workers » ; les logs retournés ne donnent pas sa
cause finale. L'ancien worker est resté RUNNING/SUCCESS, sans OOM observé. Aucun
réglage worker n'est changé et aucun redéploiement manuel improvisé n'est lancé.
Une nouvelle promotion reste suspendue à la clarification de ce build et à la
validation Preview du correctif audio. Le rapport final doit distinguer le SHA
Web réellement déployé du commit correctif local non promu.

La demande supplémentaire concernant « VIE DE CHIEN » a été auditée en lecture
seule : la position jukebox 1 est bien persistée, mais la page discographie omet
ce champ de sa projection et trie par `catalogPosition` (26). Aucun classement
Production n'a été modifié dans cette investigation.
