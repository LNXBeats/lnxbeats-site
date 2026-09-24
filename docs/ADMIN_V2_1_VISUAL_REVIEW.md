# Admin V2.1 — correctif de composition, candidat local

La seconde image fournie par Ludovic est la référence principale de densité et de hiérarchie. Les chiffres, personnes et produits fictifs de cette image ne sont pas repris. Le cockpit V2.1 utilise exclusivement les projections Admin déjà autorisées, complétées par des lectures bornées pour les indicateurs et la recherche.

## Composition

- Six espaces conservés, avec pictogrammes SVG, sous-titres et état actif. Les sous-pages restent dans les groupes repliables ; « Rubriques » n'est plus répété.
- Topbar avec recherche globale réelle, indicateur des notifications en attente et identité de session. La recherche est réservée à `requireAdmin`, normalisée, limitée à 120 caractères et à six résultats par domaine. Elle est en lecture seule sur les commandes musicales et Boutique, créations, projets, membres, factures et avoirs.
- Huit KPI compacts avec les zéros visuellement atténués. « À traiter maintenant » suit immédiatement les KPI et affiche des dossiers réels du cockpit V2, avec statut, date et lien vers l'action existante.
- La sélection du cockpit n'effectue aucune mutation métier en lot. « Actions groupées » n'est actif que pour des dossiers du même domaine et du même libellé d'état ; il ouvre une liste de navigation vers les dossiers sélectionnés. Chaque décision reste prise par son workflow Admin préexistant. Ce choix évite d'inventer une bulk action qui contournerait les gardes métier.
- Les vues Créations, Boutique et Membres utilisent des cartes plus synthétiques. Les couvertures et images passent par les routes Admin déjà protégées ; les prix, stocks et comptes proviennent des données serveur. L'indicateur de complétude Créations est explicitement éditorial et n'est pas un nouveau garde de publication.

## QA locale

Le contrôle visuel a utilisé Chromium headless isolé, un serveur Next local et une base PostgreSQL QA locale synthétique, jamais la Production. Les captures sont conservées hors Git sous `/private/tmp/lnxbeats-admin-v21-qa-captures/`.

Sur 98 combinaisons de routes et largeurs (375, 390, 430, 768, 1024, 1440, 1920 px), les 14 routes accessibles ont répondu en HTTP 200, sans débordement horizontal ni cible interactive visible de moins de 44 px. La route SAV Boutique a répondu 404 dans ce runtime QA non activé : elle n'est pas revendiquée comme validée visuellement. Le drawer s'ouvre, permet de naviguer, se ferme avec Échap et restitue le focus. Recherche globale et sélection du cockpit ont été exercées avec les données synthétiques. À 1920 × 1080, la topbar finit à 76 px, les KPI à 436 px et le centre d'action commence à 452 px. Le mode de mouvement réduit était actif. Un zoom CSS simulé à 125 % et le paysage 844 × 390 n'ont pas provoqué d'overflow ; cela ne vaut pas test de zoom navigateur natif.

Les captures comprennent Accueil (390, 768, 1440, 1920), Créations, Boutique, Membres, Réglages et Avancé (390 et 1440), Nettoyage (390 et 1440), et menu mobile (390). Elles ne sont pas committées.

## Hors périmètre

Aucun changement à Prisma, aux migrations, paiements, commandes, droits, worker ou stockage média n'est nécessaire. Aucun push et aucune mutation Production ne sont autorisés dans ce lot. Le prochain contrôle est la revue visuelle humaine du candidat local, puis une autorisation de release distincte.
