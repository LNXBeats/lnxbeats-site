# Discographie 3D et lecture continue

La page `/discographie` repose sur une seule lecture PostgreSQL et une seule scène React. Elle présente dans cette scène l’ensemble des projets publics documentés, qu’ils soient publiés ou en développement. La grille compacte et le second jukebox ont été retirés de cette page : aucun catalogue parallèle n’est maintenu.

## Contrat éditorial

- `publicVisible` autorise ou masque le projet sur toutes les surfaces publiques ;
- seuls les statuts `PUBLISHED` et `IN_DEVELOPMENT` entrent dans la requête publique ;
- `catalogPosition` fournit l’ordre éditorial stable de la scène ;
- `releaseDate` permet les tris chronologiques sans inventer de date ;
- une cover officielle est rendue par sa route média PostgreSQL/R2 ;
- en l’absence de cover, `ProjectArtwork` affiche le visuel éditorial provisoire déjà prévu par le catalogue.

Les champs `jukeboxPlacement` et `jukeboxPosition` restent disponibles pour les surfaces promotionnelles historiques. La nouvelle scène « Tous les projets » est volontairement exhaustive : ils n’en excluent pas un projet public. Un nouvel album admissible apparaît ainsi sans ajout manuel dans le code dès que son statut et sa visibilité le rendent public ; sa cover officielle prend automatiquement la place du visuel éditorial lorsqu’elle est ajoutée.

`publicVisible = false` retire toujours le projet de la liste, de sa fiche directe, du sitemap et des routes publiques de cover/audio. `data/discography.ts` demeure une fixture historique sans fallback runtime.

## Filtres et tri

Les vues `Tous`, `Albums`, `Singles` et `Projets en développement` sont dérivées de la même collection reçue du serveur. Leurs compteurs ne sont pas codés en dur. Le tri propose l’ordre éditorial, le plus récent et le plus ancien ; les projets sans date restent à la fin et sont départagés par `catalogPosition`, puis par slug.

Le changement de filtre ne remonte pas le composant et ne recrée pas l’élément audio. Si le projet actif appartient encore au filtre, il reste actif. Sinon, la scène choisit le premier projet visible via le même chemin de navigation que les flèches et le clavier.

## Interaction et audio

Sur desktop, l’index actif positionne cinq cartes en `-2`, `-1`, `0`, `+1`, `+2` avec perspective, rotation Y, profondeur et échelle. L’index initial garde deux voisins de chaque côté lorsqu’il y a assez de projets, afin que la profondeur soit perceptible dès l’ouverture. Sur tablette, la scène conserve la carte active et ses deux voisines avec une profondeur réduite. Sur mobile, les mêmes données passent dans un rail tactile `scroll-snap` natif : une carte centrale et les aperçus de ses voisines restent visibles.

Le cœur audio validé reste inchangé :

- aucun autoplay au chargement ;
- un premier Play volontaire ;
- navigation avant Play silencieuse ;
- après déverrouillage, navigation vers un projet avec preview automatiquement lue ;
- projet sans preview silencieux sans perdre le mode continu ;
- pause volontaire désactivant l’enchaînement ;
- reprise volontaire le réactivant ;
- un seul élément `<audio>` et une seule source active ;
- coordination avec les autres lecteurs par `lnx-audio-preview-play` ;
- protection des promesses `play()` pour Safari et les navigations rapides.

Un projet, publié ou en développement, ne reçoit un bouton Play que lorsqu'une preview publique, validée et réellement reliée au projet existe. Les filtres et le tri manipulent les indices visibles tout en conservant les indices globaux utilisés par la machine audio.

## Performance et accessibilité

La scène utilise uniquement des transforms CSS ; elle n’ajoute ni WebGL, ni canvas, ni dépendance de carousel. L’élément audio ne charge que la preview active. Les images proches peuvent être prioritaires, les autres conservent le chargement différé de `next/image`.

Les flèches sont de vrais boutons, les cartes voisines sont sélectionnables, les flèches clavier parcourent la vue filtrée et le projet actif est annoncé dans une zone live. Les filtres utilisent `aria-pressed`, le tri reste un `select` natif et chaque focus reste visible.

Avec `prefers-reduced-motion: reduce`, transitions, rotations, profondeur et respiration sont neutralisées. La carte active, les voisines, les filtres, le tri et Play/Pause restent utilisables ; aucun contenu actif n’est laissé invisible.
