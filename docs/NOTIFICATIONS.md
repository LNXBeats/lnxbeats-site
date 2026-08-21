# Notifications transactionnelles

V0.7.3 étend l’outbox PostgreSQL existante. Elle ne crée pas de seconde source de vérité : Payment, Order, Delivery et RightsRequest sont enregistrés avant toute tentative d’e-mail. Une panne du transport ne régresse jamais ces objets métier.

## Canaux et transports

- `EMAIL` : `disabled`, `capture` ou `resend`.
- `SMS` : `disabled` ou `capture`. Aucun SDK, crédit ou envoi SMS réel n’est activé.
- Development utilise `capture` par défaut. Staging Resend exige une confirmation serveur explicite. Production reste refusée par le parseur V0.7.3.

Les services métier créent uniquement une ligne d’outbox versionnée. Le worker `npm run notifications:dispatch` réclame au plus 25 lignes, construit le rendu déterministe et appelle l’unique abstraction de transport. La route interne `POST /api/internal/notifications/dispatch` exige un bearer secret d’au moins 32 caractères ; aucun cron Railway n’est configuré.

## Événements utiles

Propriétaire : nouvelle commande payée, nouvelle demande de droits, acceptation client à contrôler. Client : paiement confirmé, commande acceptée, création démarrée, livraison disponible, informations droits demandées, préautorisation ou document DRAFT disponible, rejet et étape de paiement futur.

Les e-mails droits ne disent jamais qu’un contrat DRAFT ou qu’un droit est actif. Les événements techniques, retries et diagnostics ne créent pas d’e-mail client.

## Sécurité et minimisation

- liens construits depuis `APP_CANONICAL_URL`, sans origine navigateur ni token permanent ;
- aucun WAV, MP3, PDF, brief, identifiant Stripe ou chemin R2 dans le message ;
- HTML sans JavaScript ni ressource distante obligatoire, avec équivalent texte ;
- destinataires masqués dans l’Admin ;
- une adresse `.invalid`/`.test` est refusée par Resend ;
- `EMAIL_OWNER_RECIPIENT` est serveur uniquement ;
- aucun e-mail n’est une preuve métier.

La vue `/admin/notifications` affiche les statuts humains, tentatives, erreurs assainies et ressources. Un retry manuel réutilise la même notification logique et reste interdit après livraison ou suppression du destinataire.

## Harness Resend staging

La route interne `POST /api/internal/notifications/qa/resend` ne sert qu'à créer une fixture d'outbox synthétique. Elle n'appelle jamais Resend : l'envoi reste une seconde action humaine via le dispatcher existant. `GET` sur la même route retourne seulement des booléens de présence, statuts et types d'événements, jamais le destinataire ou l'identifiant fournisseur.

Le harness est indisponible hors `NODE_ENV=production` sur Railway `staging`, exige la confirmation dédiée et le Bearer worker, et refuse tout client activé, paiement ou SMS. Les quatre destinataires sont codés en dur dans le serveur ; aucun champ `recipient`, `email` ou `to` n'est accepté. Les Orders associées sont des lignes `CANCELLED`, sans utilisateur, client, Payment ou droit, avec un numéro `LNX-QA-RS-*` reconnaissable.

## Owner email smoke test staging

Le smoke test V0.7.3.2 est distinct du harness fournisseur. Il crée une seule Order synthétique `CANCELLED` et une seule notification `OWNER_NEW_ORDER`, sous la clé immuable `qa:owner-smoke:v0732:01`. Le destinataire vient exclusivement de `EMAIL_OWNER_RECIPIENT` et n'est jamais accepté par la requête.

Sa notification est explicitement exclue du dispatcher global. Seule la route ciblée peut appeler `dispatchOrderNotification(notificationId)` pour cet identifiant exact. Dès qu'une tentative existe, réussie ou non, cette route refuse un nouvel appel fournisseur. Aucun retry automatique, client, SMS ou Payment n'est créé.
