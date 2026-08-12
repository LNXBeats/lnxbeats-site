# Jukeboxes et discographie dynamiques

La page `/discographie` repose sur une seule lecture PostgreSQL structurée. Elle construit le catalogue publié, le jukebox des parutions et, uniquement lorsqu’il possède au moins un projet éligible, le jukebox des créations en développement. Le composant `ProjectJukebox` est partagé par les deux collections : aucune variante du player ni source de vérité parallèle n’est maintenue.

## Contrat éditorial

La publication publique et le placement dans un jukebox sont explicites :

- `publicVisible` autorise ou masque le projet sur toutes les surfaces publiques ;
- `status` garde sa signification éditoriale (`PUBLISHED`, `IN_DEVELOPMENT`, `DRAFT`, `ARCHIVED`) ;
- `jukeboxPlacement` choisit `PUBLISHED`, `DEVELOPMENT` ou aucun jukebox ;
- `jukeboxPosition` fixe l’ordre voulu sans dépendre de l’ordre SQL implicite.

Un projet n’entre dans un jukebox que si sa visibilité, son statut, son placement et sa cover concordent. Les positions nulles viennent après les positions explicites ; les trous et doublons sont départagés par `catalogPosition`, puis par slug. La migration V0.6.1 conserve tous les projets publics existants et initialise le placement des projets déjà dotés d’une cover à partir de leur statut documenté.

`publicVisible = false` retire également le projet de la fiche directe, du sitemap et des routes publiques de cover/audio. PostgreSQL reste l’unique source runtime ; `data/discography.ts` demeure une fixture historique sans fallback.

## Interaction et audio

Sur desktop, une scène pilotée par l’index actif positionne les cinq covers les plus proches en `-2`, `-1`, `0`, `+1`, `+2`. Les transitions ne touchent qu’à `transform` et `opacity`. Sur mobile, le même état et les mêmes données sont reliés à un rail tactile `scroll-snap` natif. Les flèches symétriques possèdent une cible circulaire de 48 px, restent alignées sur la cover et sont accompagnées d’une consigne adaptée au pointeur ou au geste tactile.

Le client ne reçoit que le slug, le titre, l’année, l’URL publique de la cover, son alt et l’éventuel extrait public. Une cover sans extrait reste navigable, sans faux bouton Play. Chaque jukebox conserve un unique élément `<audio>` et les players publics partagent l’événement `lnx-audio-preview-play` : le démarrage d’un player arrête les autres, y compris entre les deux jukeboxes.

Après une première lecture acceptée par le navigateur, `audioUnlocked` et `continuousPlayback` autorisent l’enchaînement sur la cover suivante. Un projet sans extrait impose le silence sans perdre ce mode ; une pause volontaire le désactive et un nouveau Play le réactive. Chaque promesse `play()` est protégée contre les refus Safari et les navigations rapides. Le modèle validé en V0.6.0.5 n’est pas réécrit ; V0.6.1 ajoute seulement la coordination inter-jukebox.

## Performance et accessibilité

La cover active et ses voisines immédiates peuvent être prioritaires dans le premier jukebox ; le second reste différé. Aucun chargement groupé de tous les extraits n’est déclenché. Les commandes sont nommées, utilisables au clavier et bornées aux extrémités. `prefers-reduced-motion: reduce` neutralise la perspective animée et la respiration sans masquer le contenu ni modifier l’audio.

Le catalogue compact affiche douze fiches puis un élément `<details>` natif pour le reste. Tout le contenu reste rendu côté serveur et accessible sans pagination client ni JavaScript supplémentaire.
