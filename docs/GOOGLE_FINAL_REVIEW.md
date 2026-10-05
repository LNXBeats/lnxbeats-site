# Reprise Google finale — 5 octobre 2026

Périmètre feature/Preview uniquement, base main `6876ba222d28e0b122fc6eb6fe95c9a0605725f8`, candidat repris `b891b8a6383c7d3c0aa8474d25385b136587a642`. Aucun backup, push main, déploiement ou mutation Production. Le présent rapport remplace les statuts humains en attente de la première phase.

## Informations humaines appliquées

- Emplacements 390/1440 approuvés : aucun redesign.
- Badge exact `badge-lnx-beats` : **Multicolore**, valeur confirmée par Ludovic. Valeur DB explicite prioritaire, fallback limité au seul badge historique (comme le registre MPN existant), projection publique / JSON-LD / feed / champ Admin cohérents. Aucun UPDATE Production, prix/stock/image inchangés ; aucune couleur inventée pour les futurs produits.
- Compte AdSense créé humainement : `pub-2056594730161751`, client `ca-pub-2056594730161751`, site lnxbeats.fr EXAMEN REQUIS. Aucune validation de propriété, demande d'examen ou AutoAds effectuée par l'agent.
- `/ads.txt` HTTP 200 text/plain, une seule ligne officielle `google.com, pub-2056594730161751, DIRECT, f08c47fec0942fa0`. Balise Meta `google-adsense-account` inerte. Un autre vendeur/configuration malformée est refusé. Aucun script réseau n'est nécessaire pour cette méthode de validation.

## CMP : Google, brouillon enregistré, intégration réelle PENDING

Le skill d'annuaire a servi à chercher le parcours officiel (aucun résultat), puis documentation primaire Google consultée. Aucun changement Stripe. La CMP Google « Confidentialité et messages » est certifiée/TCF et évite une dépendance ou un faux bandeau maison.

Brouillon **LNX Beats — consentement européen — revue 2026-10-05**, autorisé puis enregistré dans AdSense. Site unique lnxbeats.fr, nom LNX Beats, français, confidentialité https://www.lnxbeats.fr/confidentialite. Accepter / Refuser / Gérer les choix ; refus visible dans les régions couvertes ; optimisation automatique du message OFF ; logo optionnel OFF plutôt qu'inventé. Liste vérifiée : **Brouillon**, publication **OFF**, 0 message affiché. Capture réelle hors Git.

Paramètres généraux préexistants lus, **non modifiés** : 198 partenaires courants, couverture automatique active, intérêt légitime activé par défaut, Consent Mode autres produits OFF, fonctionnalité spéciale 2 OFF, aucune finalité propre ajoutée. Le « 0 partenaire » de la prévisualisation éditeur ne prouve pas une absence de partage. Liste et bases légales finales à relire avant publication.

### Ce qui est effectivement testé

Adaptateur TCF `lib/ads/consent.ts`, **pas une CMP** : absent/erreur/UI ouverte → unknown ; refus → denied ; accord Google (755), finalités 1/3/4 → granted. Google doit encore vérifier la chaîne complète. Doubles locaux : absent, refus, acceptation, retrait, réacceptation, callback tardif, routes interdites. Aucun cookie maison ni chaîne TCF produite.

Composant préparé : callbacks `CONSENT_API_READY`, `__tcfapi(addEventListener)`, retrait `showRevocationMessage`, pause avant script, un slot manuel et masquage unfilled. **Il n'est jamais monté** : `GOOGLE_CMP_RUNTIME_VERIFIED=false` est un verrou de code non contournable par les variables. Aucun environnement Preview ne charge de réseau Ads.

### Réserve précise, pas un PASS fictif

Google documente uniquement une CSP stricte par nonce pour AdSense, pas une liste fixe de domaines. La CSP actuelle bloque le tag et reste **inchangée**. Une intégration nonce limitée aux documents publicitaires, ses transitions SPA et le cycle réel accepter/refuser/retrait restent à valider avec le message publié. Aucun élargissement global de domaines, `unsafe-eval` ou suppression CSP pour contourner le gate. Les doubles locaux et un brouillon non publié **ne prouvent pas** le fonctionnement réel de la CMP sur le site.

Le tag AdSense sert aussi la CMP Google. `pauseAdRequests=1` suspend les requêtes d'annonces, pas tous les échanges Google ; des scripts auxiliaires peuvent lire des cookies existants. Rien de cela n'est déclenché ici. Consent Mode destiné à Analytics/Google Ads n'est pas ajouté car ces produits ne sont pas chargés ; TCF est la voie AdSense. Pas de publicité limitée après refus.

Notice de confidentialité conditionnelle mise à jour : état OFF, Google/CMP, identifiants, finalités, partenaires, accepter/refuser/retrait, routes exclues et liens Google. Pas d'affirmation de diffusion ou de retrait déjà opérationnels.

## Search Console : classification ciblée des 19 URL

Rapport Google du 21/09 : « Découverte, actuellement non indexée », dernière exploration « Sans objet ». Lecture actuelle : 19 HTTP 200, canonical www auto-référent, pas de noindex, sitemap et maillage présents. Ce rapport différé ne prouve pas une erreur ni l'état instantané d'indexation.

| URL | Catégorie | Motif / action |
|---|---|---|
| /album/bienvenue-dans-le-bordel-familial | A | Album publié ; conserver indexable, compléter uniquement les faits artistiques disponibles. |
| /album/ca-va-lfaire | A | Single publié, extrait/liens ; aucun blocage technique. |
| /album/chaos-canin | A | Album publié ; même conclusion. |
| /album/jai-adopte | A | Album distinct publié ; même conclusion. |
| /album/jai-adopte-un-bebe | A | Single publié ; même conclusion. |
| /album/jai-adopte-un-homme | A | Single publié ; même conclusion. |
| /album/jai-adopte-un-humain-album | A | Album distinct du single ; titres SEO déjà différenciés dans b891b8a. |
| /album/jai-adopte-une-femme | A | Single publié ; aucun blocage technique. |
| /album/le-collegue-ambiance-toxique | A | Album publié ; même conclusion. |
| /album/le-dernier-age-dor | B | Projet en développement, récit et tracklist partiels ; peut rester non indexé, ne pas inventer du contenu. |
| /album/les-comptines-version-adulte | A | Album publié ; aucun blocage technique. |
| /album/les-comptines-version-adulte-v2 | A | Version distincte publiée ; même conclusion. |
| /album/les-employes-du-bureau | A | Album publié ; même conclusion. |
| /album/les-merdes-du-quotidien | A | Album publié ; même conclusion. |
| /album/madame-piecettes | A | Single publié avec date/liens ; aucun blocage technique. |
| /album/miss-click | B | Projet en développement, éléments encore partiels ; pas d'action forcée. |
| /commander | A | Présentation publique utile ; étapes/données privées restent protégées et sans Ads. |
| /creations | A | Catalogue public et maillage utile ; aucun blocage technique. |
| /creations/second-chance-marion-francois | A | Collaboration publique distincte ; aucun blocage technique. |

17 A, 2 B, 0 C. Plusieurs descriptions Production sont génériques et les fiches déclarent des informations partielles ; cela peut limiter leur valeur éditoriale, **sans preuve que ce soit la cause Google**. Pas de texte artificiel, changement noindex, nouvelle URL ou demande massive. Les corrections metadata/sitemap déjà présentes sont conservées. Nouvelle correction technique Search démontrée : **NONE_REQUIRED**.

## Preuves réutilisées / rejouées

REUSED_EVIDENCE : 432 tests première phase, installation standard, Prisma et build worker dédié (aucun changement de schéma/dépendance/worker depuis b891), audit Production 0 et 5 HIGH dev documentées, 82 canaris QA / migration 43→44 / ACL runtime non propriétaire. Même migration `20261005010000_product_merchant_metadata`, déjà appliquée Preview ; aucune nouvelle migration. Ces nombres ne s'additionnent pas avec les tests rejoués.

REEXECUTED_TESTS : 140 tests SEO/Merchant/Legal/Security, 140 PASS, 0 FAIL/SKIP ; lint ; typecheck ; build Web ; diff-check ; scan ciblé credentials. Premier typecheck a identifié un type de ref `<ins>` corrigé (HTMLModElement), puis validation réussie. HTTP réel : 16 routes sur deux serveurs QA OFF/placeholders, compte des slots, aucune balise Google distante, ads.txt réel 200 et Meta ; flux 2 produits internes, soutien/DistroKid exclus, sitemap et lastmod cohérents.

Les fonctions prix/stock/panier, paiements, soutien, privés, jukebox, mémoire, worker et Rights V4 n'ont aucun changement. Aucun credential financier ni configuration Production lu/modifié pour ce lot final.

## Performance et revue

Les captures approuvées restent valides (compositions inchangées). Captures complémentaires réelles album/Boutique 390/1440 et preuve CMP dans l'index hors Git. QA locale isolée sur build optimisé, contexte métier local requis par les fixtures (NODE_ENV=development), pas un benchmark Production. Fenêtre métriques 8 s, aucune collecte/stockage externe. INP NOT_MEASURED. OFF et placeholder ne prouvent pas le coût futur d'une CMP/annonce réelle.

Relevé final accueil : 1440 px LCP OFF/QA 84/88 ms ; 390 px 80/76 ms ; CLS 0 dans les quatre cas. Variabilité locale, pas de conclusion d'amélioration ni CWV terrain. Aucun overflow ni image cassée sur les captures Boutique. Aucune balise Google distante dans les documents testés.

## Suite humaine, sans nouvelle demande déjà satisfaite

Après revue finale et autorisation de promotion distincte seulement : déployer et vérifier ads.txt/Meta en Production. Dans AdSense → Sites → lnxbeats.fr, choisir Meta ou ads.txt, valider la propriété **soi-même**, puis demander l'examen. Ne pas le faire tant que seuls les éléments Preview sont présents.

L'activation publicitaire n'est pas incluse : relire/publier le brouillon dans un lot contrôlé, terminer CSP nonce/cycle CMP réel, configurer les unités réelles et garder AutoAds OFF (max un emplacement), puis lever le verrou uniquement après preuve. Aucun ID d'unité inventé. Les flags de coupure restent indépendants des paiements. Les variables sont lues au démarrage, pas de promesse d'arrêt instantané sans redémarrage.

Sources primaires consultées le 05/10/2026 :
- https://support.google.com/adsense/answer/13554116?hl=fr — CMP certifiée.
- https://support.google.com/adsense/answer/10960768?hl=en — message et brouillon.
- https://support.google.com/adsense/answer/16878447?hl=en — optimisation automatique.
- https://developers.google.com/funding-choices/fc-api-docs — API TCF et retrait.
- https://support.google.com/adsense/answer/7670312?hl=en — pause et limites.
- https://support.google.com/adsense/answer/16283098?hl=en-GB — CSP supportée par nonce.
