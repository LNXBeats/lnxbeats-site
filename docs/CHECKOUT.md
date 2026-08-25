# Checkout Commander V0.7.1

## Périmètre

V0.7.1 relie le formulaire Commander à la fondation Stripe V0.7.0 sans reconstruire le modèle paiement. Le parcours fonctionne uniquement en **Stripe Test**, dans le runtime QA local explicitement gardé. `PAYMENTS_ENABLED=false` reste la valeur suivie et l’application refuse Railway, Live, une base personnelle ou une origine non QA.

Le parcours ne promet ni PayPal, ni Wero, ni Apple Pay sur tous les appareils. Checkout affiche uniquement les moyens réellement proposés par Stripe. Aucun bouton de wallet n’est codé dans LNX Studio, aucune donnée carte ne traverse l’application et aucun SDK Stripe client n’est chargé dans Commander.

## Parcours client

Commander présente six étapes compactes :

1. **Projet** — repère, destinataire et contexte ;
2. **Histoire** — brief et champ libre « Détails importants » ;
3. **Options** — direction, émotion, cover +10 € et priorité +30 € ;
4. **Références** — jusqu’à dix photos privées normalisées ;
5. **Compte** — connexion ou inscription avec email vérifié ;
6. **Récapitulatif & paiement** — données relues, ventilation du snapshot tarifaire versionné, compte propriétaire et ouverture Checkout.

Les anciens champs « mots à préserver », « éléments à éviter » et « prononciation » ne sont jamais rendus. Leurs colonnes historiques restent intactes afin de ne détruire aucune ancienne donnée.

### Reprise après authentification

Avant la première persistance, le formulaire et les objets `File` sélectionnés restent uniquement dans le contexte React du layout racine. Le lien d’authentification transporte seulement une route interne sûre (`/commander?reprendre=1&etape=compte`) : jamais le brief, une option ou un nom de fichier. Aucun `localStorage`, `sessionStorage`, cookie applicatif ou query payload n’est utilisé.

Ce mécanisme couvre la navigation SPA connexion/inscription. Un rechargement complet avant toute sauvegarde efface volontairement cet état éphémère. Dès que le compte est vérifié, le passage vers le récapitulatif crée ou met à jour le brouillon PostgreSQL et enregistre les photos sélectionnées ; les refresh suivants reprennent l’Order persistante.

Commander ne propose aucun envoi MP3/WAV par le client. Les photos restent `Asset.type = IMAGE`, `OrderAsset.role = REFERENCE` et `visibility = PRIVATE`. Elles ne sont jamais envoyées à Stripe.

## Livraison Admin → Client

Le master final est un flux strictement distinct de Commander. Sur une commande payée encore en cours, l’ADMIN peut déposer ou remplacer un MP3/WAV de 200 Mo maximum. Le serveur contrôle taille, extension, MIME déclaré, signature et décodage FFmpeg avant d’écrire sous une clé opaque `orders/<orderId>/deliveries/<uuid>.(mp3|wav)` dans le bucket R2 **PRIVATE**. La relation active utilise `Asset.type = AUDIO` et `OrderAsset.role = DELIVERY` ; un index SQL garantit un seul master actif par Order.

Le dépôt n’altère pas automatiquement le statut métier. L’ADMIN suit les transitions existantes jusqu’à `FINALIZING`, puis la publication vers `DELIVERED` exige exactement un master privé valide. Le remplacement avant publication est atomique et produit une trace interne. Après publication, le propriétaire voit « Votre création est prête » ; avant, il voit « Votre création est en cours ».

Le téléchargement passe exclusivement par une route applicative authentifiée. Le propriétaire doit posséder l’Order, celle-ci doit être `DELIVERED` et sa fenêtre de téléchargement ne doit pas être expirée. L’ADMIN conserve l’accès opérationnel. Les autres membres et les anonymes reçoivent un refus neutre. La réponse est `private, no-store`, `nosniff`, téléchargeable, et supporte `HEAD`/`Range`. Aucune URL R2 publique persistante n’existe et le master n’est jamais transmis à Stripe.

## Order, prix et Checkout

Une Order appartenant au compte existe avant le paiement. Le passage au paiement la place dans `AWAITING_PAYMENT`. Le serveur calcule le snapshot avec l’unique fonction de domaine existante. La grille courante `2026-08-v2`, appliquée uniquement aux nouvelles Orders, contient :

- création : 2 000 centimes ;
- cover : 1 000 centimes ;
- priorité : 3 000 centimes ;
- totaux autorisés : 2 000, 3 000, 5 000 ou 6 000 centimes EUR.

La grille historique `2026-08-v1` reste valide avec une création à 5 000 centimes et les totaux 5 000, 6 000, 8 000 ou 9 000 centimes EUR. Une Order conserve sa `pricingVersion` lors de la sauvegarde, de la finalisation, du retry et de la génération Checkout ; aucune ancienne commande n’est repricée.

Le POST Checkout ne reçoit aucun montant ni devise. Il relit propriétaire, statut, usage et snapshot dans PostgreSQL, réserve une tentative idempotente, puis crée ou retrouve la Session hébergée. Le bouton se verrouille pendant la requête ; deux onglets restent sérialisés par les verrous et contraintes V0.7.0.

Une session LNX expirée entraîne un retour vers la connexion, puis vers la commande persistée. Le webhook continue de traiter un paiement Stripe signé sans dépendre de cette session navigateur.

## Modifier avant paiement

Une Order reste modifiable tant qu’aucun paiement n’a réussi. Sans Session active, le client revient directement dans Commander. Avec une Session ouverte ou un refus retryable, le POST same-origin `prepare-edit` :

1. vérifie session, propriété et statut ;
2. prend le verrou commun `payments:order:<orderNumber>` ;
3. expire la Session Stripe Test avec une clé idempotente ;
4. marque la tentative `EXPIRED` ;
5. autorise seulement ensuite la modification du brief, des photos et des options.

Le nouvel enregistrement recalcule le snapshot serveur dans la version déjà attachée à l’Order. Sous v2, une Session à 30 € ne peut donc jamais rester payable après l’ajout de la priorité portant le total à 60 €. Le même invariant demeure pour la grille historique v1, notamment lors d’un passage de 60 € à 90 €. Après `SUCCEEDED`, l’Order et ses options tarifaires ne sont plus éditables.

## Retour, confirmation et retry

Les URLs Stripe reviennent sur `/commande/[orderNumber]/confirmation`. Cette page exige une session vérifiée et la propriété de l’Order ; connaître le numéro ne suffit pas. Le paramètre `paiement=retour|annule` influence uniquement le texte d’interface.

La source de vérité reste PostgreSQL après webhook signé :

- `PENDING/CREATED` : confirmation en cours ;
- `SUCCEEDED` ou Order `PAYMENT_CONFIRMED` : paiement confirmé, commande reçue ;
- refus instantané retryable : paiement refusé, même Session reprise ;
- `EXPIRED/CANCELED` : nouvelle tentative propre autorisée ;
- `REQUIRES_REVIEW` : attente de vérification, aucune automatisation.

Le retour succès déclenche au plus 12 refresh espacés de 1,5 seconde, puis s’arrête. L’utilisateur retrouve toujours l’état dans Compte. Le retour annulation conserve l’Order et propose réessai ou modification ; il ne constitue ni une erreur fatale, ni un remboursement.

## Compte et Admin

`/compte` sépare les brouillons, paiements à finaliser, créations actives et commandes terminées. Chaque ligne affiche numéro, date, montant, statut de création, statut de paiement, options et action attendue. Le détail conserve le brief, les photos privées et la timeline. Il affiche l’état de création puis, après publication, le téléchargement privé du master.

La vue Admin par défaut « À examiner » priorise `PAYMENT_CONFIRMED` et les vrais états métier. Les `DRAFT/AWAITING_PAYMENT` sont dans « Brouillons / paiement ». Les événements `REQUIRES_REVIEW`, y compris non corrélés à une Order, disposent d’une visibilité minimale sans payload Stripe, secret ni donnée carte.

Une annulation métier d’une Order impayée utilise le même verrou que Checkout/webhook, puis expire la Session active. Si Stripe ne confirme pas l’expiration, la commande reste annulée et la tentative passe en revue avec un message Admin explicite. Un succès concurrent après annulation est également mis en revue ; il n’est ni perdu ni traité silencieusement.

## Photos et stockage

Les références restent `PRIVATE`, liées à l’Order et servies par les routes autorisées propriétaire/Admin. Elles ne sont jamais envoyées à Stripe, inscrites dans ses metadata ou rendues publiques. L’ajout et la suppression après finalisation exigent que toutes les tentatives soient réellement terminales (`EXPIRED/CANCELED`).

## Notifications transactionnelles

Deux notifications email possèdent une identité persistante et unique en PostgreSQL : nouvelle commande payée vers le propriétaire configuré, puis livraison disponible vers le client. Le webhook et la transition `DELIVERED` ne contactent jamais Resend dans leur transaction critique : ils créent l’outbox de façon idempotente, valident Payment/Order, puis le transport est déclenché séparément. Un replay webhook ne crée donc ni second Payment, ni second email. Un échec du fournisseur marque la notification `FAILED` pour retry sans annuler la confirmation du paiement ou la publication.

Le transport QA `capture` écrit uniquement hors dépôt en mode 0600. Resend reste soumis aux gardes d’environnement et à l’expéditeur approuvé ; l’email client réel demande une activation serveur explicite. Aucun master n’est joint au message. Le canal `SMS` est modélisé mais reste **READY FOR PROVIDER / NON CONFIGURED** : aucun fournisseur n’est inventé en V0.7.1.

## QA et sécurité

Les tests automatiques couvrent états client, reprise auth, prix serveur, route propriétaire, IDOR, double clic, concurrence, retour annulation, succès différé, refus/retry, expiration, paiement déjà réussi, annulation métier, filtre Admin, affichage Compte, validation audio de livraison, stockage privé, Range et idempotence des notifications.

La QA réelle utilise exclusivement la cible jetable `lnx-studio-v070-test`, l’origine `http://localhost:31700`, email capturé, confirmation opt-in et Stripe Test. Le listener doit transférer vers ce même hostname `localhost` : `127.0.0.1` n’est pas interchangeable lorsque Next écoute sur `[::1]`. La validation humaine V0.7.1 a couvert Commander, reprise après authentification, récapitulatif 90 €, annulation, retry, paiement Test, webhook signé, Compte, Admin, upload WAV privé, lecture Safari, publication et téléchargement client. L’absence de photo dans cette commande était volontaire et normale ; aucun audio client n’a été envoyé.

Le cleanup final utilise le mécanisme applicatif ciblé : il retire les identités, sessions, Orders, Payments, ProviderEvents, notifications, assets et rate-limits QA, puis prouve la disparition du master R2 privé. Les objets historiques Stripe Test peuvent rester distants ; aucun nouveau paiement n’est créé pour un replay ou un cleanup.

Avant tout Live : CGV/TVA/facturation, remboursement, emails, permissions Stripe live, monitoring, PayPal/Wero, Railway et validation juridique restent des chantiers séparés.
