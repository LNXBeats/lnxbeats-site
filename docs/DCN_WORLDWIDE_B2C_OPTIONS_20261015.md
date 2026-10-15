# DCN — choix fiscal et commercial pour la vente mondiale B2C

**Étude documentaire du 15 octobre 2026, pas une approbation fiscale, un devis ou une ouverture de pays.** Aucun compte prestataire consulté, aucun calcul fiscal distant, paiement ou inscription. Les sources ci-dessous sont publiques ; aucun accord commercial n’a été accepté.

## Point de départ acquis

L’EI LNX Beats, son SIRET, le régime spécial BNC/micro-BNC et la franchise française historiquement utilisée sont connus. CM2C est déjà souscrit. Il n’est demandé ni création d’entreprise ni nouvelle adhésion. Les nouveaux sujets sont la qualification et la territorialité des téléchargements musicaux, la licence/CGV numériques, les justificatifs et le traitement du complément d’album.

Un catalogue mondial n’implique pas un checkout mondial. Ni une carte étrangère acceptée par Stripe, ni un compte PayPal opérationnel, ni le mot « numérique » n’autorise tous les territoires. Le registre reste à **zéro ALLOW**.

## Trois voies distinctes

| Voie | Vendeur et responsabilité | Réemploi DCN | Coût / limite principale |
|---|---|---|---|
| Direct Stripe + PayPal, règles revues pays par pays | LNX vend ; conserve obligations fiscales, consommateurs, déclarations et preuves | Le plus élevé : commandes, bibliothèque, documents, réconciliation déjà existants | Frais PSP + veille, conseil, immatriculations/déclarations quand nécessaires ; coût administratif non chiffré sans devis |
| Direct + moteur fiscal / déclarant mandaté | LNX reste vendeur ; calcul et tâches délégués, responsabilité non automatiquement transférée | Garder DCN ; ajouter calcul transactionnel, preuves, enregistrement/annulation fiscale et rapprochement des déclarations | PSP + calcul + éventuel abonnement/déclaration. Un moteur n’est pas une inscription ni une opinion fiscale |
| Merchant of Record (MoR) | MoR vendeur contractuel des opérations couvertes ; obligations indirectes prises en charge dans son périmètre | Garder catalogue, médias et bibliothèque ; adapter paiement, vendeur contractuel, documents et événements financiers | Commission supérieure, contrôle fournisseur et exclusions ; aucune exonération des obligations propres de l’EI |

Stripe distingue explicitement Tax (l’entreprise reste responsable) et Managed Payments (Stripe/Link MoR des transactions couvertes). Cette différence est contractuelle, pas un simple flag de calcul. [Stripe Managed Payments](https://stripe.com/fr/managed-payments).

## Frais publics observés — jamais ceux présumés du compte

| Service | Tarif public lu | Conséquence pour DCN |
|---|---|---|
| Stripe Payments France | Carte standard EEE 1,5 % + 0,25 € ; premium EEE 2,8 % + 0,25 € ; UK 2,5 % + 0,25 € ; autres cartes internationales 3,15 % + 0,25 € ; conversion éventuelle +2 % | Sur un petit single, la part fixe est importante. Tarification du compte non relue ; autres moyens, litiges et remboursements à intégrer au modèle économique |
| PayPal France | Paiement PayPal commercial national standard 2,9 % + 0,35 € ; conditions internationales/conversion distinctes | Le prix carte sans compte PayPal n’est pas à confondre avec celui du portefeuille PayPal ; aucune tarification caritative du soutien pour DCN |
| Stripe Tax, intégration Checkout | 0,5 % dans les juridictions où l’entreprise est enregistrée pour collecter | Ne couvre pas automatiquement l’application PayPal existante |
| Stripe Tax, API autonome | 0,45 € / transaction ; dix calculs inclus, puis 0,04 € / calcul supplémentaire | Peut couvrir un autre PSP ; c’est une nouvelle intégration, pas le branchement actuel. Prix fixe potentiellement important pour un single |
| Stripe Managed Payments | +3,5 % par transaction réussie, **en plus** de Payments ; pas de minimum annoncé | À étudier en premier parmi les MoR pour limiter l’écart avec Checkout existant, sous réserve d’acceptation du compte et du produit |
| Lemon Squeezy | Base 5 % + 0,50 USD ; +1,5 % international hors US, +1,5 % PayPal, +0,5 % abonnement. Versements hors US : autres frais selon méthode | Pas simplement « 5 % tout compris ». Le paiement PayPal du MoR n’est pas l’application REST LNX existante |
| Gumroad | Liens directs/profil : 10 % + 0,50 USD ; Discover : 30 % | Plus orienté boutique créateur ; identité client, bibliothèque LNX et complément personnalisé à vérifier avant adaptation |

Sources de chaque barème : [Stripe Payments](https://stripe.com/fr/pricing), [PayPal France](https://www.paypal.com/fr/business/fees?locale.x=fr_FR), [détail PayPal](https://www.paypal.com/fr/business/paypal-business-fees), [Stripe Tax](https://stripe.com/fr/tax/pricing), [Managed Payments](https://stripe.com/fr/managed-payments), [Lemon Squeezy](https://www.lemonsqueezy.com/pricing), [frais additionnels Lemon Squeezy](https://docs.lemonsqueezy.com/help/getting-started/fees), [Gumroad](https://gumroad.com/pricing). Consultation publique le 15/10/2026 ; taxes sur frais, devise de règlement et conditions particulières du compte non présumées.

**Illustration sans tarif de lancement** : sur une assiette hypothétique de 10 €, Stripe carte standard EEE représente environ 0,40 €, PayPal standard national 0,64 €, Stripe + Tax Checkout environ 0,45 €, Stripe + Managed Payments environ 0,75 €. PayPal + Tax API représenterait environ 1,09 € hors coûts complémentaires. Les frais en USD des autres MoR ne sont pas convertis fictivement en euros. TVA collectée, commissions, remboursements et revenu déclarable sont des postes distincts ; ne pas comptabiliser seulement le net viré sans qualification.

## Éligibilité des MoR : ce qui est établi et ce qui manque

### Stripe Managed Payments — piste à vérifier, non sélectionnée

La documentation liste la France parmi les lieux vendeurs et les contenus audio numériques parmi les produits admissibles. Le code `txcd_10401100` décrit le téléchargement audio ponctuel avec droits permanents ; c’est une **correspondance documentaire candidate**, pas une catégorie activée pour LNX. L’accès dépend d’une revue Stripe. Certains pays clients sont exclus et la couverture fiscale annoncée (>80) n’est pas identique au nombre de pays de paiement (>195). Les biens physiques et services avec intervention humaine ne relèvent pas de ce mécanisme. [Éligibilité officielle](https://docs.stripe.com/payments/managed-payments/eligibility), [couverture fiscale](https://docs.stripe.com/payments/managed-payments/tax-compliance).

À confirmer uniquement si cette voie est choisie : admission de l’EI et des WAV/MP3 originaux, qualification du code pour la licence proposée, pays effectivement couverts, remises par utilisateur pour compléter l’album, pièces remises au client, remboursements initiés par le MoR et export des revenus. La documentation prévoit que Stripe puisse initier certains remboursements : notre ingestion financière devrait les traiter sans supposer une action Admin locale.

### Lemon Squeezy / Gumroad

Lemon Squeezy cite **Audio** parmi les biens acceptables mais exige les droits et, en règle générale, un produit livrable par son service. Il faut confirmer que des masters conservés dans R2 privé avec bibliothèque LNX et crédit album personnalisé sont compatibles. Aucune admission LNX vérifiée. Les commandes personnalisées, dons et produits physiques doivent rester séparés. [Produits acceptables et interdits](https://docs.lemonsqueezy.com/help/getting-started/prohibited-products).

Gumroad se présente comme MoR pour les taxes de vente depuis 2025. Ce discours ne prouve ni l’admission du catalogue, ni la compatibilité de ses événements et remboursements avec DCN, ni la disparition des obligations fiscales personnelles/professionnelles de LNX. Sa documentation décrit aussi l’ajout automatique de métadonnées audio à certains fichiers sans métadonnées : cela doit être clarifié avant de lui confier la livraison, car DCN garantit les octets de la version acquise. Ne pas supposer que le WAV livré par une autre plateforme restera identique. [Tarification et rôle](https://gumroad.com/pricing), [métadonnées audio](https://gumroad.com/help/article/176-metadata-for-audio-files).

Paddle n’est pas retenu par défaut : sa documentation vise principalement les logiciels, applications et jeux. Il n’y a pas ici de preuve d’admission des albums musicaux seuls ; il serait incorrect de les présenter comme un logiciel pour être accepté. [Politique officielle](https://www.paddle.com/help/start/intro-to-paddle/what-am-i-not-allowed-to-sell-on-paddle).

## Carte des obligations à instruire — aucun pays ouvert

| Territoire | Règle documentaire pertinente / nouvelle vérification LNX |
|---|---|
| France | Qualifier précisément la vente directe des propres enregistrements : BNC/droits d’auteur/BIC éventuel, TVA du nouveau produit et franchise effectivement applicable. Ne pas appliquer un seuil général sans examiner le régime artiste-auteur. Les textes et preuves historiques restent conservés |
| UE hors France | Étudier territorialité des services électroniques et seuil transfrontalier de 10 000 € sous conditions ; choisir OSS Union si applicable, ou franchise transfrontalière SME si éligible. SME exige chiffre UE courant/précédent ≤100 000 €, seuil national et notification/numéro EX confirmé pour chaque État choisi ; ce n’est pas la franchise française automatiquement exportée. SME et OSS peuvent coexister dans des pays différents, pas simultanément pour la même juridiction |
| Royaume-Uni | HMRC indique l’immatriculation du vendeur étranger pour les services numériques taxables aux consommateurs UK. Confirmer la qualification de ces fichiers et les obligations avant ouverture ; ne pas importer le seuil domestique UK comme franchise LNX |
| États-Unis | Pas de règle unique « TVA US ». Taxabilité et nexus varient : la Californie décrit le téléchargement sans support physique comme non taxable ; Washington impose des règles propres aux produits numériques et un nexus économique. Ces exemples ne constituent pas l’approbation de ces États ni des autres |
| Canada | Le régime fédéral numérique non-résident prévoit un seuil de recettes pertinentes de 30 000 CAD sur douze mois sous conditions. Vérifier aussi les régimes provinciaux et le rôle d’une plateforme ; aucun taux GST/HST/QST/PST codé par déduction |
| Australie | L’ATO indique un seuil de 75 000 AUD de chiffre GST pertinent pour les vendeurs étrangers de services/produits numériques aux consommateurs australiens. Assiette, période et situation réelle à confirmer ; aucun défaut mondial « 0 % » |
| Autres territoires | Étude spécifique et couverture MoR éventuelle, droits, sanctions, moyens de paiement et langues. Une liste de 249 codes ISO n’est pas une autorisation de vente |

Sources : [Commission — OSS](https://vat-one-stop-shop.ec.europa.eu/one-stop-shop_en), [Commission — SME transfrontalier](https://sme-vat-rules.ec.europa.eu/sme-scheme/cross-border-sme-scheme_en), [HMRC — services numériques](https://www.gov.uk/guidance/the-vat-rules-if-you-supply-digital-services-to-private-consumers), [Californie](https://www.cdtfa.ca.gov/formspubs/pub109/nontaxable-sales.htm), [Washington numérique](https://dor.wa.gov/forms-publications/publications-subject/tax-topics/digital-products-including-digital-goods), [Washington nexus](https://dor.wa.gov/taxes-rates/retail-sales-tax/marketplace-fairness-leveling-playing-field/remote-sellers), [Canada](https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/gst-hst-businesses/digital-economy-gsthst/find-out-need-register/cross-border-threshold-amounts.html), [ATO](https://softwaredevelopers.ato.gov.au/GSTintangibles).

Le 15/10, l’ouverture directe de la page française « franchise en base européenne » a encore renvoyé une maintenance. Son extrait indexé n’a pas été utilisé comme approbation fraîche ; la Commission fournit la source primaire UE. [Page impots concernée](https://www.impots.gouv.fr/je-souhaite-adherer-la-franchise-en-base-tva-europeenne). Les détails français restant déterminants sont à confirmer pour ce produit, pas à redemander pour toute l’EI.

## Conséquences techniques concrètes

**Vente directe** : registre existant réutilisable, mais il faut le peupler par versions approuvées, maintenir les règles et inscriptions, surveiller les seuils tous canaux, conserver les preuves client appropriées, traiter les corrections de taxe et rapprocher les déclarations. Les champs résidence/facturation de notre formulaire viennent du même client : ils ne prouvent pas deux sources indépendantes. Un indice serveur du prestataire peut être nécessaire. HMRC documente notamment le rapprochement adresse et pays fourni par le PSP ; ne pas remplacer cette preuve par un doublon de déclaration. [HMRC](https://www.gov.uk/guidance/the-vat-rules-if-you-supply-digital-services-to-private-consumers).

**Moteur fiscal** : adaptateur de calcul avant paiement, devis fiscal immuable, création/annulation des transactions fiscales seulement au bon état, clés d’idempotence, remboursements partiels et avoirs concordants. Stripe Tax avec PayPal nécessite l’API autonome, pas `automatic_tax` sur un paiement qui n’existe pas dans Checkout Stripe. Les immatriculations doivent être effectives avant collecte. Aucun branchement ni activation réalisé.

**MoR** : le fournisseur devient une partie contractuelle différente ; ce n’est pas le provider existant avec un nouveau nom. Conserver bibliothèque et versions privées, mais ajouter une preuve d’achat adaptée, un contrôle de vendeur/marchand, les événements signés/rapprochements, les remboursements/litiges du MoR et les documents du bon émetteur. Ne pas émettre une seconde facture de vente LNX au particulier pour la même opération si le MoR est le vendeur. Garder une preuve d’acquisition et les pièces MoR ; qualifier avec le conseil la relation LNX→MoR et les recettes à déclarer. [Adaptation Checkout documentée](https://docs.stripe.com/payments/managed-payments/update-checkout).

Le complément entre une ancienne vente directe et une nouvelle vente MoR exige un mécanisme de remise accepté et auditable par ce vendeur. Il n’est pas acquis qu’un crédit LNX historique puisse y être imputé. Les prix, taxes, recettes brutes et commissions doivent rester distincts. Aucun nouvel avantage, prix catalogue inventé ou avoir rétroactif.

## Recommandation conditionnelle et prochaine décision

**Inférence d’architecture, pas accord prestataire** : pour conserver au maximum DCN, deux voies raisonnables sont (A) vente directe sur territoires individuellement validés, ou (B) vérifier d’abord l’éligibilité Managed Payments uniquement pour le catalogue numérique international. Une solution hybride n’ouvre pas automatiquement le PayPal direct à l’étranger. Si Managed Payments n’est pas adapté, Lemon Squeezy est une seconde piste documentaire compatible avec l’audio, mais l’intégration de la bibliothèque et du crédit exige confirmation. Gumroad reste une alternative plus éloignée du checkout actuel.

La seule décision de modèle à demander ensuite : **conserver LNX vendeur direct avec un accompagnement fiscal territorial, ou accepter un MoR et ses commissions/identité client sur un périmètre numérique défini**. Aucun prestataire choisi, nouveau compte, abonnement ou contact externe dans ce lot.

Questions ciblées restantes pour l’expert : qualification du téléchargement propre à l’EI ; application de la franchise à ce nouveau produit ; options SME/OSS et obligations hors UE ; preuve client et conservation ; nature fiscale du crédit album et de ses remboursements ; traitement recettes/commissions selon le contrat MoR ; langue/garanties/confirmation/rétractation du nouveau contrat. CM2C est déjà désigné : seule sa couverture du nouveau parcours est à examiner si nécessaire, jamais une nouvelle adhésion.
