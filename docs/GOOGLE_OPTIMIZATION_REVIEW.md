# Revue Google Search, Merchant et préparation AdSense — 5 octobre 2026

> Rapport historique de la première phase. Voir `GOOGLE_FINAL_REVIEW.md` pour la reprise : les demandes humaines de couleur, compte et validation visuelle sont désormais levées.

Base vérifiée : `6876ba222d28e0b122fc6eb6fe95c9a0605725f8`, tree `4185ec0aa654b0080e45794cdac31903c145b009`. Web et worker Railway SUCCESS sur cette release. Ce lot est exclusivement feature/Preview ; aucune promotion Production autorisée avant revue.

## Inventaire avant code

| Sujet | Classement | Preuve actuelle |
|---|---|---|
| Flux Merchant existant | DONE | Source unique PRODUCTS SOURCE 1, XML www, récupération quotidienne à 00:00, France/français/fiches gratuites. Lecture du 05/10 : 2 produits, tous les attributs reconnus, aucun problème de fichier. |
| Produits Google | DONE | CD 7 EUR et badge 3 EUR, approuvés/en stock. DistroKid et soutien absents. |
| Couleur badge | NEEDS_FIX | Avertissement Google « Couleur manquante », 1 produit. Valeur humaine demandée, aucune couleur inventée. |
| Nouveaux produits internes | NEEDS_FIX | Registre MPN codé en dur : un nouveau produit ne peut pas rejoindre le flux sans modification de code. |
| Search Console | DONE | Propriété domaine lnxbeats.fr accessible dans Safari. Aucune action manuelle, aucun problème de sécurité. |
| Sitemap Search Console | DONE | Lecture réussie 03/10/2026, 29 pages découvertes lors de cette lecture. |
| Indexation | OPPORTUNITY | Rapport Google du 21/09 : 10 indexées, 19 découvertes non indexées, 2 redirections, 2 noindex juridiques (CGV/confidentialité). Ce rapport est décalé et ne prouve pas l'état d'indexation instantané. |
| Pages du sitemap actuel | DONE | 31 pages publiques HTTP 200, canonical www et JSON-LD syntaxiquement lisibles. 404 et noindex panier/connexion corrects. |
| Metadata musique | NEEDS_FIX | Single/album homonymes ont le même titre SEO ; description automatique de Vie de chien très longue. |
| Sitemap produits | NEEDS_FIX | La projection publique perd updatedAt déjà présent en base. |
| Canonical domaine nu | BLOCKED | Client réseau local refuse/reset TLS vers lnxbeats.fr ; alias Railway renvoie bien 308 vers www. À distinguer d'un bug applicatif. |
| CWV terrain | BLOCKED | Search Console : aucune donnée mobile/desktop. Mesures labo nécessaires, pas de faux INP terrain. |
| AdSense professionnel | BLOCKED | Le profil professionnel Google n'est pas associé à AdSense. Un profil personnel connecté atteint un écran d'acceptation de nouvelles conditions. Aucun contrat accepté par l'agent. |
| Ads / Analytics / CMP | OPPORTUNITY | Aucun script Ads/Analytics dans les pages publiques contrôlées, CSP fermée aux tiers. Préparation QA sans annonces réelles ; CMP Google certifiée et compte restent des gates d'activation. |

## Sources officielles consultées le 05/10/2026

- https://support.google.com/merchants/answer/6324478?hl=fr — absence d'identifiant uniquement si réellement confirmée.
- https://support.google.com/merchants/answer/6324487?hl=fr — couleur réelle.
- https://support.google.com/merchants/answer/6324350?hl=fr — images.
- https://support.google.com/adsense/answer/13554116?hl=fr — CMP certifiée et TCF.
- https://support.google.com/adsense/answer/10961068?hl=fr — message de consentement européen.

Les MPN historiques sont documentés comme attribués officiellement dans MERCHANT_CENTER_FEED_V1.md et doivent rester stables. Aucun identifiant fabricant ne sera généré automatiquement.

## Contrôles complémentaires

- Merchant : www.lnxbeats.fr **Validé / Revendiqué**. Livraison France par poids, délai affiché 4–5 jours, configuration terminée. Retour standard France **Validé**, 14 jours, envoi à charge du client, 2 produits.
- `npm ci` standard, Prisma format/validate/generate, lint, typecheck, build Web et build worker dédié : PASS.
- 432 tests ciblés Merchant / SEO / Catalog / Boutique / Security / Auth / Soutien : PASS, 0 échec, 0 skip (ne pas additionner les sous-exécutions préparatoires).
- Audit npm Production : 0 vulnérabilité. Audit complet : 5 HIGH dans la chaîne eslint-config-next → plugin Next → fast-glob → micromatch → braces, GHSA-vfj7-8cjw-p6xm. Risque réel : déni de service du lint/build si motifs glob non fiables ; pas un chemin HTTP du site. Motifs du dépôt contrôlés, pas d'entrée client. La proposition npm rétrograde eslint-config-next vers 14.2.35 : non appliquée aveuglément. Dépendances et lockfile inchangés.
- `npm ls --all` : PASS. Scan ciblé credentials des fichiers modifiés : aucune correspondance (ce n'est pas une certification de sécurité exhaustive).
- PostgreSQL **18.6 local uniquement** : copie isolée des fixtures QA existantes ; migration 43 → 44 ; comparaison des canaris de **82 tables** avant/après, données historiques identiques. Nouvelles colonnes null/false. Test réel SELECT/UPDATE des métadonnées par rôle non propriétaire, DELETE refusé 42501 ; transaction QA annulée intégralement. Aucune donnée Production importée.
- Preview existante : base distincte de Production, Stripe TEST, PayPal SANDBOX, notifications désactivées, aucun credential financier Production réutilisé. Aucun déploiement concurrent/pending au contrôle. Elle est en retard d'une migration externe déjà déployée en Production : `20261004230000_external_shop_products`, plus la nouvelle migration Merchant. Aucune migration inattendue.
- Limite Preview : `SHOP_ENABLED=false` préexistant ; ce lot ne contourne pas le garde-fou commerce pour le passer à true en Railway. La recette Boutique/flux complet est effectuée sur fixtures locales isolées ; la Preview garde son teaser commercial fermé.

## Limites de l'activation Ads

Voir `ADS_PREPARATION.md`. Pas de compte AdSense professionnel configuré, pas de Publisher ID confirmé, pas de CMP certifiée déployée. Aucun script ou impression réelle. Les placeholders sont une préparation de design et non une intégration AdSense achevée. Confidentialité inchangée puisque aucun nouveau traitement publicitaire ne s'exécute.

Les captures réelles et le relevé de laboratoire sont remis dans `output/google-review` (hors Git et hors upload Railway). Mesures locales sur build optimisé, contexte métier QA loopback (`NODE_ENV=development` nécessaire au garde-fou Boutique local existant) : elles ne se substituent ni à un benchmark Railway Production ni aux CWV terrain absents. LCP/CLS sont mesurés sur 8 secondes, INP NOT_MEASURED. Une publicité tierce réelle et son CMP devront être mesurés après les gates humains, sans impressions artificielles.

Production et main demeurent inchangés. Couleur réelle du badge et choix du compte AdSense attendent une réponse humaine précise ; aucune valeur produit ni condition contractuelle n'est inventée ou acceptée.
