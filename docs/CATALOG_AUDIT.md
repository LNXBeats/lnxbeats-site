# Audit du catalogue et des assets — V0.3.4

## Portée et méthode

Cet audit couvre les 25 entrées de `data/discography.ts` et les assets locaux du dépôt. Il n’utilise ni recherche Internet, ni déduction à partir d’un nom de fichier, ni information issue d’une date Git. `data/discography.ts` reste l’unique source runtime ; ce document ne sert qu’au suivi humain et à la préparation d’une future migration.

Niveaux utilisés :

- `C` — `CONFIRMED` : explicitement présent dans une source locale autorisée ;
- `P` — `PARTIAL` : une partie seulement du domaine est documentée ;
- `H` — `PLACEHOLDER` : présentation éditoriale volontairement provisoire ;
- `U` — `UNKNOWN` : aucune information autorisée ne permet de renseigner le champ.

Les textes courts et longs marqués `C*` sont confirmés comme **copies éditoriales locales**. Ils ne constituent pas une preuve indépendante d’une date, d’un crédit, d’un genre ou d’une disponibilité commerciale.

## Synthèse chiffrée

- 25 projets : 19 publiés, 6 en développement ;
- 10 albums, 9 singles et 6 projets sans format de sortie définitif ;
- 0 projet totalement confirmé sur tous les domaines audités ;
- 19 projets globalement `PARTIAL` ;
- 6 projets globalement `PLACEHOLDER` ;
- 25 projets nécessitant encore une intervention humaine ;
- 0 pochette officielle locale ;
- 1 tracklist complète confirmée ;
- 10 projets avec nombre de pistes confirmé mais titres non documentés ;
- 14 projets sans tracklist confirmée ;
- 0 date ou année de sortie documentée ;
- 1 lien direct de sortie documenté ;
- 19 projets reliés uniquement aux profils artiste généraux, à l’exception de ce lien direct ;
- 0 genre et 0 crédit documentés.

## Inventaire — identité et éditorial

| Slug | Titre | Type | Statut | Année / date | Description courte | Ouverture longue | Featured | Confiance globale |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `jai-adopte-un-humain` | J’ai adopté un humain | Single — C | Publié — C | U | C* | C* | Oui — C | P |
| `bienvenue-dans-le-bordel-familial` | Bienvenue dans le bordel familial | Album — C | Publié — C | U | C* | C* | Oui — C | P |
| `jai-adopte` | J’ai adopté | Album — C | Publié — C | U | C* | C* | Oui — C | P |
| `jai-adopte-un-humain-album` | J’ai adopté un humain | Album — C | Publié — C | U | C* | C* | Non — C | P |
| `les-comptines-version-adulte-v2` | Les comptines (version adulte) V2 | Album — C | Publié — C | U | C* | C* | Non — C | P |
| `chaos-canin` | Chaos canin | Album — C | Publié — C | U | C* | C* | Oui — C | P |
| `les-merdes-du-quotidien` | Les merdes du quotidien | Album — C | Publié — C | U | C* | C* | Non — C | P |
| `les-comptines-version-adulte` | Les comptines (version adulte) | Album — C | Publié — C | U | C* | C* | Non — C | P |
| `le-collegue-ambiance-toxique` | Le collègue « ambiance toxique » | Album — C | Publié — C | U | C* | C* | Non — C | P |
| `avant-vs-maintenant` | Avant vs maintenant | Album — C | Publié — C | U | C* | C* | Non — C | P |
| `les-employes-du-bureau` | Les employés du bureau | Album — C | Publié — C | U | C* | C* | Non — C | P |
| `ca-va-lfaire` | Ça va l’faire | Single — C | Publié — C | U | C* | C* | Non — C | P |
| `jai-adopte-un-bebe` | J’ai adopté un bébé | Single — C | Publié — C | U | C* | C* | Non — C | P |
| `jai-adopte-une-femme` | J’ai adopté une femme | Single — C | Publié — C | U | C* | C* | Non — C | P |
| `jai-adopte-un-homme` | J’ai adopté un homme | Single — C | Publié — C | U | C* | C* | Non — C | P |
| `jprefere-le-carton` | J’préfère le carton | Single — C | Publié — C | U | C* | C* | Non — C | P |
| `mon-humain-me-parle-bizarre` | Mon humain me parle bizarre | Single — C | Publié — C | U | C* | C* | Non — C | P |
| `la-galette-des-rois` | La galette des rois | Single — C | Publié — C | U | C* | C* | Non — C | P |
| `madame-piecettes` | Madame Piécettes | Single — C | Publié — C | U | C* | C* | Non — C | P |
| `miss-click` | Miss Click | Projet — C | En développement — C | U | H | H | Non — C | H |
| `le-dernier-age-dor` | Le Dernier Âge d’Or | Projet — C | En développement — C | U | H | H | Non — C | H |
| `lado` | L’ADO | Projet — C | En développement — C | U | H | H | Non — C | H |
| `good-vibe` | Good Vibe | Projet — C | En développement — C | U | H | H | Non — C | H |
| `les-pires-voisins` | Les pires voisins | Projet — C | En développement — C | U | H | H | Non — C | H |
| `laboratoire-narratif` | Laboratoire narratif | Projet — C | En développement — C | U | H | H | Non — C | H |

## Inventaire — données musicales et assets

| Slug | Pochette | Nombre de pistes | Tracklist | Profils artiste | Lien direct de sortie | Genres | Crédits | SEO | Action humaine principale |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `jai-adopte-un-humain` | H | 1 — C | 1/1 — C | Spotify, Apple Music, Deezer — C | YouTube — C | U | U | P | Fournir pochette, date, genres, crédits et éventuels autres liens directs. |
| `bienvenue-dans-le-bordel-familial` | H | 18 — C | Titres absents — P | 3 profils — C | U | U | U | P | Fournir pochette, date, tracklist ordonnée, genres, crédits et liens directs. |
| `jai-adopte` | H | 13 — C | Titres absents — P | 3 profils — C | U | U | U | P | Fournir pochette, date, tracklist ordonnée, genres, crédits et liens directs. |
| `jai-adopte-un-humain-album` | H | 16 — C | Titres absents — P | 3 profils — C | U | U | U | P | Fournir pochette, date, tracklist ordonnée, genres, crédits et liens directs. |
| `les-comptines-version-adulte-v2` | H | 20 — C | Titres absents — P | 3 profils — C | U | U | U | P | Fournir pochette, date, tracklist ordonnée, genres, crédits et liens directs. |
| `chaos-canin` | H | 21 — C | Titres absents — P | 3 profils — C | U | U | U | P | Fournir pochette, date, tracklist ordonnée, genres, crédits et liens directs. |
| `les-merdes-du-quotidien` | H | 31 — C | Titres absents — P | 3 profils — C | U | U | U | P | Fournir pochette, date, tracklist ordonnée, genres, crédits et liens directs. |
| `les-comptines-version-adulte` | H | 27 — C | Titres absents — P | 3 profils — C | U | U | U | P | Fournir pochette, date, tracklist ordonnée, genres, crédits et liens directs. |
| `le-collegue-ambiance-toxique` | H | 13 — C | Titres absents — P | 3 profils — C | U | U | U | P | Fournir pochette, date, tracklist ordonnée, genres, crédits et liens directs. |
| `avant-vs-maintenant` | H | 16 — C | Titres absents — P | 3 profils — C | U | U | U | P | Fournir pochette, date, tracklist ordonnée, genres, crédits et liens directs. |
| `les-employes-du-bureau` | H | 25 — C | Titres absents — P | 3 profils — C | U | U | U | P | Fournir pochette, date, tracklist ordonnée, genres, crédits et liens directs. |
| `ca-va-lfaire` | H | U | U | 3 profils — C | U | U | U | P | Fournir pochette, date, tracklist, genres, crédits et liens directs. |
| `jai-adopte-un-bebe` | H | U | U | 3 profils — C | U | U | U | P | Fournir pochette, date, tracklist, genres, crédits et liens directs. |
| `jai-adopte-une-femme` | H | U | U | 3 profils — C | U | U | U | P | Fournir pochette, date, tracklist, genres, crédits et liens directs. |
| `jai-adopte-un-homme` | H | U | U | 3 profils — C | U | U | U | P | Fournir pochette, date, tracklist, genres, crédits et liens directs. |
| `jprefere-le-carton` | H | U | U | 3 profils — C | U | U | U | P | Fournir pochette, date, tracklist, genres, crédits et liens directs. |
| `mon-humain-me-parle-bizarre` | H | U | U | 3 profils — C | U | U | U | P | Fournir pochette, date, tracklist, genres, crédits et liens directs. |
| `la-galette-des-rois` | H | U | U | 3 profils — C | U | U | U | P | Fournir pochette, date, tracklist, genres, crédits et liens directs. |
| `madame-piecettes` | H | U | U | 3 profils — C | U | U | U | P | Fournir pochette, date, tracklist, genres, crédits et liens directs. |
| `miss-click` | H | U | U | U | U | U | U | P | Confirmer le format, puis fournir tous les éléments officiels avant publication. |
| `le-dernier-age-dor` | H | U | U | U | U | U | U | P | Confirmer le format, puis fournir tous les éléments officiels avant publication. |
| `lado` | H | U | U | U | U | U | U | P | Confirmer le format, puis fournir tous les éléments officiels avant publication. |
| `good-vibe` | H | U | U | U | U | U | U | P | Confirmer le format, puis fournir tous les éléments officiels avant publication. |
| `les-pires-voisins` | H | U | U | U | U | U | U | P | Confirmer le format, puis fournir tous les éléments officiels avant publication. |
| `laboratoire-narratif` | H | U | U | U | U | U | U | P | Confirmer sa nature éditoriale avant toute modélisation comme sortie musicale. |

## Assets locaux

| Chemin | Dimensions | Format | Poids | Utilisation | Statut |
| --- | ---: | --- | ---: | --- | --- |
| `public/assets/hero-desktop.jpg` | 1025 × 405 | JPEG | 88 327 octets | Hero de l’accueil via `next/image`, `fill`, `sizes="100vw"`, preload LCP | Asset Hero actuellement officiel ; master et provenance HD non documentés. |
| `public/assets/hero-mobile.jpg` | 515 × 420 | JPEG | 49 577 octets | Photographie de la page À propos via `next/image`, `fill` et `sizes` | Asset actuellement officiel ; master HD non documenté. Préchargement retiré après audit ; chargement paresseux. |
| `public/og.png` | 1200 × 630 | PNG | 1 026 691 octets | Open Graph et Twitter globalement et sur les fiches | Carte sociale officielle actuellement utilisée. |

Poids total de `public/` : 1 164 595 octets pour trois fichiers. Les empreintes SHA-256 sont toutes distinctes ; aucun doublon binaire n’est détecté.

### Asset historique exclu

`public/assets/design-reference.jpg` existait dans le commit initial puis a été supprimé comme référence inutilisée. Il mesure 1448 × 1086 et représente un montage de maquettes desktop/mobile, pas un master photographique autonome. Son origine officielle n’est pas documentée et il n’est associé à aucun projet : il ne doit pas être réintégré.

### Pochettes officielles

Aucune. Les 25 fiches conservent un visuel CSS provisoire dont le libellé indique explicitement qu’aucune pochette officielle n’est disponible.

### Logo, icône et backgrounds

- le logo visible est typographique et rendu par les composants/CSS ;
- l’icône est générée par `app/icon.tsx`, sans fichier raster statique ;
- aucun autre background, portrait, SVG ou ancien visuel exploitable n’est présent dans le dépôt.

## Photo Hero HD

- master HD trouvé : **non** ;
- version desktop disponible : 1025 × 405, JPEG, 88 327 octets ;
- version mobile disponible : 515 × 420, JPEG, 49 577 octets ;
- comportement Retina : définition insuffisante pour restituer deux pixels source par pixel CSS sur les grands écrans ;
- action : aucun remplacement ni upscale artificiel. **MASTER HD MANQUANT**.

## SEO et données structurées

Les 25 fiches utilisent leur titre réel et une description éditoriale locale sans date, crédit, genre, tracklist ou disponibilité inventés. Leur SEO reste `PARTIAL` faute d’assets et de données de sortie propres à chaque projet. Le JSON-LD global reste limité à `MusicGroup` et aux profils officiels du site ; aucune fiche ne produit artificiellement `MusicAlbum` ou `MusicRecording`.

## Entités probables pour une future base PostgreSQL

- `Project` / `Release` : identité, type, statut, éditorial, date nullable et mise à la une ;
- `Track` : titre, position nullable tant qu’elle n’est pas confirmée, durée et statut ;
- `PlatformLink` : plateforme, URL et portée `artist`, `release` ou `store` ;
- `Credit` : personne ou entité, rôle et précision libre ;
- `Asset` : fichier, type d’usage, dimensions, provenance et association optionnelle à un projet ;
- `ConfidenceAnnotation` : niveau de confiance, domaine concerné, source et date de vérification.

Aucune migration, table, API, couche Prisma ou base de données n’est créée par ce sprint.

## Collecte humaine requise

Pour chaque projet publié, le propriétaire doit fournir ou confirmer :

1. pochette officielle et master source ;
2. date de sortie ou année exacte ;
3. tracklist ordonnée, durée et statut de chaque piste ;
4. genres réellement revendiqués ;
5. crédits nominatifs et rôles ;
6. URL directes propres à la sortie sur chaque plateforme ;
7. validation finale des descriptions éditoriales et metadata.

Pour les six projets en développement, il faut d’abord confirmer le format réel, le statut public et l’autorisation de les exposer avant de collecter le reste. Un master HD autonome du Hero doit également être fourni si un rendu Retina est souhaité.
