DCN — garde-budget et relais QA PayPal (préparation locale)

Ces outils ne constituent PAS une autorisation de recette. Aucun profil réel,
ledger d'autorisation, credential, événement ou donnée acquéreur n'est versionné.
L'étape actuelle n'exécute ni OAuth, ni appel PayPal, ni serveur, ni tunnel.

FONCTIONNEMENT
- Journal privé JSONL 0600, parent 0700, propriétaire courant, sans symlink.
- Autorisation initiale exclusive O_EXCL ; deadline et plafonds immuables.
- Chaque appel OAuth, GET, signature, REST ou delivery réserve une ligne chaînée
  puis fsync AVANT transport. Une erreur/timeout demeure consommée après crash.
- Verrou inter-processus ; journal tronqué ou verrou laissé par crash : STOP,
  revue humaine, jamais suppression/recréation automatique pour gagner du budget.
- Le relais reprend la deadline et les deliveries historiques, max 30. POST vers
  la seule route /api/digital/webhooks/paypal, octets/signatures inchangés, cible
  loopback 127.0.0.1:3140 ; aucun acquittement avant la réponse applicative.
- ngrok-free.dev / ngrok-free.app ne sont que des formes admissibles. Le host
  EXACT doit venir du scope réellement confirmé et de l'autorisation future.
- Fetch Sandbox exclusivement, redirect manuel, aucune pagination ni retry.
- Scope = application QA dédiée + empreinte de son identifiant REST public
  confirmé dans l'UI + marchand Sandbox + host exact. Basic utilise ce Client ID
  exact. L'app_id OAuth peut être générique ; ce n'est ni le Client ID, ni une
  preuve suffisante d'isolation. Il n'est corroboré comme attendu que s'il est
  réellement connu. Les scopes attendus doivent être confirmés, pas inventés.
- Création de webhook : URL exacte + événements exacts. Signature et suppression
  ciblent le seul ID QA bound. Après crash, restituer cet ID depuis la preuve
  sûre existante ; ne pas deviner ni supprimer un webhook Staging/Production.
  Minimum prévu : CAPTURE COMPLETED/PENDING/DECLINED/REFUNDED, REFUND PENDING/FAILED.
  Aucun All Events ni PAYMENT.REFUND.COMPLETED non documenté.
- Une paire OAuth+DELETE est réservée DANS les plafonds initiaux, jamais ajoutée.
  beginWebhookCleanup() ferme les nouvelles actions métier de ce fetch. Un seul
  OAuth de cleanup ; aucune relance automatique si son résultat est ambigu.
  GATE IMPÉRATIF avant beginWebhookCleanup() : fermer les nouveaux achats QA,
  puis arrêter/drainer TOUS les autres processus QA (app, workers, relais,
  runners) et vérifier l'absence de traitement engagé. Cette méthode n'est PAS
  un interrupteur global persistant. Ne pas redémarrer la recette après cleanup,
  même s'il reste des quotas ; deadline et plafonds d'origine ne changent jamais.

PRELOAD FUTUR (ne pas lancer sans autorisation de recette distincte)
Le fichier paypal-dcn-qa-preload.mjs doit être chargé AVANT toute importation
client/application dans chaque processus Node QA, y compris worker/child Next.
NODE_OPTIONS=--import=<chemin absolu du preload> peut assurer cette propagation.
Sans DCN_PAYPAL_QA_RECIPE_APPROVED=YES : fail-closed, aucun profil lu.
Avec autorisation : DCN_PAYPAL_QA_PRIVATE_BINDING désigne uniquement
  .private/dcn-paypal-qa-budget/<run>/binding.json
Le parent contient le ledger.jsonl EXISTANT. Aucun ledger n'est auto-initialisé.
Le binding privé doit contenir exactement : approval, scope, clientId,
expectedClientId, clientSecret, requiredScopes, webhookId, webhookEvents,
expectedOAuthAppId (null si inconnu). Les valeurs ne sont jamais imprimées.
Le runtime remplace global.fetch avant l'app, avec attestation dédiée ; Next peut
le wrapper pour le cache, mais les appels externes repassent par le garde-budget.
http/https/net/tls sans ticket sont refusés sauf loopback explicite aux ports
3140, 3142, 8443 et 55473. Cela préserve application/Auth/QA HTTPS/PostgreSQL.
Ce garde est process-local, pas un pare-feu OS : aucun CLI/provider/child process
non instrumenté ne doit être lancé comme voie de contournement.

Avant tout relais futur, serve exige l'autorisation explicite d'exposition ET de
recette, un ledger existant, le host exact et sa deadline d'origine. Il ne lance
aucun tunnel. Aucun de ces serve/recipe modes n'est exécuté dans l'étape locale.

TESTS SANS RÉSEAU NI LISTENER
node --test scripts/digital-paypal-qa/paypal-dcn-qa-budget.test.mjs scripts/digital-paypal-qa/paypal-dcn-qa-fetch.test.mjs scripts/digital-paypal-qa/paypal-dcn-qa-runtime.test.mjs scripts/digital-paypal-qa/paypal-route-only-relay-preparation.test.mjs
Les seules initialisations concernent des ledgers SYNTHÉTIQUES dans des dossiers
privés de test, supprimés de manière ciblée en fin de test. Aucun profil existant
ni acquisitions ne sont touchés. Les streams du relais sont injectés directement
dans son objet serveur non écoutant. Cela ne prouve PAS des webhooks authentiques.

RESTANT AVANT RECETTE RÉELLE
Confirmer app QA réelle / marchand / acheteur, URL exacte, scopes et opérations,
obtenir l'autorisation chiffrée de recette, préparer le binding sécurisé et le
ledger une seule fois, puis vérifier l'attestation dans CHAQUE processus QA.
Tester alors les scopes/token et webhooks authentiques sans LIVE. Aucun de ces
gates externes n'est déclaré PASS sur les tests doubles locaux.
