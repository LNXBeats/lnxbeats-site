# UI Conformance V3 — dossier de revue humaine

## Périmètre

La V3 affine la passe V2 sans reconstruire le site. Elle concerne uniquement la présentation publique, le responsive, les états visuels et les animations déjà progressives. Les données, routes, parcours d’achat, validation Commander, paiements, facturation, stock, authentification et services restent hors du diff métier.

La règle explicite validée pendant la revue précédente reste prioritaire : le bloc Accueil « Une musique qui prend le réel au sérieux » et ses trois cartes ne doit pas être réintroduit, même s’il apparaît encore dans une image de référence de composition.

## Pack inspecté

Le fichier `00_START_HERE/PROMPT_CODEX_SOL_ULTRA_V3.txt` a été lu en premier et intégralement. Les 27 autres fichiers du pack ont ensuite été inventoriés et inspectés :

- `00_START_HERE/README.md` et `REFERENCE_INDEX_V3.jpg` ;
- les deux fichiers de `01_EXACT_ASSETS/` ;
- les onze références de `02_VALIDATED_LAYOUT_REFERENCES/` couvrant Accueil, Discographie, Album, Commander, Boutique, Produit, À propos et Contact ;
- les cinq captures de `03_REJECTED_OUTPUTS_AND_BLOCKERS/` ;
- les trois références d’identité de `04_IDENTITY_REFERENCES_ONLY/` ;
- `CRITICAL_VISUAL_BLOCKERS.md`, `MANIFEST.json`, `PAGE_RULES_V3.md` et `STATUS_BEFORE_V3.md` dans `05_DOCUMENTATION/`.

Les références d’identité servent uniquement au contrôle visuel. Elles ne sont ni copiées dans `public/`, ni utilisées par le rendu, ni transformées en nouveaux portraits.

## Assets exacts

| Asset public | Origine | SHA-256 | Usage |
| --- | --- | --- | --- |
| `public/assets/v3/hero-main-ludovic-dog-exact.jpg` | `HERO_MAIN_LUDOVIC_DOG_USE_AS_IS.png` | `2c4168c5c6964a08d229fe9e2d6575014804f84c13fe1e12b45654fad3efb2c7` | image héroïque, recadrée uniquement par CSS |
| `public/assets/v3/lnx-beats-signature-source-apple-artist.jpg` | `LNX_BEATS_SIGNATURE_SOURCE_APPLE_ARTIST.png` | `0f86e74b10bcfb2ddec01e9941d60a50a6b0970968ebf52a653b77efad7993d7` | source conservée byte-for-byte |
| `public/assets/v3/lnx-beats-signature-transparent.png` | dérivé déterministe de la source Apple Artist | `b8b1d6e76541c2f2452d47ad7b0a30fb686b17b3532c919ed889bd663ddfee79` | wordmark Accueil, header et footer |

Les deux fichiers fournis avec une extension `.png` contiennent en réalité des octets JPEG ; l’extension publique `.jpg` reflète donc leur format réel sans réencodage. Pour le wordmark transparent, le détourage retire le fond clair relié au bord ainsi que les deux composantes de fond longues et étroites enfermées entre N/X et A/T. Les aplats blancs des lettres restent opaques. Cette méthode évite le rectangle et les deux wedges blancs rejetés pendant la revue, sans redessiner le logo.

## Lecture des références

- Les maquettes déterminent la hiérarchie, les proportions, la densité et le langage visuel ; le dépôt reste la seule source des contenus et comportements réels.
- Les nombres de projets, produits et pistes visibles dans les maquettes ne sont pas recopiés lorsqu’ils divergent du catalogue.
- Les variantes Commander sont des références visuelles uniquement : le parcours réel conserve exactement ses six étapes, ses champs, ses validations, ses consentements et son payload.
- `08_CONTACT_REFERENCE_VALIDATED.jpg` est une planche de cohérence et non une maquette autonome de formulaire Contact. La page existante est harmonisée sans nouvelle architecture métier.
- Aucun élément de chrome Safari/iPhone des références n’appartient à l’interface du site.

## Corrections V3 attendues dans le candidat

| Surface | Invariant de la V3 |
| --- | --- |
| Accueil | Hero exact lisible, wordmark Apple Artist transparent, deux CTA sans collision, bénéfices dans le flux et « À la une » compacte ; ancien bloc de trois cartes absent. |
| Discographie | Cover active dominante et voisines lisibles, hauteur naturellement réservée, aucun contenu derrière le footer. |
| Album | Hiérarchie plus nette avec cover, lecteur et contenu réels ; aucune piste ou plateforme inventée. |
| Commander | Composition seule affinée ; workflow réel en six étapes inchangé et aucun recouvrement mobile. |
| Boutique | Tous les produits fournis par la source métier sont rendus dans leur ordre réel ; la fixture visuelle V3 locale n’en contenait qu’un. Stock qualitatif, Boutique LNX et DistroKid distincts, Etsy absent. |
| Produit | Média réel lorsqu’il existe, fallback neutre uniquement en QA, prix et panier inchangés, libellés Colissimo exacts. |
| À propos | Portrait issu du hero exact, lecture ouverte et respirante, encadrés décoratifs retirés, biographie et CTA Discographie conservés. |
| Contact | Mise en cohérence du hero, des intentions et du CTA existants, sans nouveau flux. |
| Header / footer | Signature transparente sans fond blanc, densité compacte et navigation clavier préservée. |

## Garde-fous et preuves obtenues

Le test source `tests/jukebox/ui-conformance-v3.test.ts` contrôle notamment les empreintes des assets exacts, l’alpha réel du dérivé, son usage partagé, l’absence du bloc Accueil supprimé, les textes produit obligatoires, la séparation DistroKid/Etsy, le fallback média local, les six étapes Commander et les garanties de mouvement réduit.

La QA visuelle finale couvre `375`, `390`, `430`, `768`, `1024`, `1280`, `1440` et `1920` pixels sur les huit routes demandées, soit 64 contrôles de route. Les 16 captures page à `1440`/`390`, ainsi que les preuves du header compact, du menu mobile et du footer mobile, sont conservées dans `/private/tmp/LNX_CODEX_UI_V3_QA/`. Le sous-dossier `qa-visual-comparison-v3/` contient pour chacune des huit pages la référence, le rendu desktop, le rendu mobile et des notes dédiées.

Le rapport géométrique final constate 80 rendus HTTP 200, zéro chevauchement, zéro élément tronqué sous le header et zéro débordement horizontal. Il couvre aussi une fenêtre `1440 × 650`, le paysage `844 × 390`, un zoom CSS de 125 %, `prefers-reduced-motion`, le header compact, le menu mobile, Échap, le retour du focus, un indicateur de focus visible et des cibles de menu de 48/56 px.

Le parcours Commander a été traversé réellement de l’étape 1 à l’étape 6 avec un membre fictif `.invalid` dans PostgreSQL local jetable. Une seule sauvegarde de brouillon local a eu lieu au passage Compte → Récapitulatif, puis le fixture a été intégralement nettoyé. La trace confirme : finalisation `0`, upload `0`, checkout `0`, appel provider `0`, confirmations laissées décochées et absence du panneau de paiement.

## Limite locale honnête

Lorsque la base QA pointe vers un média produit volontairement absent, le fallback reste neutre et conserve la géométrie de la carte. Il ne remplace pas la vraie photo par un contenu fictif et ne constitue pas une modification du catalogue. Aucun média, secret ou identifiant Production n’est copié pour produire les captures.

## Correctif de vérification V3.1

Le titre complet « Boutique LNX Beats » était déjà dégagé du header sur le contenu V3 final : le rognage signalé provenait des captures V2 antérieures. La V3.1 le verrouille aux largeurs `375`, `390`, `430`, `768`, `1024`, `1440` et `1920` pixels, sans marge négative ni translation. La récupération `listPublicShopProducts()` et le rendu `products.map(...)` sont inchangés par rapport au point de départ : aucun produit n’est filtré, limité ou codé en dur par la refonte.

Une fixture locale dédiée fournit deux produits synthétiques et deux WebP bénins de ratios différents. Elle prouve que le média réel remplace seul le fallback, remplit le même cadre carré avec `object-fit: cover` et `object-position: center`, sans étirement ni état simultané. Cette preuve ne lit ni ne copie aucun média Production.

Cette fixture multi-produits a révélé puis permis de corriger un débordement interne des actions, invisible avec l’unique produit QA initial : la composition horizontale des cartes est conservée, sur deux colonnes larges au desktop puis une colonne jusqu’à `1100px`. Les contrôles restent intégralement contenus dans chaque carte.

## Invariants de sécurité

- aucun changement Prisma, schéma ou migration ;
- aucune écriture Production ; le seul brouillon QA local nécessaire au parcours six étapes a été supprimé avec son compte fictif ;
- aucun secret Production chargé dans la QA ;
- aucun appel Stripe, PayPal, Resend, R2 ou Railway ;
- aucun push et aucun déploiement Production.
