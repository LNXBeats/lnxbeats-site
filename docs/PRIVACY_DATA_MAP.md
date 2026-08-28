# Cartographie des données personnelles — candidat

| Traitement | Données | Finalité/base pressentie | Destinataires | Conservation/gate |
|---|---|---|---|---|
| Compte | e-mail, nom, hash mot de passe, statut | Compte et sécurité — contrat/intérêt légitime | Railway/PostgreSQL | Compte actif puis politique d’inactivité |
| Session | token opaque DB, IP, user-agent, expiration | Authentification/sécurité — intérêt légitime | Railway | 12 h techniquement ; logs à auditer |
| Création musicale | brief, options, références, audio, événements | Mesures précontractuelles/contrat | Railway, Cloudflare R2 | Références jusqu’à 90 jours après livraison, hors obligation/litige |
| Boutique | ShopOrder, produits, quantités, adresse livraison, future adresse facturation, retour | Contrat/livraison | Railway ; futur transporteur seulement après activation | Durée contractuelle/comptable ; tracking futur |
| Paiement | provider, référence, statut, montant, devise, événements | Exécution/preuve/obligations | Stripe ou PayPal, Railway | Politique financière/comptable |
| Facturation | identité B2C/B2B, raison sociale, adresse facturation, SIREN/SIRET/TVA si pertinents, facture, avoir, snapshot et audit | Obligation légale/comptable et preuve | Railway/PostgreSQL ; client propriétaire ; Admin autorisé | Dix ans ; exclu de la purge de compte |
| Notifications | destinataire, type, statut, id provider | Exécution/preuve | Resend, Railway | Politique d’outbox et incidents |
| Droits/contrats | identité contractuelle, documents, acceptations | Contrat/preuve | Railway, R2 | Durées légales/probatoires |
| Rétractation | identité déclarée, commande déclarée, demande, accusé, revue, retour et lien éventuel vers remboursement/avoir | Obligation légale/preuve | Railway ; e-mail futur | Selon obligation et délais de recours ; pas de refund auto |
| Logs sécurité | identifiants internes, code borné, IP selon service | Sécurité/intérêt légitime | Railway | Minimisation et durée à fixer |

## Données exclues

LNX STUDIO ne stocke ni numéro de carte complet, ni CVC, ni mot de passe PayPal. Les secrets, bodies webhook bruts et credentials ne doivent jamais apparaître dans les logs, captures ou documents.

## Cookies/traceurs

Le code audité utilise des cookies `HttpOnly`, `SameSite=Lax` de session, inscription et accusé de rétractation. Aucun analytics, pixel marketing ou iframe social n’a été trouvé. Si un traceur non essentiel est ajouté, il devra être bloqué avant consentement.

## Droits et suppression

Les demandes RGPD sont adressées à `lnx.beats.pro@gmail.com`. La suppression de compte doit distinguer effacement, anonymisation, restriction et archivage légal ; elle ne peut effacer des factures, avoirs, pièces comptables ou preuves que la loi impose de conserver. L’archive comptable doit rester séparée des données de profil devenues inutiles et son accès limité.
