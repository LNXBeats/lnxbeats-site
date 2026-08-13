# Migration runtime du catalogue — V0.6.0.3

## Source de vérité

PostgreSQL est la seule source runtime des pages `/`, `/discographie`, `/album/[slug]`, du sitemap et du cockpit catalogue. `data/discography.ts` est une fixture historique figée de V0.6.0.2 ; elle reste importée uniquement par les scripts de migration et les tests de parité. Il n’existe ni fallback ni double écriture.

## Correspondance des données

La migration déterministe conserve les 25 slugs, l’ordre, les textes, types, statuts, dates nullables, nombres de pistes déclarés, pistes nommées, liens directs, crédits, SEO, tonalités et niveaux de confiance. Les profils artiste demeurent globaux dans `data/site.ts` et ne sont pas dupliqués par projet.

`highlighted` conserve les sélections historiques de discographie. `featured` représente l’unique projet mis en avant sur l’accueil ; un index partiel garantit qu’une seule ligne peut être active. `trackCount` reste indépendant de la tracklist nommée afin de ne jamais inventer de titres.

| Contrôle | Résultat |
| --- | ---: |
| Projets legacy | 25 |
| Projets PostgreSQL | 25 |
| Slugs identiques | 25 |
| Projet homepage `featured` | 1 |
| Sélections historiques `highlighted` | 4 |
| Pistes nommées | 1 |
| Projets avec un nombre de pistes déclaré | 11 |
| Liens directs de parution | 1 |
| Anomalies de parité | 0 |

## Procédure

Les commandes refusent toute cible autre que les bases QA explicitement autorisées (`lnx-studio-v0603-test`, `lnx-studio-v0604-test`) ou `lnx-studio-local-preview`, tout hôte non loopback et le port PostgreSQL standard.

```bash
npm run catalog:migrate:dry-run
npm run catalog:migrate
npm run catalog:migrate
npm run catalog:compare
```

La première exécution crée les lignes absentes dans une transaction avec verrou consultatif. La seconde ignore uniquement les 25 lignes strictement identiques et marquées par la même version de source. Une ligne existante différente devient un conflit : le script refuse de l’écraser, ce qui protège les futures modifications administratives.

## Validation et retour arrière

La procédure a d’abord été exécutée sur une base Prisma Dev jetable depuis zéro. Elle a validé migrations, dry-run 25 créations, idempotence à 25 lignes ignorées identiques, parité 25/25, concurrence, pistes, liens et stockage cover. La base QA a ensuite été supprimée. Avant la base personnelle, une sauvegarde logique des tables catalogue et des empreintes SHA-256 de 11 tables Auth/commandes a été créée sous `/private/tmp`. La migration personnelle est additive, atteint également 25/25 et n’utilise aucun reset.

En cas d’échec avant la bascule, restaurer les tables catalogue depuis la sauvegarde logique et revenir au commit de départ. Ne jamais réactiver automatiquement la fixture TypeScript comme fallback : une panne de base doit rester visible et être traitée comme une panne runtime.

## Administration

`/admin/catalogue` liste et filtre les projets, y compris les brouillons privés et les archives. `/admin/catalogue/nouveau` crée un projet transactionnellement avec un slug normalisé unique ; les valeurs par défaut sûres sont `DRAFT`, `publicVisible = false`, aucun jukebox et aucune mise en avant. Tout autre état de création doit être choisi explicitement et rester cohérent. `/admin/catalogue/[slug]` édite ensuite les champs autorisés, la publication, l’unique mise en avant, le SEO, les pistes, les liens directs, la cover et la preview.

Les écritures exigent une session `ADMIN`, une origine valide et une sélection explicite des champs. Masquer conserve les données. Archiver force le retrait public et du jukebox tout en restant réversible. La suppression définitive exige un projet masqué en brouillon ou archivé, refuse le projet mis en avant et demande la saisie exacte de son slug. Les relations `Restrict` sont nettoyées dans une transaction ; seuls les assets sans aucune autre relation projet ou commande sont supprimés, puis leur objet est retiré via l’abstraction média V0.6.3.

La fiabilité affichée n’est plus une série de dix sélecteurs techniques. Elle est calculée à la lecture : présence d’une cover officielle, date, rapport entre nombre déclaré et pistes nommées, liens de sortie, SEO et crédits. Les annotations legacy restent en base pour la compatibilité et servent uniquement de contexte aux domaines qui ne peuvent pas être déduits objectivement, comme l’éditorial ou les genres. Le niveau global devient « Informations principales complètes » uniquement lorsque les domaines principaux sont tous confirmés.

Les libellés de plateforme sont centralisés par plateforme et portée. Un label vide utilise automatiquement, par exemple, « Écouter sur Spotify », « Voir sur YouTube » ou « LNX Beats sur Spotify ». Le champ `label` existant demeure un override facultatif ; les anciens textes automatiques connus sont normalisés vers `null` lors d’une future écriture sans écraser les libellés réellement personnalisés.

`Track.durationSeconds` reste exclusivement la durée réelle du morceau. La durée de la preview générée, plafonnée à 60 secondes, vit dans `Asset.durationMs` et ne doit jamais être injectée dans la piste ; une durée de piste inconnue reste `null`.

L’alt public d’une cover est calculé par défaut sous la forme `Pochette de « {titre} » — LNX Beats`. Seule une personnalisation réelle est stockée dans `Asset.alt`, afin qu’un changement de titre mette automatiquement le fallback à jour. Les champs SEO vides utilisent les fallbacks éditoriaux effectifs ; l’administration distingue donc SEO automatique, mixte et personnalisé sans signaler un faux manque.
