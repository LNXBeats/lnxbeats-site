# Paiements production — préparation V0.8.0

V0.8.0 rend l’architecture techniquement compatible avec Stripe Live et PayPal Live. Elle ne configure aucun dashboard, ne charge aucun credential réel et n’autorise aucune transaction. L’ouverture reste une décision humaine distincte.

## Architecture et source de vérité

Le parcours est : `Order` → réservation transactionnelle d’un `Payment` → Checkout hébergé Stripe ou approbation PayPal → webhook signé/vérifié → réconciliation PostgreSQL → `OrderEvent` → outbox de notification. Le retour navigateur ne confirme jamais un paiement. Stripe Checkout hébergé maintient les données carte hors de LNX Studio ; aucun formulaire carte maison ne doit être ajouté.

Le montant est reconstruit depuis le snapshot serveur de l’Order, en centimes entiers et en EUR. Le navigateur ne choisit ni le provider effectif, ni le mode, ni le prix, ni la devise. `Payment.mode` (`TEST`/`LIVE`) et `ProviderEvent.livemode` forment la frontière persistante. Les états gagnants restent `SUCCEEDED`, `REFUND_PENDING`, `PARTIALLY_REFUNDED` et `REFUNDED` : un remboursement ne rend jamais l’Order payable par un second provider.

## Isolation et armement

L’ordre des gardes est : `PAYMENTS_ENABLED` → flag provider → configuration complète → environnement de déploiement → mode provider → runtime Railway/origine canonique.

- `development` et `staging` acceptent uniquement Stripe `test` et PayPal `sandbox` ;
- `production` accepte uniquement Stripe `live` et PayPal `live` ;
- la production activée exige `PAYMENT_PRODUCTION_CONFIRM=payments-production-live-approved` ;
- le staging activé exige `PAYMENT_STAGING_CONFIRM=payments-staging-sandbox-approved` ;
- l’existence de credentials ne rend jamais un provider utilisable ;
- un événement Stripe dont `livemode` diffère du endpoint configuré est rejeté avant toute mutation ;
- PayPal dérive ses hôtes API, approbation et certificat d’une enum serveur fermée.

État production initial recommandé :

```text
PAYMENT_DEPLOYMENT_ENV=production
PAYMENTS_ENABLED=false
STRIPE_PAYMENTS_ENABLED=false
PAYPAL_PAYMENTS_ENABLED=false
STRIPE_MODE=live
PAYPAL_ENVIRONMENT=live
```

Les secrets peuvent être préchargés dans le coffre. `PAYMENT_PRODUCTION_CONFIRM` reste absent tant que le global est désactivé. `/api/health` peut alors répondre 200 avec `payments.enabled=false`; aucun Checkout n’est accessible.

Callbacks dérivés uniquement de l’origine canonique : Stripe réussit vers `/commande/{orderNumber}/confirmation?paiement=retour&session_id={CHECKOUT_SESSION_ID}`, Stripe annule vers `?paiement=annule`, PayPal revient vers `?paiement=paypal-retour` et annule vers `?paiement=paypal-annule`. Ces retours sont informatifs : seul un webhook vérifié confirme le paiement.

## Variables Railway production

| Nom | Classe | Objet | Valeur/type staging | Valeur/type production | État production initial |
| --- | --- | --- | --- | --- | --- |
| `PAYMENT_DEPLOYMENT_ENV` | configuration serveur | environnement attendu | `staging` | `production` | `production` |
| `PAYMENTS_ENABLED` | configuration serveur | kill switch global | booléen | booléen | `false` |
| `PAYMENT_STAGING_CONFIRM` | configuration serveur | armement sandbox | phrase suivie | absent | absent |
| `PAYMENT_PRODUCTION_CONFIRM` | configuration serveur | armement Live explicite | absent | phrase suivie | absent |
| `STRIPE_PAYMENTS_ENABLED` | configuration serveur | provider Stripe | booléen | booléen | `false` |
| `STRIPE_MODE` | configuration serveur | mode Stripe | `test` | `live` | `live` |
| `STRIPE_SECRET_KEY` | secret | API Stripe | secret Test/restricted Test | secret Live/restricted Live | coffre, jamais affiché |
| `STRIPE_WEBHOOK_SECRET` | secret | signature du endpoint | secret endpoint Test | secret endpoint Live dédié | coffre, jamais affiché |
| `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` | public sûr, facultatif | future UI Stripe Elements | clé publiable Test | clé publiable Live | absent pour Hosted Checkout |
| `PAYPAL_PAYMENTS_ENABLED` | configuration serveur | provider PayPal | booléen | booléen | `false` |
| `PAYPAL_ENVIRONMENT` | configuration serveur | environnement PayPal | `sandbox` | `live` | `live` |
| `PAYPAL_CLIENT_ID` | secret serveur | OAuth PayPal | client Sandbox | client Live | coffre, jamais affiché |
| `PAYPAL_CLIENT_SECRET` | secret | OAuth PayPal | secret Sandbox | secret Live | coffre, jamais affiché |
| `PAYPAL_WEBHOOK_ID` | secret interne | vérification postback | ID endpoint Sandbox | ID endpoint Live dédié | coffre, jamais affiché |
| `APP_CANONICAL_URL` | public sûr/config serveur | callbacks et liens | origine HTTPS staging | `https://www.lnxbeats.fr` (si origine finale validée) | origine production |
| `AUTH_URL` / `SITE_URL` | public sûr/config serveur | cohérence d’origine | même origine staging | même origine production | origine production |
| `DATABASE_URL` | secret | PostgreSQL | base staging | base production | coffre Railway |

Aucun secret de paiement ne commence par `NEXT_PUBLIC_`. Les mêmes noms sont utilisés entre environnements ; Railway sépare leurs valeurs. Cela évite deux chemins de code et impose le contexte par `PAYMENT_DEPLOYMENT_ENV` et les validations de préfixe/mode.

## Stripe Live

Route : `POST https://www.lnxbeats.fr/api/payments/stripe/webhook` (adapter à l’origine canonique finalement validée).

Événements exactement consommés :

| Événement | Objet | Chemin code | Requis |
| --- | --- | --- | --- |
| `checkout.session.completed` | paiement immédiat | `webhook.ts` | oui |
| `checkout.session.async_payment_succeeded` | succès différé | `webhook.ts` | oui |
| `checkout.session.async_payment_failed` | échec différé | `webhook.ts` | oui |
| `checkout.session.expired` | expiration et retry sûr | `webhook.ts` | oui |
| `payment_intent.payment_failed` | refus carte immédiat | `webhook.ts` | oui |
| `refund.created` | découverte/suivi remboursement | `provider-financial-events.ts` | oui |
| `refund.updated` | état définitif remboursement | `provider-financial-events.ts` | oui |
| `refund.failed` | échec remboursement | `provider-financial-events.ts` | oui |
| `charge.dispute.created` | ouverture litige | `provider-financial-events.ts` | oui |
| `charge.dispute.updated` | évolution litige | `provider-financial-events.ts` | oui |
| `charge.dispute.closed` | clôture litige | `provider-financial-events.ts` | oui |
| `charge.dispute.funds_withdrawn` | fonds retirés | `provider-financial-events.ts` | oui |
| `charge.dispute.funds_reinstated` | fonds rétablis | `provider-financial-events.ts` | oui |

La route lit un body brut borné, vérifie la signature avec le secret de l’environnement, impose l’API Stripe du projet, compare `event.livemode`, le PaymentIntent développé, metadata, IDs, montant, devise et snapshot. Le replay est dédupliqué par l’identifiant provider persisté.

Plan Dashboard humain futur : ouvrir le contexte Live, créer une clé secrète ou restreinte Live adaptée, créer l’endpoint Live sur la route ci-dessus, sélectionner uniquement la table d’événements, récupérer son signing secret, vérifier l’API `2026-07-29.dahlia`, EUR, moyens de paiement et branding, puis placer les valeurs dans Railway Production. Ne rien copier vers staging et laisser `STRIPE_PAYMENTS_ENABLED=false` jusqu’au preflight.

## PayPal Live

Route : `POST https://www.lnxbeats.fr/api/payments/paypal/webhook` (adapter à l’origine canonique finalement validée).

Événements exactement consommés :

| Événement | Objet | Chemin code | Requis |
| --- | --- | --- | --- |
| `CHECKOUT.ORDER.APPROVED` | approbation acheteur | `paypal-webhook.ts` | oui |
| `PAYMENT.CAPTURE.PENDING` | capture différée | `paypal-webhook.ts` | oui |
| `PAYMENT.CAPTURE.COMPLETED` | confirmation paiement | `paypal-webhook.ts` | oui |
| `PAYMENT.CAPTURE.DECLINED` | refus capture | `paypal-webhook.ts` | oui |
| `PAYMENT.CAPTURE.REFUNDED` | remboursement confirmé | `provider-financial-events.ts` | oui |
| `PAYMENT.CAPTURE.REVERSED` | reversal capture | `provider-financial-events.ts` | oui |
| `PAYMENT.REFUND.PENDING` | remboursement différé | `provider-financial-events.ts` | oui |
| `PAYMENT.REFUND.FAILED` | échec remboursement | `provider-financial-events.ts` | oui |
| `CUSTOMER.DISPUTE.CREATED` | ouverture litige | `provider-financial-events.ts` | oui |
| `CUSTOMER.DISPUTE.UPDATED` | évolution litige | `provider-financial-events.ts` | oui |
| `CUSTOMER.DISPUTE.RESOLVED` | résolution litige | `provider-financial-events.ts` | oui |

Le serveur utilise exclusivement `api-m.sandbox.paypal.com`/`www.sandbox.paypal.com` en Sandbox et `api-m.paypal.com`/`www.paypal.com` en Live. Le webhook exige les headers PayPal bornés, un certificat sur le host correspondant, `SHA256withRSA`, puis le postback officiel avec le `PAYPAL_WEBHOOK_ID` du même environnement.

Plan Dashboard humain futur : créer/sélectionner l’application PayPal Live, relever son Client ID et son Client Secret Live, créer un webhook Live sur la route ci-dessus avec uniquement la table d’événements, puis placer son Webhook ID et les credentials dans Railway Production avec `PAYPAL_ENVIRONMENT=live`. Ne jamais mélanger Sandbox et Live et laisser `PAYPAL_PAYMENTS_ENABLED=false` jusqu’au preflight.

## Remboursements, incidents et Admin

Un remboursement Live est une vraie opération financière. L’Admin affiche `MODE LIVE — OPÉRATION FINANCIÈRE RÉELLE`, le montant serveur et une confirmation dédiée. Le repository refuse toute tentative dont `Payment.mode` diffère du runtime. Les remboursements restent idempotents, bornés au solde disponible et n’altèrent pas le statut métier de l’Order.

Les disputes, chargebacks et reversals créent ou mettent à jour un `PaymentIncident`, une piste `PaymentAuditEvent` et une alerte opérateur. Ils ne créent ni nouveau paiement, ni remboursement automatique, ni transition de l’Order. Ne jamais provoquer un litige bancaire réel pour la QA.

L’Admin peut afficher provider, mode, montant, remboursé, solde, état, références externes nécessaires, tentatives, incidents et audit. Aucun credential, signature, Authorization header, payload provider complet ou donnée carte ne doit apparaître dans les logs ou l’interface.

## Diagnostic et preflight read-only

`npm run payments:diagnostic` inspecte l’état courant sans contacter Stripe ou PayPal et sans écrire dans PostgreSQL. Il vérifie l’environnement explicite, les flags, les modes, la présence booléenne des credentials et secrets webhook, les trois origines HTTPS, l’accès PostgreSQL, les migrations, l’isolation Test/Live, EUR, les relations `Order`/`Payment`/`ProviderEvent` et les éléments `REQUIRES_REVIEW`. Sa sortie est allowlistée : aucune valeur de credential, URL de base, adresse ou confirmation n’est imprimée.

Résultats possibles :

- `SAFE_DISABLED` : le kill switch global et les flags providers sont inertes, même si des credentials Live complets ont été préchargés ;
- `CONFIGURED_DISABLED` : le global reste désactivé, mais un flag provider ou la confirmation production est déjà présent et doit être revu avant la suite ;
- `INVALID` : incohérence de configuration, runtime/origine, migration ou donnée nécessitant correction/revue.

Un provider désactivé peut être totalement absent. Le diagnostic exige `PAYMENTS_ENABLED=false`; il inspecte la préparation, il ne constitue pas une autorisation d’ouverture.

`npm run payments:preflight` ne contacte aucun provider et ne modifie aucune donnée. Il contrôle la configuration, l’environnement Railway, l’origine HTTPS, les flags, modes, présences de credentials, migrations, colonnes d’isolation, invariant gagnant et devise. Résultats possibles : `SAFE_DISABLED`, `READY_FOR_STRIPE_LIVE_QA`, `READY_FOR_PAYPAL_LIVE_QA`, `READY_FOR_DUAL_LIVE_QA`, `BLOCKED`.

La différence est intentionnelle : `payments:diagnostic` photographie l’état désactivé et ses anomalies ; `payments:preflight` est le gate de readiness après préparation explicite de l’activation.

## Limites et gates

- aucun compte Live, webhook Dashboard ou variable Railway n’est configuré par V0.8.0 ;
- aucun paiement ou remboursement Live n’est exécuté ;
- facturation/comptabilité et traitement fiscal restent un chantier séparé ;
- les modèles droits/contrats restent bloqués par la revue juridique ;
- les notifications production, le scheduler, les domaines et la QA production gardent leurs gates humains ;
- un smoke Live futur doit être unique, de faible montant métier valide, réservé à un compte autorisé et explicitement approuvé ;
- le remboursement ne doit pas devenir un mécanisme de test répétitif.

Voir aussi [PAYMENT_PRODUCTION_RUNBOOK.md](PAYMENT_PRODUCTION_RUNBOOK.md) et [PRODUCTION_GATES.md](PRODUCTION_GATES.md).
