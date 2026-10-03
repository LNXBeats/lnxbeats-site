# Addendum release — lot photos / format conservé

Date : 3 octobre 2026. Aucune refonte de l'upload, de Commander ou de l'Admin.

## Références et intégration

- Lot validé inchangé : `991240ebd99191489f25437c3ded28627d8a9ddd`.
- Tree inchangé : `0bf4b7e9b24030c5a33194ca21a24bacd48f688e`.
- `origin/main` relu par fetch : `2a9dca7330c6f936a049edb817e4d22f3ff280d7`.
- `feature/premium-site-overhaul` pointe encore sur cette même base.
- Correctifs de dépendances isolés sur `feature/photos-format-release-audit`,
  directement après le commit photos, sans amend/cherry-pick ni duplication.
- Intégration dans la branche de refonte **PENDING**, pas exécutée avant les
  gates demandés. Le chemin actuel est compatible fast-forward ; le revérifier
  après toute évolution de la branche cible.

## Recette physique

**IPHONE_PHYSICAL_RECIPE = PENDING**. L'inventaire CoreDevice réussit mais ne
trouve aucun iPhone connecté utilisable. Aucun onglet Safari personnel consulté.
Les preuves Chromium précédentes ne sont ni rejouées inutilement ni requalifiées
en essai Safari/iPhone. Aucune photo cliente ne doit servir à cette recette.

Kit synthétique conservé dans `/private/tmp/lnx-photos-addendum.wgRDEF/iphone-qa` :
quatre JPEG décodables de 4 194 304 octets chacun, soit 16 777 216 octets au total.
Le kit contient un protocole ; il ne contient ni compte ni mot de passe.

À réaliser sur un environnement QA isolé exécutant le candidat exact :
envoi des quatre JPEG, retour arrière, reload et inventaire, échec/réessai d'un
seul fichier, parcours zéro photo et retrait de l'option Illustration sur un
brouillon. Relever modèle, version iOS/Safari, SHA, résultat et preuves sans
credentials. Le navigateur doit réellement s'exécuter sur l'iPhone physique.

## Audit npm — classification et corrections

Avant : **9 paquets signalés (8 high, 1 critical)** ; `--omit=dev` : **3**.
Ces comptes incluent des propagations dans les parents, pas neuf CVE distinctes.

| Dépendance | Portée npm / exposition revue | Correctif retenu | Rupture |
| --- | --- | --- | --- |
| Next 16.3.4 | Production ; ImageResponse présent uniquement dans l'icône constante, sans entrée attaquante sur le chemin inspecté | 16.3.8, release sécurité officielle | Patch, même 16.3 |
| fast-uri 3.1.6 | Inclus dans l'audit production via la chaîne Prisma CLI/devOptional ; pas d'import HTTP applicatif trouvé | Override 3.1.8, couvre les trois avis | Patch, compatible AJV |
| AJV 8.20.0 | Alerte héritée de fast-uri ; pas une autre vulnérabilité AJV | Version inchangée ; alerte éliminée par fast-uri | Aucun upgrade |
| brace-expansion 1.1.18 et 5.0.9 | Dev, ESLint/TypeScript ; motifs locaux de confiance, pas d'entrée HTTP trouvée | 1.1.21 et 5.0.12 dans le lock | Patch dans chaque majeure existante |
| braces 3.0.3 | Dev ; épuisement de pile avec motifs profondément imbriqués non fiables | Aucun patch publié lors de l'audit | Non corrigé, risque documenté |
| micromatch 4.0.8 | Dev, parent de braces | Inchangé ; alerte héritée persistante | Aucun upgrade |
| fast-glob 3.3.1 | Dev, parent de micromatch | Inchangé ; alerte héritée persistante | Aucun upgrade |
| @next/eslint-plugin-next | Dev, parent de fast-glob | Aligné 16.3.8 ; alerte héritée persistante | Patch |
| eslint-config-next | Dev, parent du plugin | Aligné 16.3.8 ; alerte héritée persistante | Patch |

Après installation propre : **audit production PASS, zéro vulnérabilité**.
Audit complet : **FAIL, cinq high dev**, une seule cause `braces@3.0.3` propagée
aux quatre parents. Aucun critical restant. `npm ls --all` : PASS.

Le plugin appelle fast-glob à partir de `settings.next.rootDir`, absent ici ;
les motifs ESLint du dépôt sont constants. Pas de voie d'exploitation web
trouvée pour cette chaîne. Le risque outils/CI demeure si des motifs/configurations
non fiables lui sont fournis. Ne pas prendre ce constat pour un audit npm PASS.
Ne pas alimenter ESLint avec des motifs fournis par des utilisateurs non fiables.
À réévaluer dès qu'un patch compatible est publié.

`npm audit fix --force` n'est pas utilisé : sa proposition de rétrograder
`eslint-config-next` vers 14.2.35 est une rupture majeure, non justifiée.
AJV, Prisma, React, paiements, Auth et le code photos/format restent inchangés.

Sources primaires et avis :

- [Release Next 16.3.8](https://github.com/vercel/next.js/releases/tag/v16.3.8)
- [Avis Next ImageResponse](https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j)
- [fast-uri : port](https://github.com/fastify/fast-uri/security/advisories/GHSA-qw65-cvwx-89v3), [hôte](https://github.com/fastify/fast-uri/security/advisories/GHSA-58mr-gqgx-xq4g), [normalisation](https://github.com/fastify/fast-uri/security/advisories/GHSA-hrr3-gc8f-f4qj)
- [brace-expansion : parsing](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-6j4f-fj2g-mc7p), [expansion](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-qhr7-859c-m2p7), [coût quadratique](https://github.com/juliangruber/brace-expansion/security/advisories/GHSA-q2hr-2g5m-vwhr)
- [braces : rapport mainteneur](https://github.com/micromatch/braces/issues/70), [avis](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm)

## Commande réelle LNX-2026-000017

**READ_ONLY_COUNT = BLOCKED / NOT_RUN** : aucune valeur supposée n'est donnée.
L'état accepté/payé et la photo visible précédemment rapportés ne prouvent pas
le nombre actuel de références.

L'environnement Production et le service PostgreSQL ont été identifiés en
lecture seule. La connexion existante est sur réseau privé, sans URL publique
disponible. L'essai via SSH existant échoue faute de clé utilisable ; aucune clé,
proxy ou configuration n'a été créé. Le recours à l'agent Railway générique a
été refusé par le garde-fou d'exécution, son pouvoir d'action n'étant pas limité
techniquement à la lecture seule. Aucun contournement n'est tenté.

Reprise possible uniquement via un accès existant sûr, borné en lecture seule :
connexion avec `default_transaction_read_only=on`, `BEGIN TRANSACTION READ ONLY`,
vérification `SHOW transaction_read_only`, requête paramétrée ci-dessous, puis
`ROLLBACK`. Ne pas lancer l'inventaire général, qui lit davantage de données.

```sql
SELECT COUNT(a.id)::integer AS private_reference_photo_count
FROM public.orders AS o
LEFT JOIN public.order_assets AS oa
  ON oa."orderId" = o.id AND oa.role = 'REFERENCE'
LEFT JOIN public.assets AS a
  ON a.id = oa."assetId" AND a.type = 'IMAGE' AND a.visibility = 'PRIVATE'
WHERE o."orderNumber" = $1
GROUP BY o.id;
```

Paramètre unique : `LNX-2026-000017`. Aucun contenu de photo, identifiant de
paiement, titre, email ou clé de stockage n'est sélectionné. Zéro ligne signifie
commande absente ; une ligne contenant zéro signifie commande sans référence
IMAGE PRIVATE. Aucun test d'écriture autorisé.

Les quatre changements Railway staged déjà présents (diagnostic mémoire) n'ont
été ni validés, ni modifiés, ni supprimés. Aucun média client téléchargé et aucune
donnée, option, statut ou paiement modifié.

## Validation du correctif de dépendances

- `npm ci` standard, lint, typecheck, build Next 16.3.8 : PASS.
- Prisma validate/generate : PASS ; aucune migration ni modification du schéma.
- Suite canonique : **1 287 PASS, 0 FAIL, 1 SKIP préexistant** (1 288 tests).
  Écart de +2 : tests des versions Next/config et des branches brace-expansion.
- Le test existant fast-uri est mis à jour vers le patch réellement nécessaire.
- HTTP compilé photos après changement de Next : **12/12 groupes PASS**,
  Next **16.3.8**, build `voj5epdHONIFOc8PNi9qi`. Preuve :
  `/private/tmp/lnx-photos-format-qa.WhG3yw/run-a7b6fe2b/http-report.json`.
  12 commandes et 25 références exclusivement synthétiques ; Payment,
  PaymentProviderEvent et Invoice restent à zéro avant/après. Les bornes exactes,
  les retries, le quota, les formats et les contrôles privés sont conservés.
- Diff-check et scan ciblé de secrets sur les cinq fichiers du lot : PASS.
- Next et PostgreSQL locaux sont arrêtés après recette ; aucune infrastructure
  QA distante créée ni Production modifiée. Les captures précédentes sont
  conservées sans les présenter comme des captures prises après l'upgrade.
- Preuves locales : `/private/tmp/lnx-photos-addendum.wgRDEF/` et rapport
  indépendant `/private/tmp/lnx-dependency-audit-991240e-readonly.md`.

## Décision

Les patchs sûrs sont préparés localement, séparément de la référence photos.
L'intégration au candidat global attend la recette iPhone physique et le
comptage Production en lecture seule. Aucun push, déploiement, migration,
reconfiguration Production, transaction financière ou nouvelle fonctionnalité.
