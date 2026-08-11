# Catalog Runtime Migration

## État Phase 3

Le catalogue public utilise exclusivement `data/discography.ts` à l’exécution. Il contient 25 projets éditoriaux et reste la source de vérité du site public. La sélection de la page d’accueil est isolée dans `data/home.ts`.

Le modèle PostgreSQL `Project` existe avec ses relations `Track`, `PlatformLink`, `Credit`, `ConfidenceAnnotation` et `ProjectAsset`. La Phase 3 audite ces lignes en lecture seule depuis `/admin/catalogue`, sans synchronisation implicite et sans bascule du frontend public.

Cette séparation est volontaire : écrire seulement dans PostgreSQL aujourd’hui créerait deux sources actives incohérentes. Écrire seulement dans le fichier TypeScript depuis une interface runtime serait également trompeur et inadapté à la production.

## Sprint dédié requis

Le sprint « Catalog Runtime Migration » devra :

1. établir un mapping déterministe des 25 projets locaux vers `Project` ;
2. conserver les niveaux de confiance et les champs inconnus sans les inventer ;
3. migrer les tracklists, liens, crédits et assets documentés ;
4. comparer chaque fiche locale et chaque ligne PostgreSQL avant activation ;
5. choisir PostgreSQL comme source runtime unique seulement après validation ;
6. supprimer ensuite le chemin d’écriture devenu obsolète, sans période durable de double écriture.

## Covers officielles

L’ajout d’une cover ne sera activé qu’avec un stockage final cohérent et un workflow qui enregistre le fichier, l’alt text, les dimensions, le format, la provenance, la confirmation des droits, un `Asset` et la relation `ProjectAsset` avec le rôle `COVER`.

La Phase 3 n’effectue aucun upload temporaire, ne fabrique aucune pochette et n’affiche aucun bouton de sauvegarde fictif.

## Mise en avant

Le projet à la une reste configuré par `homeEditorial.spotlightProjectSlug`. Le cockpit l’affiche en lecture seule. Sa modification sera activée après la migration vers une source runtime unique.
