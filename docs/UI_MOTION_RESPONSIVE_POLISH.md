# Polissage UI, mouvement et responsive

## Conformité visuelle V2

La seconde passe remplace le simple polissage V1 par une composition directement guidée par le pack `LNX_CODEX_UI_V2_FINAL`. Les données et comportements du dépôt restent la source fonctionnelle ; le pack reste la source visuelle.

| Surface | Traduction V2 | Garde-fou fonctionnel |
| --- | --- | --- |
| Accueil | photo officielle dominante, wordmark officiel, hero compact et projet à la une | projets et textes issus des sources existantes |
| Discographie | scène centrale 3D, halo doré, couverture active dominante et couvertures latérales inclinées | filtres, sélection, lecture et continuité audio inchangés |
| Album | couverture forte sur fond cinématographique, informations et chapitres mieux hiérarchisés | aucune piste, date, plateforme ou pochette inventée |
| Commander | hero photographique et formulaire plus dense | six étapes, champs, validation, prix, payloads et paiements inchangés |
| Boutique / produit | hero photographique, catalogue réel et fiche CD structurée | stock qualitatif, tarifs et serveur de commande inchangés |
| À propos | portrait plus présent, lecture éditoriale et appel final doré | biographie existante conservée, aucun bloc rejeté réintroduit |

Les fichiers officiels sont conservés byte-for-byte :

- `hero-ludovic-dog-exact.jpeg` — SHA-256 `2c4168c5c6964a08d229fe9e2d6575014804f84c13fe1e12b45654fad3efb2c7` ;
- `lnx-beats-apple-artist-logo-exact.jpeg` — SHA-256 `0f86e74b10bcfb2ddec01e9941d60a50a6b0970968ebf52a653b77efad7993d7`.
- `lnx-beats-signature-user-exact.jpg` — SHA-256 `d138714dd5b700a5ff9f648b148db060fea3f6f2d20d002e47bd692a1ef166e3`, nouvelle signature fournie directement par Ludovic pendant la revue.
- `lnx-beats-signature-user-transparent.png` — SHA-256 `41eea84cd7db50aaf491aea6936685b828b241e8be2bf2e5acad4fe36dd72bfd`, dérivé de la signature fournie avec le damier extérieur converti en véritable canal alpha.

Les trois images marquées comme références de visage/chien n’entrent ni dans `public/`, ni dans le rendu, ni dans les tests. Aucune génération d’image n’est utilisée.

Ce lot affine uniquement la présentation publique de LNX Beats. Il ne modifie ni les données, ni les prix, ni le stock, ni les parcours de commande, de paiement, d’authentification ou de remboursement.

## Principes

- mouvements courts et cinématographiques avec CSS natif et `requestAnimationFrame` ;
- révélations progressives avec `IntersectionObserver`, sans masquer le contenu lorsque JavaScript ou l’API ne sont pas disponibles ;
- désactivation des mouvements avec `prefers-reduced-motion` ;
- profondeur discrète issue des tons de pochettes déjà présents dans le catalogue ;
- navigation active mesurée depuis le lien courant, sans modifier les routes ;
- mise en page vérifiée aux largeurs 375, 390, 430, 768, 1024 et 1440 pixels ;
- stock public présenté qualitativement (`Disponible`, `Temporairement indisponible`, `Épuisé`) tandis que les bornes de quantité restent contrôlées par le serveur.

Les neuf maquettes complémentaires fournies par Ludovic constituent la cible finale de composition. Le site Ponpon Mania a uniquement servi de référence de mouvement : dérive ambiante, révélations courtes, profondeur légère au survol et transitions contenues. Aucun rendu WebGL, aucune identité tierce et aucune dépendance supplémentaire n'ont été repris.

## Surfaces concernées

Accueil, Discographie/Jukebox, fiches album, Commander, Boutique, fiche produit et À propos, ainsi que le header et le footer partagés.

## Garde-fous

Le menu clavier, le focus visible, les cibles tactiles, les deux jukebox, l’audio Safari, les liens DistroKid, l’absence publique d’Etsy et toute la logique commerciale existante restent inchangés. Aucune nouvelle dépendance n’est ajoutée.
