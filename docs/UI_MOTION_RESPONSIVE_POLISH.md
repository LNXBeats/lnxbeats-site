# Polissage UI, mouvement et responsive

Ce lot affine uniquement la présentation publique de LNX Beats. Il ne modifie ni les données, ni les prix, ni le stock, ni les parcours de commande, de paiement, d’authentification ou de remboursement.

## Principes

- mouvements courts et cinématographiques avec CSS natif et `requestAnimationFrame` ;
- révélations progressives avec `IntersectionObserver`, sans masquer le contenu lorsque JavaScript ou l’API ne sont pas disponibles ;
- désactivation des mouvements avec `prefers-reduced-motion` ;
- profondeur discrète issue des tons de pochettes déjà présents dans le catalogue ;
- navigation active mesurée depuis le lien courant, sans modifier les routes ;
- mise en page vérifiée aux largeurs 360, 390, 430, 768, 1024, 1280, 1440 et 1920 pixels ;
- stock public présenté qualitativement (`Disponible`, `Temporairement indisponible`, `Épuisé`) tandis que les bornes de quantité restent contrôlées par le serveur.

## Surfaces concernées

Accueil, Discographie/Jukebox, fiches album, Commander, Boutique, fiche produit et À propos, ainsi que le header et le footer partagés.

## Garde-fous

Le menu clavier, le focus visible, les cibles tactiles, les deux jukebox, l’audio Safari, les liens DistroKid, l’absence publique d’Etsy et toute la logique commerciale existante restent inchangés. Aucune nouvelle dépendance n’est ajoutée.
