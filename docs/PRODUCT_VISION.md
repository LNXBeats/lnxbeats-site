# Vision produit — LNX Studio

## Mission

LNX Studio est l’espace numérique de LNX Beats, le projet artistique de Ludovic Mathon. Le site doit permettre de comprendre la démarche, d’écouter un catalogue documenté avec honnêteté, de confier une histoire et, progressivement, de suivre la relation qui en découle.

La promesse reste artistique avant d’être fonctionnelle : **chaque histoire mérite sa musique**. Les fonctions membres, commerciales et administratives doivent soutenir cette promesse sans transformer le site en interface SaaS générique.

## Principes de produit

1. **Une histoire avant une transaction.** Le parcours Commander prépare une rencontre et un brief avant de parler de paiement.
2. **La vérité avant le remplissage.** Une date, une pochette, un crédit, un prix ou une disponibilité inconnus restent explicitement inconnus.
3. **Une fonction annoncée n’est pas une fonction active.** Les écrans distinguent systématiquement ce qui existe aujourd’hui de ce qui est prévu.
4. **Un compte utile, pas décoratif.** Chaque donnée demandée doit servir l’accès, la sécurité, le suivi d’une création ou une préférence choisie.
5. **Une administration centrée sur la relation.** Les futurs outils doivent aider à suivre les projets, les contenus et les livraisons, sans tableau de bord inutilement complexe.
6. **Aucune pression marketing.** Les alertes de sortie et communications non essentielles reposent sur un choix explicite, distinct et révocable.

## Identité éditoriale officielle

### Biographie courte

LNX Beats est le projet artistique de Ludovic Mathon. Il transforme des scènes ordinaires, des liens et des émotions en récits musicaux où l’écriture, le rythme et l’image racontent une même histoire.

### Biographie principale

LNX Beats est le projet artistique de Ludovic Mathon. Son point de départ tient dans une conviction simple : une scène ordinaire peut contenir assez de matière pour devenir une œuvre musicale. Un détail, une habitude, une phrase ou un souvenir suffit parfois à ouvrir un récit. La musique ne vient pas illustrer ce qui s’est passé ; elle cherche la forme capable d’en révéler le mouvement, l’humour ou l’émotion.

Cette démarche place les personnages et les points de vue au premier plan. Les liens familiaux, les situations de bureau, les animaux qui observent les humains ou les petits désastres du quotidien peuvent ainsi devenir les protagonistes d’un morceau. L’écriture part du réel, puis le déplace juste assez pour faire apparaître ce que l’on ne regardait plus. La production construit ensuite un espace propre à chaque histoire, sans imposer une couleur unique à l’ensemble.

Le catalogue de LNX Beats traverse ainsi le rap narratif, l’humour, l’émotion et des formes plus cinématographiques ou expérimentales. Ce qui relie ces directions n’est pas un genre fixe, mais une manière de raconter. Une voix entre dans le cadre, une tension se dessine, un détail change la lumière : chaque projet cherche son langage plutôt qu’une formule répétée.

Des univers comme « J’ai adopté », « Bienvenue dans le bordel familial » ou « Chaos canin » sont déjà publiés. D’autres, parmi lesquels « Miss Click » et « Le Dernier Âge d’Or », restent volontairement présentés comme des projets en développement tant que leur forme, leur date ou leurs éléments officiels ne sont pas établis. Cette distinction fait partie de la démarche : montrer ce qui existe sans fabriquer ce qui manque encore.

Les créations personnalisées prolongent ce geste. La personne ne vient pas seulement demander une chanson : elle confie une histoire, ses repères et ce qu’elle souhaite préserver. Le rôle de LNX Beats est alors d’écouter, de choisir un point de vue et de chercher la forme musicale juste. Dans le catalogue comme dans ces rencontres, la même promesse demeure : chaque histoire mérite sa musique.

### Biographie presse

LNX Beats est le projet artistique de Ludovic Mathon, consacré à la transformation d’histoires ordinaires en récits musicaux. Son travail part de personnages, de souvenirs, de liens et de scènes du quotidien, puis cherche la voix, le rythme et la couleur capables d’en révéler l’humour ou l’émotion. Son catalogue traverse le rap narratif, des formes cinématographiques et l’expérimentation sans s’enfermer dans un genre unique. Des univers publiés comme « J’ai adopté », « Bienvenue dans le bordel familial » ou « Chaos canin » côtoient des projets encore en développement, clairement signalés comme tels. Les créations personnalisées prolongent cette démarche : une histoire est confiée, écoutée, puis mise en musique sans perdre ce qui la rend singulière.

Ces trois versions sont les références éditoriales. Elles n’ajoutent aucune information biographique privée, récompense, collaboration, statistique ou anecdote non documentée.

## Publics et rôles

### Auditeur / visiteur

Le visiteur peut comprendre la démarche, consulter la discographie, ouvrir les fiches projet, utiliser localement le parcours Commander, suivre les liens officiels et contacter LNX Beats. Il ne doit pas avoir besoin d’un compte pour écouter ou comprendre l’artiste.

### Membre — `MEMBER`

Le membre possède actuellement un accès vérifié, un profil minimal et des fonctions de sécurité. À terme, ce rôle peut enregistrer des favoris, choisir des alertes de sortie et préparer une future relation de commande. Le rôle reste distinct d’un client tant qu’aucune commande n’a été acceptée.

### Client — `CUSTOMER`

Le rôle client correspondra à une relation de commande réelle. Il doit pouvoir suivre l’avancement, retrouver les échanges structurants, consulter les éléments convenus et récupérer les livraisons autorisées. Le passage de membre à client doit être déclenché par un événement métier explicite, jamais par une simple inscription.

### Administrateur — `ADMIN`

L’administrateur gère à terme les membres, clients, commandes, statuts, livraisons, catalogue, assets et niveaux de confiance. Les droits restent contrôlés côté serveur. Aucune création publique d’administrateur et aucune promotion libre de rôle ne sont admises.

## Valeur du compte membre

### Essentiel

- identité du compte, adresse vérifiée et sécurité de session ;
- suivi lisible des créations réellement confiées ;
- historique des changements de statut utiles ;
- accès sécurisé aux livraisons autorisées ;
- préférences transactionnelles nécessaires au service.

### Utile

- projets favoris ;
- alertes choisies pour les nouvelles sorties ;
- réutilisation volontaire de coordonnées déjà fournies ;
- archivage de récapitulatifs et documents liés à une commande ;
- liste des appareils ou sessions si le besoin de sécurité est confirmé.

### Optionnel

- recommandations personnalisées ;
- collections ou listes éditoriales privées ;
- préférences fines de formats ou de canaux ;
- avantages liés à de futures éditions physiques.

Les fonctions optionnelles ne justifient jamais une collecte obligatoire. La V0.5.2.1 n’active aucun de ces nouveaux services : elle explique seulement leur destination.

## Suivi d’une création personnalisée

Le futur parcours doit conserver le langage du studio tout en restant sans ambiguïté. Les statuts métier déjà préparés par Prisma peuvent être présentés ainsi :

| Statut interne | Libellé membre proposé | Sens |
| --- | --- | --- |
| `DRAFT` | Brief en préparation | Le récit n’a pas été transmis. |
| `SUBMITTED` | Histoire reçue | Le brief a été transmis avec succès. |
| `REVIEWING` | En cours d’étude | LNX Beats analyse le besoin et les conditions. |
| `ACCEPTED` | Projet accepté | Le périmètre, le prix et les conditions ont été acceptés. |
| `IN_PROGRESS` | Création en cours | Le travail artistique a commencé. |
| `IN_PROGRESS` + jalon | Finalisation | Une étape d’avancement, pas un nouveau statut tant que le besoin n’est pas confirmé. |
| `DELIVERED` | Livré | Les fichiers autorisés sont disponibles. |
| `CANCELLED` | Projet arrêté | Le projet ne se poursuit pas ; la raison et les conséquences doivent être expliquées. |

Chaque changement important doit produire un événement horodaté et compréhensible. La timeline membre ne doit pas exposer les notes internes, les identifiants techniques ou les opérations administratives sans intérêt pour le client.

## Favoris, alertes et préférences

### Favoris

Le modèle `Favorite` prépare une relation entre un compte et un projet. Une future interface doit offrir une action explicite, un état réversible et une liste simple. Aucun favoritisme ou recommandation ne doit être déduit d’un simple historique de navigation.

### Alertes de sortie

Les alertes artistiques sont distinctes des messages transactionnels. Elles exigent :

- un choix explicite par canal ;
- une preuve horodatée du consentement ;
- une désinscription immédiate et accessible ;
- l’absence de case précochée ;
- aucun mélange avec la vérification de compte, la sécurité ou les messages de commande.

### Préférences

Les préférences doivent rester rares et compréhensibles : nouvelles sorties, nouveautés boutique, actualités importantes, mises à jour de commande, canal transactionnel et éventuellement formats de livraison. Le silence vaut refus pour toute communication non essentielle.

Un futur centre `/compte/preferences` pourra séparer clairement :

- les messages transactionnels nécessaires à une commande ;
- les alertes de sorties musicales ;
- les nouveautés boutique ;
- les communications éditoriales ou marketing facultatives ;
- le canal choisi et l’historique du consentement.

## Téléchargements et livraisons futurs

Les fichiers livrés doivent être associés à une commande et à un rôle explicite (`DELIVERY`, document ou référence). Leur accès devra être authentifié, limité dans le temps si nécessaire, journalisé sans contenu sensible et révocable. Les URLs publiques permanentes et prévisibles sont exclues.

Les formats livrés, durées d’accès, versions, droits d’usage et possibilités de nouvelle récupération restent **À VALIDER** avant activation.

## Boutique et éditions physiques

La boutique actuelle ne traite aucun achat : elle renvoie vers les espaces officiels externes. Une boutique interne pourra être étudiée pour des albums physiques, CD, éditions limitées, objets collector ou prolongements visuels. Aucun produit, stock, prix, délai ou précommande ne doit apparaître sans donnée officielle et processus de livraison validé.

## Paiements futurs

### PayPal

Une future intégration doit créer l’intention côté serveur, vérifier la confirmation via API ou webhook, appliquer l’idempotence, rapprocher le paiement de la commande et ne jamais prendre le succès d’une redirection navigateur comme preuve de règlement. Aucun bouton réel, secret, identifiant marchand ou SDK PayPal n’est ajouté en V0.5.2.1.

### Virement bancaire et RIB

Le virement peut être proposé après acceptation du devis. Le RIB ne doit pas être publié dans le dépôt, les pages statiques ou les logs. Il devra être transmis par un canal approprié, avec une référence de paiement, une procédure de rapprochement et une validation humaine. Aucune coordonnée bancaire n’est ajoutée dans cette version.

### Règles communes

Les montants, taxes, acomptes, échéances, remboursements, factures, litiges et preuves de paiement restent **À VALIDER**. Aucun statut de commande ne doit devenir « payé » sur la seule base d’une action client.

## Administration future

Le futur espace administrateur est organisé autour de huit domaines :

1. **Tableau de bord** — commandes en attente ou en cours, activité récente et données de catalogue incomplètes, sans statistique décorative ;
2. **Membres et clients** — identité, statut, rôle, accès et demandes relatives aux données ;
3. **Commandes** — briefs, périmètre accepté, timeline, prix, paiement et attribution ;
4. **Livraisons** — versions, fichiers, droits et accès ;
5. **Catalogue** — projets, albums, pistes, plateformes, crédits, statuts et niveau de confiance ;
6. **Assets et boutique** — origine, usage, droits, produits futurs, stock et remplacement ;
7. **Messages et notifications** — transactionnel, consentements artistiques, erreurs et désinscriptions ;
8. **Configuration** — paramètres strictement nécessaires, secrets exclus de l’interface et opérations sensibles auditées.

Le placeholder `/admin` reste minimal tant que ces opérations ne sont pas implémentées et testées. Il ne doit pas simuler de statistiques ni de contenus métier.

## Informations légales à obtenir

### Mentions légales — À FOURNIR

- identité ou dénomination professionnelle de l’éditeur ;
- statut juridique, SIREN, SIRET et TVA si applicable ;
- adresse professionnelle publiable ;
- directeur ou directrice de publication ;
- contact professionnel confirmé ;
- identité légale et coordonnées de l’hébergeur de production ;
- cadre de propriété intellectuelle et de responsabilité éditoriale.

### CGV — À FOURNIR ou À VALIDER

- vendeur, champ de l’offre, prix, taxes et devis ;
- livrable, calendrier, retours et validation ;
- droits d’usage, licences et propriété intellectuelle ;
- rétractation, annulation, remboursement et exceptions liées au sur-mesure ;
- PayPal, virement, facturation, incidents et litiges ;
- médiateur de la consommation et juridiction compétente.

### Facturation future — À FOURNIR ou À VALIDER

- séquence et format du numéro de facture ;
- date d’émission et date d’échéance ;
- identité et adresse du vendeur et du client ;
- description de la prestation ;
- montant, devise, taxes et éventuelles exonérations ;
- moyen et statut de paiement ;
- mentions obligatoires, pénalités et conservation ;
- procédure d’avoir, d’annulation et de rapprochement.

### Confidentialité — À FOURNIR ou À VALIDER

- responsable de traitement et contact ;
- finalités, bases légales et durées de conservation ;
- exercice des droits et suppression/anonymisation ;
- hébergeur, fournisseur email et futurs sous-traitants ;
- cookies de session, mesures de sécurité et consentements ;
- règles des futurs briefs, commandes, paiements, fichiers et notifications.

La politique définitive doit reconnaître les données d’authentification déjà traitées. Elle ne peut plus affirmer que le site ne conserve aucune donnée.

## Frontières de la V0.5.2.1

Cette version :

- aligne les textes et CTA avec l’identité LNX Beats ;
- publie la biographie artistique autorisée ;
- clarifie l’utilité actuelle et future du compte ;
- documente les parcours membres, commandes, administration, boutique et paiements futurs ;
- prépare les champs juridiques sans inventer de données.

Cette version n’ajoute :

- aucune commande persistée ;
- aucun email de production ou notification marketing ;
- aucun téléchargement ;
- aucun paiement, bouton PayPal ou RIB ;
- aucun CRUD administrateur ;
- aucune nouvelle dépendance ni modification du schéma Prisma.
