# Audit produit et éditorial — V0.5.2.1

## Méthode

Chaque page a été relue dans le code puis contrôlée dans un navigateur réel, sur mobile et desktop. L’audit vérifie l’objectif, la compréhension, la vérité des données, les CTA, la place du compte et la distinction entre fonction active et intention future.

Les ajustements restent éditoriaux ou de présentation. Aucun flux métier, paiement, email de production, stockage de brief ou administration opérationnelle n’est ajouté.

> **Addendum V0.6 :** ce document conserve l’état observé lors de la V0.5.2.1. Commander enregistre désormais des brouillons et photos privés pour les membres vérifiés, puis finalise une demande `AWAITING_PAYMENT`. Le paiement, les emails de commande, la facture et la livraison restent inactifs. L’état technique courant est décrit dans [`ORDER_MODEL.md`](ORDER_MODEL.md).

## Éléments transversaux

### Header

- **Objectif** : rendre les destinations principales et l’accès membre immédiatement disponibles.
- **Constat** : navigation cohérente, état actif, menu mobile, fermeture par Échap et piégeage du focus déjà fonctionnels.
- **Décision** : conserver l’architecture. « Connexion » / « Mon compte » reste un libellé fonctionnel, distinct des CTA artistiques.

### Footer

- **Objectif** : réunir navigation, plateformes, boutiques, contact et pages légales.
- **Constat** : structure complète et liens officiels centralisés ; le slogan suffit ici, la biographie courte étant désormais présente sur l’accueil.
- **Décision** : aucune surcharge éditoriale ajoutée.

### CTA

- **Problème** : plusieurs CTA poétiques (« Entrer », « Ouvrir », « Traverser ») rendaient la destination moins prévisible.
- **Modification** : préférer une action concrète — « Écouter la discographie », « Voir la fiche », « Préparer votre récit », « Écrire à LNX Beats », « Se connecter ».
- **Justification** : conserver une voix artistique dans les titres et confier aux CTA une fonction d’orientation.

### Inventaire des CTA après audit

- **Header** : `Commander`, `Connexion` ou `Mon compte` selon le contexte.
- **Accueil** : `Écouter la discographie`, `Préparer votre histoire`, `Voir toute la discographie`, `Voir la fiche du projet`, `Voir la fiche`, `Préparer votre récit`, `Créer un espace membre`, `Se connecter`, `Écrire à LNX Beats`.
- **Discographie et albums** : `Voir la fiche du projet`, `Retour à la discographie` et liens de plateformes nommés.
- **Commander** : `Raconter l’histoire`, `Choisir la couleur`, `Relire le récapitulatif`, `Étape précédente`, puis `Envoi indisponible pour le moment`.
- **Boutique** : `Ouvrir DistroKid Direct`, `Ouvrir la page Etsy`.
- **À propos et contact** : `Écouter la discographie`, `Écrire à LNX Beats`.
- **Authentification** : `Entrer dans mon espace`, `Créer mon espace`, `Recevoir un lien`, `Renvoyer le message`, `Modifier le mot de passe`, `Enregistrer le profil`, `Fermer la session`.
- **404** : `Revenir à l’accueil`.

Les répétitions restantes correspondent à une même action réelle. Les libellés de formulaire restent volontairement plus simples que les accroches artistiques.

## `/` — Accueil

- **Objectif** : faire comprendre en quelques secondes l’identité, la promesse et les chemins principaux.
- **Constat avant** : univers fort et cohérent, mais Ludovic Mathon n’était jamais nommé et la valeur du compte restait invisible.
- **Modification** : biographie courte dans la démarche, lien vers À propos, CTA explicites, section membre distinguant fonctions actuelles et futures.
- **État final** : l’artiste, la promesse, la discographie, la création personnalisée, les plateformes, le compte et le contact forment une progression complète.
- **À fournir plus tard** : aucune statistique, citation presse ou actualité n’est ajoutée sans source.

## `/discographie`

- **Objectif** : présenter le catalogue et son niveau réel de documentation.
- **Constat avant** : distinction technique correcte entre parutions et développement, mais les intitulés de sections étaient parfois trop métaphoriques.
- **Modification** : introduction factuelle, « Sélection d’entrée », « Parutions publiées », « Projets en développement » et CTA « Voir la fiche du projet ».
- **État final** : albums, singles et projets en développement sont identifiables sans supprimer le ton narratif des descriptions.

## `/album/jai-adopte-un-humain`

- **Objectif** : présenter une parution publiée sans extrapoler les données absentes.
- **Constat** : type, statut, date ou absence de date, confiance, crédits, plateformes et tracklist sont déjà rendus honnêtement.
- **Modification** : retour de navigation clarifié en « Retour à la discographie ».
- **État final** : aucune donnée artistique nouvelle n’a été inventée.

## `/album/jai-adopte`

- **Objectif** : vérifier une fiche album publiée avec nombre de pistes documenté mais détails incomplets.
- **Constat** : la fiche distingue correctement le nombre total de la tracklist disponible.
- **Modification** : aucune modification propre au contenu.
- **Reste à fournir** : pochette, année, tracklist détaillée, crédits ou liens directs uniquement après confirmation officielle.

## `/album/miss-click`

- **Objectif** : vérifier un projet en développement.
- **Constat** : statut et niveau de confiance explicites ; aucune date, pochette ou disponibilité fictive.
- **Modification** : seule la navigation transversale est clarifiée.
- **État final** : « Miss Click » reste un titre en développement, sans promesse de sortie.

## `/album/le-dernier-age-dor`

- **Objectif** : vérifier un second projet en développement et éviter un cas isolé.
- **Constat** : même comportement honnête que « Miss Click ».
- **Modification** : aucune donnée de catalogue modifiée.

## `/commander`

- **Objectif** : aider une personne à structurer une histoire avant un échange artistique.
- **Constat avant** : le parcours était humain et local, mais le livrable, les retours et les conditions futures restaient insuffisamment cadrés.
- **Modification** : vocabulaire de « brief », rappel des éléments à confirmer, repères du projet, CTA d’étapes plus descriptifs et bouton final « Envoi indisponible pour le moment ».
- **État final** : quatre étapes, validation locale, récapitulatif, aucun stockage, aucun envoi et aucun paiement.
- **À valider avant activation** : prix définitif, taxes, livrable, retours, calendrier, droits, CGV, paiement et confidentialité du brief.

## `/boutique`

- **Objectif** : orienter vers les espaces officiels et préparer une vision physique sans simuler un stock.
- **Constat avant** : absence de faux produit, mais la formulation Etsy pouvait laisser entendre une disponibilité stable.
- **Modification** : préciser que les disponibilités sont gérées hors site et évoquer CD, éditions limitées ou objets collector comme pistes non annoncées.
- **État final** : aucun produit, prix, stock, précommande ni achat interne.

## `/a-propos`

- **Objectif** : répondre à « qui crée, pourquoi et comment ? » sans biographie privée.
- **Constat avant** : démarche poétique cohérente, mais aucun nom civil ni texte biographique réutilisable.
- **Modification** : Ludovic Mathon est identifié comme porteur du projet LNX Beats ; biographie principale de référence et liens vers le catalogue.
- **Performance** : l’image LCP est préchargée afin de supprimer l’avertissement détecté en QA.
- **État final** : aucune date de naissance, récompense, collaboration, label, chiffre ou anecdote fictive.

## `/contact`

- **Objectif** : permettre un échange direct avec le créateur.
- **Constat avant** : ton juste et email direct, mais catégories incomplètes pour les demandes personnalisées.
- **Modification** : « Création personnalisée », « Collaboration », « Adaptation & droits », « Demande professionnelle » et « Autre échange » ; CTA « Écrire à LNX Beats ».
- **État final** : aucun formulaire ou support impersonnel ajouté.

## `/connexion`

- **Objectif** : donner accès au compte en expliquant sa valeur réelle.
- **Constat avant** : titre très narratif et promesse vague sur les « histoires, projets et échanges ».
- **Modification** : titre fonctionnel et distinction entre profil/sécurité actuels et suivi/livraison futurs.
- **État final** : formulaire et sécurité inchangés.

## `/inscription`

- **Objectif** : créer un compte `MEMBER` après confirmation de l’adresse.
- **Constat avant** : processus compréhensible mais bénéfice peu précis.
- **Modification** : finalité actuelle explicitée, absence de commande/paiement rappelée, lien vers la confidentialité et formulation de connexion simplifiée.
- **État final** : aucune préférence marketing obligatoire et aucune fonction fictive.

## `/mot-de-passe-oublie`

- **Objectif** : demander un lien sans révéler l’existence d’un compte.
- **Constat avant** : mécanisme correct, titre trop métaphorique.
- **Modification** : « Réinitialiser votre mot de passe » et explication simple de la réponse générique.

## `/renvoyer-verification`

- **Objectif** : recevoir un nouveau lien de vérification.
- **Constat avant** : mécanisme correct, titre ambigu.
- **Modification** : « Recevoir un nouveau lien » et maintien de l’anti-énumération.

## `/verifier-email`

- **Objectif** : afficher un résultat neutre après consommation du token.
- **Constat avant** : fonctionnement correct, états un peu trop narratifs.
- **Modification** : « Vérification du lien », « Adresse email confirmée » et « Lien inutilisable ».

## `/reinitialiser-mot-de-passe`

- **Objectif** : choisir un nouveau mot de passe ou confirmer le résultat.
- **Constat avant** : sécurité correcte, titres métaphoriques.
- **Modification** : titres fonctionnels sans changer le traitement du token ni la révocation des sessions.

## `/compte`

- **Objectif** : gérer le profil, la sécurité et expliquer l’évolution future de l’espace.
- **Constat avant** : fonctions utiles mais rôle et statut bruts (`ADMIN`, `ACTIVE`) donnaient une impression technique ; aucune perspective concrète.
- **Modification** : libellés humains, section simple — non présentée comme un dashboard — pour suivi, livraisons, favoris et alertes, tous marqués indisponibles ou futurs.
- **État final** : profil, changement de mot de passe et déconnexion restent les seules fonctions actives.

## `/admin`

- **Objectif** : confirmer un accès serveur réservé à `ADMIN` sans simuler une console métier.
- **Constat avant** : placeholder sécurisé et minimal.
- **Modification** : vocabulaire LNX Beats et liste textuelle des futurs domaines, sans compteur, tableau, CRUD ou donnée fictive.
- **État final** : rôle vérifié côté serveur ; aucune administration active.

## `/mentions-legales`

- **Objectif** : préparer la collecte des informations légales sans publier de données inventées.
- **Constat avant** : placeholder trop général.
- **Modification** : checklist visible des identités, immatriculations, adresse, direction de publication, hébergeur, responsabilité et propriété intellectuelle.
- **État final** : chaque inconnue porte « À FOURNIR » ou « À VALIDER » ; le document annonce qu’il n’est pas juridiquement finalisé.

## `/cgv`

- **Objectif** : préparer les conditions nécessaires à une future offre.
- **Constat avant** : simple phrase générique.
- **Modification** : champs relatifs à l’offre, au livrable, au prix, aux retours, aux droits, à la rétractation, à PayPal, au virement, à la facturation et aux litiges.
- **État final** : aucune condition commerciale n’est présentée comme validée et aucun paiement n’est actif.

## `/confidentialite`

- **Objectif** : décrire honnêtement les traitements présents et ceux à cadrer.
- **Anomalie avant** : la page affirmait seulement que le brief n’était pas conservé, sans mentionner les données d’authentification désormais persistées.
- **Modification** : distinction entre brief local et données de compte, sessions, credentials, vérifications et rate limiting ; liste des bases légales, durées, droits, sous-traitants et usages futurs à valider.
- **État final** : brouillon honnête, non présenté comme une politique définitive.

## `not-found`

- **Objectif** : expliquer l’erreur et retrouver un chemin sûr.
- **Modification** : CTA « Revenir à l’accueil », plus prévisible.

## UX, responsive et accessibilité

- La direction artistique sombre, les espaces, la hiérarchie et le système de motion sont conservés.
- Les CTA décrivent désormais leur destination sans supprimer la personnalité des titres.
- La nouvelle section membre utilise une composition éditoriale, pas des cartes de dashboard.
- Les checklists légales et la perspective compte utilisent des listes sémantiques.
- Le focus, les labels, les annonces de statut, les protections `noindex` et la navigation clavier existants sont conservés.
- Les dimensions prioritaires sont 320, 390, 430, 768, 1024, 1440 et 1920 px ; aucune information essentielle ne doit dépendre d’un hover ou d’une animation.

## Points qui exigent une action humaine

1. fournir une photo Hero HD officielle si l’asset actuel doit être remplacé ;
2. confirmer l’identité et le statut professionnels de l’éditeur ;
3. fournir SIREN, SIRET, TVA éventuelle et adresse professionnelle publiable ;
4. confirmer l’hébergeur de production et ses coordonnées légales ;
5. faire valider mentions légales, CGV et confidentialité par une personne compétente ;
6. définir précisément la prestation personnalisée, son livrable, ses versions éventuelles, ses retours, ses droits, son prix et ses délais ;
7. choisir le fournisseur email de production et documenter les sous-traitants ;
8. décider si PayPal et le virement sont réellement proposés, puis fournir les règles de rapprochement ;
9. confirmer les produits physiques, stocks, prix et modalités de livraison avant toute publication ;
10. fournir les pochettes, dates, crédits, tracklists et liens directs de sortie manquants uniquement depuis des sources officielles.
