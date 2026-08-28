# Cartographie des données personnelles — candidat

| Traitement | Données | Finalité/base pressentie | Destinataires | Conservation/gate |
|---|---|---|---|---|
| Compte | e-mail, nom, hash mot de passe, statut | Compte et sécurité — contrat/intérêt légitime | Railway/PostgreSQL | Compte actif puis politique d’inactivité |
| Session | token opaque DB, IP, user-agent, expiration | Authentification/sécurité — intérêt légitime | Railway | 12 h techniquement ; logs à auditer |
| Création musicale | brief, options, références, audio, événements | Mesures précontractuelles/contrat | Railway, Cloudflare R2 | `MUSIC_REFERENCE_FILE_RETENTION` |
| Boutique | ShopOrder, produits, quantités, adresse | Contrat/livraison | Railway ; futur transporteur | Durée contractuelle/comptable à décider |
| Paiement | provider, référence, statut, montant, devise, événements | Exécution/preuve/obligations | Stripe ou PayPal, Railway | Politique financière/comptable |
| Notifications | destinataire, type, statut, id provider | Exécution/preuve | Resend, Railway | Politique d’outbox et incidents |
| Droits/contrats | identité contractuelle, documents, acceptations | Contrat/preuve | Railway, R2 | Durées légales/probatoires |
| Rétractation | identité déclarée, commande déclarée, demande, accusé, revue | Obligation légale/preuve | Railway ; e-mail futur | À fixer avec conseil ; pas de refund auto |
| Logs sécurité | identifiants internes, code borné, IP selon service | Sécurité/intérêt légitime | Railway | Minimisation et durée à fixer |

## Données exclues

LNX STUDIO ne stocke ni numéro de carte complet, ni CVC, ni mot de passe PayPal. Les secrets, bodies webhook bruts et credentials ne doivent jamais apparaître dans les logs, captures ou documents.

## Cookies/traceurs

Le code audité utilise des cookies `HttpOnly`, `SameSite=Lax` de session, inscription et accusé de rétractation. Aucun analytics, pixel marketing ou iframe social n’a été trouvé. Si un traceur non essentiel est ajouté, il devra être bloqué avant consentement.

## Droits et suppression

Les demandes RGPD sont adressées à `lnx.beats.pro@gmail.com`. La suppression de compte doit distinguer effacement, anonymisation, restriction et archivage légal ; elle ne peut effacer des preuves que la loi impose de conserver.
