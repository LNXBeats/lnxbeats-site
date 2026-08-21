# Changelog

## V0.7.3 — Notifications transactionnelles

- consolide l’outbox PostgreSQL existante avec leases, retries bornés, statuts fournisseur, événements et suppressions persistantes ;
- isole Resend derrière un transport serveur, conserve `capture`/`disabled` et refuse toute fixture `.invalid` en envoi réel ;
- ajoute les e-mails propriétaire, client, livraison et droits/contrats sans rendre l’e-mail source de vérité métier ;
- ajoute le webhook Resend signé, l’Admin Notifications, le dispatcher CLI/route interne et les diagnostics sans secret ;
- prépare uniquement l’abstraction SMS `disabled`/`capture`, sans fournisseur ni envoi réel ;
- maintient fermés les gates production Prisma/deepmerge-ts, revue juridique et QA e-mail transactionnel staging.

## V0.7.2 — Droits, contrats et autorisations

- sépare usage personnel, licence de publication 150 € et partenariat d’exploitation 1 500 € sans paiement de droits ;
- ajoute demandes, coordonnées versionnées, contributions, paramètres structurés, propositions Admin, templates, documents, acceptations et audit ;
- génère des PDF A4 privés, hashés et filigranés sur R2 PRIVATE ;
- ajoute Legal Review Gate, double validation du partenariat et blocage PostgreSQL de toute activation ;
- remplace le workflow `CommercialLicense` runtime par `RightsRequest` tout en conservant l’archive additive ;
- maintient la production bloquée tant que l’advisory Prisma/deepmerge-ts n’a pas de correction stable compatible.

Toutes les évolutions notables de LNX Studio sont consignées dans ce fichier.

## [0.7.1] — 2026-08-14

### Checkout Commander

- parcours Commander relié de bout en bout : projet, histoire, options, références privées, compte, récapitulatif et paiement Stripe hébergé ;
- reprise en mémoire du brief et des fichiers sélectionnés pendant la connexion ou l’inscription, sans contenu sensible dans l’URL ni stockage persistant du navigateur ;
- Commander conserve les photos privées mais ne propose aucun upload MP3/WAV client ;
- livraison finale distincte Admin → Client avec un master MP3/WAV de 200 Mo maximum, validé, stocké dans R2 PRIVATE et servi par une route autorisée avec Range ;
- un seul master actif par commande, remplacement audité avant publication et publication `DELIVERED` refusée sans livraison valide ;
- création de l’`Order` avant Checkout, prix serveur 50/60/80/90 €, double clic borné et retour dédié `/commande/[orderNumber]/confirmation` ;
- confirmation fondée exclusivement sur PostgreSQL après webhook signé, avec polling court, annulation douce, refus, reprise et expiration ;
- modification avant paiement autorisée seulement après expiration de la Checkout Session active ; les commandes payées restent figées.

### Compte, Admin et sécurité

- espace Compte séparant les brouillons, paiements à finaliser, commandes actives et terminées, avec statut paiement, options et action attendue ;
- vue Admin principale centrée sur les commandes payées/à examiner, paiements en attente séparés et événements de réconciliation visibles sans payload sensible ;
- Checkout accessible au propriétaire actif et vérifié dans la seule QA Stripe Test gardée, avec same-origin, IDOR serveur, rate limit et pricing PostgreSQL ;
- annulation métier fermant la Session active quand possible, sinon passage en revue explicite ; aucun remboursement, Stripe Tax, Live, PayPal ou Wero activé ;
- outbox persistante et idempotente pour l’email propriétaire après paiement et l’email client après livraison ; abstraction SMS prête sans fournisseur configuré.

## [0.7.0] — 2026-08-14

### Fondation paiement

- choix documenté de Stripe Checkout Sessions hébergé, moyens de paiement dynamiques et webhook signé comme source de vérité ;
- SDK `stripe` verrouillé en 22.5.0 et API verrouillée sur `2026-07-29.dahlia` ;
- configuration suivie limitée à des placeholders vides, `PAYMENTS_ENABLED=false` et `STRIPE_MODE=test` ;
- prix serveur, tentative `Payment`, événements, idempotence, concurrence, retries et réception hors ordre cadrés avant toute ouverture publique ;
- procédures Stripe CLI, webhook en échec, suspicion de double paiement et fuite de clé documentées.

### Moyens de paiement et périmètre

- cartes prévues uniquement avec les scénarios sandbox officiels ;
- disponibilité de PayPal en France documentée sans prétendre à son activation sur le compte ;
- Wero conservé comme possibilité future sous accès contrôlé/preview, sans promesse produit ni implémentation spécifique ;
- aucun IBAN ou établissement bancaire couplé au code ;
- aucune validation Stripe réelle, clé live, paiement public, push ou déploiement dans cette fondation.

## [0.6.4.1] — 2026-08-13

### Modifié

- Discographie resserrée autour d’une seule scène : grand hero retiré, titre et contrôles rapprochés du catalogue ;
- galerie 3D redressée et approfondie avec une carte centrale dominante, quatre plans latéraux plus espacés et des commandes rejetées aux extrémités ;
- profondeur statique conservée lorsque la réduction des animations est active, sans transition ni respiration ;
- ancienne section d’écoute redondante retirée de l’accueil et Deezer ajouté à la barre Accès rapide à partir du lien officiel déjà configuré.

### Périmètre

- données PostgreSQL, logique audio, stockage R2, filtres métier et administration inchangés ;
- aucun WebGL, canvas, carousel ou nouvelle dépendance.

## [0.6.4] — 2026-08-13

### Ajouté

- scène Discographie unique en perspective CSS 3D, exhaustive et alimentée par PostgreSQL, avec filtres et tris dynamiques ;
- navigation par flèches, clavier, cartes voisines et rail tactile mobile, sans multiplier les lecteurs audio ;
- barre Accès rapide partagée vers les six plateformes officielles configurées, avec glyphes SVG locaux documentés.

### Modifié

- hero Discographie raccourci et anciennes présentations redondantes retirées de la page publique ;
- projets sans cover conservés dans le catalogue grâce aux visuels éditoriaux existants, sans pochette fictive ;
- lecture continue, pause volontaire, Range R2 et source runtime PostgreSQL conservés dans la nouvelle scène.

### Accessibilité et performance

- focus visible et restauré après sélection, projet actif annoncé, filtres `aria-pressed` et tri natif ;
- profondeur, rotations et transitions neutralisées avec `prefers-reduced-motion: reduce` sans masquer le contenu ;
- aucune dépendance lourde, aucun WebGL/canvas et aucun préchargement global des previews audio.

## [0.6.3] — 2026-08-13

### Ajouté

- abstraction média unique avec pilotes local et objet S3-compatible, Cloudflare R2 recommandé ;
- buckets/namespaces public et privé strictement séparés, métadonnées backend/visibilité/fournisseur/SHA-256 dans `Asset` ;
- migration progressive idempotente, dry-run, sauvegarde logique et copie byte-for-byte sans suppression des sources ;
- primitives d’URL signée privée courte et tests ciblés stockage, Range, suppression, intégrité, traversal et IDOR.

### Modifié

- covers, previews audio et références de commande utilisent le même service de stockage ;
- routes cover/audio conservent URL interne, cache immutable, ETag, `HEAD`/`Range` et streaming Safari ;
- environnement Railway préparé pour un stockage objet durable, tandis que preview et QA restent locales.

### Sécurité et périmètre

- pilote local refusé en production/Railway, buckets objet public/privé obligatoirement distincts et aucune URL privée permanente ;
- aucune source WAV conservée, aucun blob PostgreSQL, secret, média personnel, paiement, livraison finale, push ou déploiement.

## [0.6.2] — 2026-08-13

### Ajouté

- pilotage Admin de la visibilité publique, du placement et de la position dans les jukebox ;
- édition du récit et CRUD des crédits musicaux facultatifs depuis la fiche catalogue ;
- dialogues accessibles pour les transitions sensibles et suppression renforcée des seules commandes sans obligation de conservation ;
- tests runtime de persistance catalogue, d’IDOR photo et de nettoyage transactionnel des commandes QA.

### Modifié

- Commander ne demande plus les mots à préserver, éléments à éviter ni prononciations ; les anciennes valeurs restent conservées en base ;
- toute photo encore sélectionnée est enregistrée avant la finalisation, au lieu de pouvoir être oubliée lors du changement de page ;
- récits publics, accès Admin du compte, Boutique, Contact et cadrage À propos clarifiés sans refonte générale.

### Sécurité et périmètre

- suppression serveur limitée aux brouillons ou commandes annulées sans paiement, service commencé, livraison, droits ni document ;
- références client toujours privées, normalisées hors webroot et autorisées par propriétaire ou rôle Admin ;
- aucune migration destructive, aucun paiement, stockage objet de production ou changement du moteur audio.

## [0.6.1] — 2026-08-12

### Ajouté

- visibilité publique indépendante du statut, placement explicite dans le jukebox publié ou en développement et ordre éditorial déterministe ;
- second jukebox conditionnel réutilisant strictement le composant audio existant, avec exclusion mutuelle des players ;
- catalogue publié compact avec compteur dynamique et extension native sans pagination client ;
- flèches premium symétriques de 48 px, consignes de navigation adaptées au desktop et au tactile.

### Sécurité et périmètre

- projets masqués exclus des listes, routes directes, sitemap et routes de médias publics ;
- migration additive préservant les statuts et données existants, sans projet fictif ni fallback hors PostgreSQL ;
- logique Safari de lecture continue conservée, à l’exception de la coordination nécessaire entre players concurrents.

## [0.6.0.4] — 2026-08-12

### Ajouté

- upload de morceaux complets MP3/WAV jusqu’à 80 Mio et génération FFmpeg d’une preview MP3 de 60 secondes maximum ;
- lecture locale du source, choix du début, ajustement à la fin et suppression systématique du fichier complet temporaire ;
- upload, remplacement et suppression ADMIN avec droits explicites et concurrence bornée à l’asset audio actif ;
- lecture publique streamée avec `Range`, lecteur accessible sur la fiche et présence conditionnelle sur l’accueil ;
- tests unitaires, runtime, HTTP et vrai parcours navigateur sur une base et un stockage QA jetables.

### Sécurité et périmètre

- aucune livraison privée ni conservation du morceau complet ; FFmpeg est borné, reproductible et réservé à cette route ;
- projets privés masqués au public, route Admin streamée et protégée, limite de 80 Mio et suppression des tags avant stockage ;
- aucun audio artistique ajouté automatiquement à la base personnelle.

## [0.6.0.3] — 2026-08-11

### Ajouté

- migration additive et idempotente des 25 projets vers PostgreSQL, avec dry-run, garde de cible et comparaison 25/25 ;
- administration privée du catalogue : publication, SEO, fiabilité, tracklist, liens directs et mise en avant unique ;
- upload de covers validées, réencodées en WebP sans métadonnées et stockées hors du webroot ;
- tests de concurrence, CRUD et stockage sur une base locale jetable.

### Modifié

- accueil, discographie, fiches, metadata et sitemap alimentés exclusivement par PostgreSQL ;
- `data/discography.ts` figé comme fixture historique de migration, sans fallback runtime ;
- cockpit aligné sur le même catalogue que le site public.

### Sécurité et périmètre

- mutations ADMIN protégées par session, origine, validation serveur et listes de champs explicites ;
- sauvegarde logique avant migration personnelle et empreintes Auth/commandes inchangées ;
- aucun projet artistique modifié pendant la préparation de la preview, aucun paiement, push, merge ou déploiement.

## [0.6.0.1] — 2026-08-11

### Modifié

- commande initiale limitée à l’usage personnel : 50 €, cover +10 €, priorité +30 €, soit 90 € maximum ;
- suppression du choix commercial et du prix 1 500 € dans Commander, avec prix et usage forcés côté serveur ;
- détail membre distinguant désormais le total de la création et l’état d’une éventuelle extension de droits.

### Ajouté

- modèle `CommercialLicense` et migration additive pour une demande autonome après `DELIVERED` ;
- prix serveur de 1 500 €, contrat spécifique requis, statuts dédiés et protection contre les demandes ouvertes en doublon ;
- route propriétaire post-livraison, interface privée, tests de domaine et couverture runtime jetable.

### Périmètre

- droit moral hors du dispositif et aucune part SACEM automatique ;
- aucun paiement, contrat électronique, facture, email, back-office, push, merge ou déploiement activé.

## [0.6.0] — 2026-08-11

### Ajouté

- brouillons de commande persistés, reprenables et supprimables par leur propriétaire ;
- finalisation atomique vers `AWAITING_PAYMENT`, référence concurrente sûre et timeline d’événements client ;
- calcul serveur en centimes pour l’usage personnel, l’exploitation commerciale étendue, la cover et la priorité ;
- espace membre listant brouillons, demandes actives et terminées, avec détail privé ;
- photos JPEG/PNG/WebP limitées, décodées, réencodées sans métadonnées et stockées hors du webroot ;
- migration Prisma dédiée, tests de domaine, tests de fichiers et validation runtime PostgreSQL jetable.

### Sécurité et périmètre

- compte actif et email vérifié requis, contrôles de propriété serveur et réponses neutres contre l’IDOR ;
- prix client ignoré, snapshots tarifaires, contrat spécifique requis pour l’exploitation commerciale ;
- aucun paiement, PSP, webhook, secret marchand, facture, email de commande ou livraison WAV active ;
- informations professionnelles confirmées distinguées des validations fiscales, juridiques et d’adresse encore nécessaires.

## [0.5.2.1] — 2026-08-11

### Modifié

- biographie officielle de Ludovic Mathon et démarche artistique LNX Beats harmonisées entre l’accueil et la page À propos ;
- CTA, discographie, Commander, boutique, contact et parcours d’authentification rendus plus explicites sans perdre leur ton éditorial ;
- espace compte clarifié avec des libellés humains et une vision honnête des fonctions futures ;
- pages légales transformées en checklists préparatoires distinguant les éléments identifiés, à fournir et à valider ;
- avertissement LCP de la page À propos corrigé par le préchargement de son image principale.

### Documentation et périmètre

- vision produit des rôles, commandes, livraisons, favoris, alertes, paiements futurs et administration ;
- audit réel de chaque page et inventaire des actions humaines encore nécessaires ;
- aucun flux métier, paiement, email de production, téléchargement, CRUD admin, dépendance ou changement Prisma ajouté.

## [0.5.2] — 2026-08-10

### Ajouté

- inscription publique `MEMBER`, vérification email, renvoi et récupération de compte ;
- profil membre minimal, email en lecture seule et changement de mot de passe connecté ;
- templates de vérification/reset et transport QA local sans appel réseau ;
- migration dédiée garantissant l’unicité des marqueurs de consommation ;
- tests unitaires ciblés et suite PostgreSQL runtime couvrant tous les parcours sensibles.

### Sécurité et périmètre

- comptes publics créés `PENDING`, sans session, puis activés après vérification ;
- tokens expirables, reset stocké sous identifiant haché, vérification à usage unique et aucun token loggé ;
- anti-énumération, validation stricte des payloads, origine exacte et rate limiting PostgreSQL étendu ;
- reset révoquant toutes les sessions et changement connecté faisant tourner la session courante ;
- pages auth dynamiques, `noindex`, hors sitemap et transport capture limité à `@example.invalid` ;
- aucun email réel, admin permanent, SMTP production, push, merge ou déploiement.

## [0.5.1] — 2026-08-10

### Ajouté

- Better Auth et adaptateur Prisma pour des sessions PostgreSQL serveur ;
- mots de passe Argon2id, tables credentials/sessions/vérifications/rate limiting et migration dédiée ;
- connexion fermée, espace compte minimal et placeholder admin ;
- helpers serveur pour les rôles `ADMIN`, `MEMBER` et `CUSTOMER` actifs ;
- tests ciblés et suite runtime auth sur base locale jetable.

### Sécurité et périmètre

- inscription publique et sélection de rôle refusées ;
- cookies `HttpOnly`, `SameSite=Lax`, `Secure` en production, durée de 12 heures et logout révocatoire ;
- protection d’origine/CSRF, redirections internes validées, anti-énumération et rate limiting PostgreSQL ;
- pages privées dynamiques, `noindex`, absentes du sitemap et protégées côté serveur ;
- aucun email, reset public, dashboard, compte permanent, secret, push ou déploiement.

## [0.4.1] — 2026-08-10

### Validé

- migration initiale appliquée depuis une base PostgreSQL locale vide, réinitialisée puis rejouée sans erreur SQL ;
- schéma physique, Prisma Client, singleton, CRUD, valeurs par défaut, UUID et horodatages ;
- contraintes d’unicité, composites, `CHECK`, clés étrangères et comportements `RESTRICT`, `SET NULL` et `CASCADE` ;
- rollback transactionnel, concurrence sur une unicité, déconnexion et reconnexion ;
- absence de drift entre migrations, schéma Prisma et base après reset.

### Sécurité et périmètre

- suite d’intégration protégée par des gardes imposant le mode test, une cible nommée, une adresse de boucle locale et un port non standard ;
- données QA fictives nettoyées et instance PostgreSQL jetable supprimée après validation ;
- aucune base distante ou de production, aucun secret, aucune donnée artistique et aucune bascule frontend utilisés ;
- aucun changement du schéma métier ni de la migration V0.4.

## [0.4.0] — 2026-08-10

### Ajouté

- Prisma ORM 7 et adaptateur PostgreSQL officiel ;
- schéma métier pour comptes, clients, catalogue, pistes, plateformes, crédits, assets, commandes, historique et favoris ;
- migration PostgreSQL initiale avec contraintes relationnelles et contrôles de cohérence ;
- singleton Prisma compatible avec le rechargement Next.js ;
- documentation du modèle, des suppressions, de la confidentialité et de la future migration du catalogue.

### Sécurité et périmètre

- aucun secret, utilisateur, seed ou donnée artistique ajouté ;
- aucune connexion à une base réelle et aucune migration exécutée ;
- aucune authentification, administration, commande, livraison ou intégration de paiement activée ;
- `data/discography.ts` reste la source runtime du site public.

## [0.2.0] — 2026-08-09

### Ajouté

- modèle de catalogue extensible pour les parutions et projets en développement ;
- fiches statiques `/album/[slug]`, metadata dynamiques et entrées de sitemap ;
- composants de pochette, liens officiels et tracklist avec états de données manquantes explicites ;
- sélection éditoriale sur l’accueil et la discographie ;
- structure dédiée aux futurs projets narratifs et expérimentaux.

### Modifié

- direction artistique sombre et cinématographique autour du slogan officiel ;
- contenus des pages à propos, commande, boutique, contact et footer ;
- responsive, micro-interactions CSS et documentation du catalogue.

### Sécurité et intégrité éditoriale

- aucun flux backend, paiement, stockage ou envoi réseau ajouté ;
- aucune pochette, date, tracklist, durée, statistique ou disponibilité inventée ;
- distinction explicite entre les liens de sortie et les profils artiste.

## [0.1.1] — 2026-08-09

### Modifié

- navigation mobile renforcée avec piégeage du focus et retour au déclencheur ;
- contrastes, cibles tactiles, noms de champs et validation explicite du genre musical ;
- liens officiels centralisés et catalogue exposé en lecture seule ;
- images prioritaires migrées vers l’API `preload` de Next.js 16 ;
- favicon PNG généré par l’application et asset de référence inutilisé retiré ;
- documentation alignée sur l’audit qualité.

### Sécurité

- Content Security Policy restrictive compatible avec Next.js ;
- protection anti-cadrage avec `frame-ancestors` et `X-Frame-Options` ;
- sérialisation JSON-LD neutralisant les balises HTML injectables ;
- audit des secrets, dépendances et flux réseau de la fondation.

## [0.1.0] — 2026-08-09

### Ajouté

- fondation Next.js 16, React 19, TypeScript strict et Tailwind CSS 4 ;
- design system sombre, premium et responsive ;
- accueil, discographie, commande visuelle, boutique, à propos et contact ;
- navigation mobile accessible et footer complet ;
- catalogue local typé ;
- SEO, Open Graph, sitemap, robots et données structurées ;
- endpoint Railway `/api/health` ;
- documentation d’architecture, roadmap et déploiement ;
- smoke test automatisé des routes principales.

### Modifié

- configuration Railway adaptée à Next.js ;
- scripts npm alignés sur lint, typecheck, build et smoke tests ;
- variables d’environnement réduites aux besoins réels de la V0.1.

### Supprimé

- serveur Express du prototype ;
- endpoints de commande, paiement, SMTP et administration non adaptés à cette fondation ;
- anciennes pages HTML, feuilles CSS et scripts client statiques ;
- fichiers JSON de persistance vides du prototype.

### Sécurité

- aucun paiement, envoi SMTP, stockage de brief ou interface d’administration actif ;
- aucune valeur secrète ajoutée au dépôt.
