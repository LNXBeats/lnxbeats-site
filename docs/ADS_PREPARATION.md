# Publicité : préparation fermée, revue obligatoire

Aucun réseau publicitaire n'est intégré ou chargé par ce candidat. `ADS_ENABLED=false` est l'état par défaut. Même `ADS_ENABLED=true` ne peut pas activer une annonce : le compte, le Publisher ID réel, la CMP Google certifiée/TCF et la revue humaine ne sont pas encore acquis.

## Deux types d'emplacement manuels

- `content` : à la fin du contenu d'une fiche album publique, après récit et titres, jamais entre titre et player.
- `footer` : accueil et Boutique, après les contenus principaux et DistroKid, avant le footer.

Un seul emplacement par page, donc au maximum un sur mobile. Aucune insertion globale dans le layout. Toutes les autres routes échouent fermées, notamment Commander, panier, fiches produit, checkout, soutien, connexion, compte, Admin, juridique et médias. Aucun espace vide en mode OFF. Le placeholder a sa taille réservée dès le HTML serveur, n'est ni cliquable ni assimilé à un produit.

## Revue locale/Preview uniquement

Flags serveur indépendants des paiements :

```dotenv
ADS_ENABLED=false
ADS_QA_PLACEHOLDERS=true
ADS_QA_ENVIRONMENT=staging
ADS_CONTENT_SLOT_ENABLED=true
ADS_FOOTER_SLOT_ENABLED=true
```

`SITE_URL` doit désigner un hostname Preview Railway (ou loopback en mode `local`). Tout contexte Production refuse le QA. En dehors de QA, tous ces flags restent absents/false.

`SEO_QA_LAB_METRICS=true` permet en QA seulement une mesure console bornée de 8 secondes : LCP, somme des layout shifts sans interaction et TTFB navigation. Aucun identifiant, aucun stockage, aucun appel réseau, pas de timer permanent. Les métriques non disponibles restent null ; INP reste NOT_MEASURED. Ce n'est ni le CWV terrain p75 ni une preuve de performance d'annonces réelles.

## ads.txt

Sans ligne officielle `ADSENSE_AUTHORIZED_SELLER_LINE`, `/ads.txt` retourne 404 vide. Avec une vraie ligne Google DIRECT validée, réponse 200 text/plain exacte. Aucun ID QA ou inventé dans l'environnement ni dans le fichier public. Les nombres des tests unitaires ne sont jamais une configuration.

## CMP et confidentialité : gate encore ouvert

Le site n'a actuellement ni traceur marketing ni CMP publicitaire. La politique existante reste exacte, donc aucune affirmation fictive d'intégration Google n'est ajoutée. Avant une future activation réelle : configurer le compte humain choisi, la CMP Google certifiée TCF (accepter/refuser/choix/retrait), intégrer et tester son cycle de consentement, mettre à jour les mentions applicables et faire approuver visuellement le rendu. Pas de faux bandeau artisanal ni de réutilisation du consentement fonctionnel.

Pour couper la revue QA, retirer `ADS_QA_PLACEHOLDERS` ou le passer à false et redéployer uniquement la Preview. L'architecture actuelle lit des variables au démarrage : aucun arrêt instantané sans redémarrage n'est promis. L'arrêt publicitaire futur devra conserver le retrait du consentement et ne toucher à aucun flag paiement/soutien.

## Merchant

Les quatre colonnes optionnelles ajoutées à Product servent uniquement aux faits Merchant (MPN, GTIN contrôlé, couleur, absence d'identifiant explicitement confirmée). Aucune valeur n'est inventée/backfillée. Les deux MPN officiels historiques restent stables. Les appels Admin historiques sans ces champs ne les effacent pas. Toute modification suit l'auth Admin, le verrou optimiste et l'audit existants.

La source reste `/merchant-center.xml`, exclusivement les produits internes publiés avec image publique. Les nouveautés éligibles apparaissent au prochain GET sans liste de slugs codée en dur. Les champs métier prix/stock restent la source unique. Un produit incomplet reste vendu dans la Boutique mais exclu du feed ; les brouillons, archives, services, DistroKid et cartes éditoriales ne sont jamais exportés. Google récupère la source existante quotidiennement ; un changement n'est pas promis instantané dans Merchant.

Migration `20261005010000_product_merchant_metadata` : additive, aucun effacement ni changement de données existantes. À appliquer à la Preview seulement dans ce lot. Le code précédent reste compatible avec les colonnes ajoutées pour un rollback applicatif ; ne pas effacer les attributs pour revenir en arrière.
