# Évaluation SMS — futur sprint V0.7.3.1

V0.7.3 ne choisit aucun fournisseur. `SMS_TRANSPORT` reste `disabled` ou `capture`, sans SDK ni numéro réel. Le message propriétaire cible resterait minimal : « Nouvelle commande LNX Beats — 90 € — Prioritaire — LNX-2026-000123 ».

| Critère | Brevo | OVHcloud SMS | Twilio |
| --- | --- | --- | --- |
| France transactionnel | API Transactional SMS documentée | Offre/API SMS française | Programmable Messaging + guide France |
| Suivi | événements/statistiques et webhooks transactionnels | accusés de réception et API REST | status callbacks `sent/delivered/failed/undelivered` |
| Sender | alphanumérique, limite documentée | expéditeur personnalisé ou numéro court selon compte | sender alphanumérique dynamique en France, contraintes opérateurs |
| Intégration | REST et SDK officiel | REST/API OVH, proximité avec l’écosystème OVH | SDK Node mature, Messaging Service optionnel |
| Coût | dépend du compte/crédits ; à revérifier lors du sprint | packs prépayés, 0,06 € HT/SMS France à 100 crédits au 21/08/2026 | tarification par destination/segment à relever au moment du choix |
| Verrouillage | modèle d’événements propre au provider | compte SMS/crédits OVH | SIDs, Messaging Services et callbacks Twilio |

Points de décision humaine : volume réel, consentement/opt-out, sender LNX Beats accepté, coût France, conservation des numéros, signature des callbacks, DPA/localisation et simplicité Railway. Aucun numéro propriétaire ne doit entrer dans Git ni les tests automatisés.

Sources officielles consultées le 21 août 2026 :

- Brevo : https://developers.brevo.com/docs/transactional-sms-endpoints et https://developers.brevo.com/docs/transactional-webhooks
- OVHcloud : https://help.ovhcloud.com/csm/fr-sms-sending-via-api-nodejs?id=kb_article_view&sysparm_article=KB0051367 et https://www.ovhcloud.com/fr/sms/prices/
- Twilio : https://www.twilio.com/docs/messaging/guides/outbound-message-status-in-status-callbacks et https://www.twilio.com/en-us/guidelines/fr/sms
