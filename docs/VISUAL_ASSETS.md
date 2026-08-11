# Assets visuels — état V0.6.0.2

## Inventaire utilisé

| Fichier | Dimensions | Poids | Format | Usage actuel |
| --- | ---: | ---: | --- | --- |
| `public/assets/hero-desktop.jpg` | 1025 × 405 px | 88 327 octets | JPEG | Hero et décors larges. Servi par `next/image` aux largeurs adaptées au viewport lorsque l'image est rendue comme contenu. |
| `public/assets/hero-mobile.jpg` | 515 × 420 px | 49 577 octets | JPEG | Portrait, chapitre intime et cartes photographiques. Le cadrage vertical est privilégié sur petit écran. |

Les deux fichiers sont des assets officiels existants. Ils sont réutilisés avec des cadrages, gradients et traitements CSS sobres ; aucun portrait n'est inventé et aucune image n'est agrandie artificiellement hors de sa définition source.

## Limite connue

Le master HD de la photographie principale n'est pas disponible. Le fichier desktop de 1025 × 405 px suffit pour la prévisualisation et bénéficie du pipeline d'optimisation de Next.js, mais la netteté des très grands écrans pourra progresser lorsqu'un master officiel de plus haute définition sera fourni.

## Besoins futurs documentés

- Un portrait officiel vertical HD pour les chapitres artiste et membre.
- Une photographie officielle horizontale d'au moins 2400 px de large pour les écrans 1440–1920 px.
- Des pochettes officielles par projet pour remplacer les compositions éditoriales générées en CSS.
- Un teaser, clip ou extrait live officiel pour la fenêtre vidéo préparée conceptuellement ; aucun player n'est chargé avant réception d'un contenu validé.
- Des variantes de cadrage approuvées pour mobile, tablette et desktop.

Chaque nouvel asset devra préciser sa provenance, son auteur ou détenteur, ses droits d'usage, son format maître et les déclinaisons exportées pour le web.
