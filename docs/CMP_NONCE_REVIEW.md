# CMP / nonce — revue ciblée du 5 octobre 2026

Base validée : `976b39723a21a7f56c704c3d95aec71e43bb5aef`.
Le lot ne modifie ni les contenus SEO/Merchant, ni les slots, ni les données,
ni les paiements, ni les migrations. Aucun script Google réel en Preview.

## Politique

`ADS_CSP_NONCE_ENABLED=true` est un opt-in indépendant de l'ouverture Ads.
Il ne fonctionne que sur `/`, `/boutique` et `/album/<slug>` dans une QA
explicitement isolée, ou sur le déploiement canonique Production. Ce lot
active uniquement la Preview. Ces pages étaient déjà dynamiques.

Le proxy génère 32 octets aléatoires cryptographiques, encodés en base64,
pour chaque réponse GET/HEAD éligible. Il supprime les en-têtes nonce/CSP
fournis par le client, transmet sa CSP à Next pour noncer les scripts du
framework, renvoie cette même CSP et interdit le cache du document.

Avant : `script-src 'self' 'unsafe-inline'` (eval seulement en développement).
Après opt-in : `script-src 'nonce-<aléatoire>' 'strict-dynamic'` et
`base-uri 'none'`. Aucun ajout d'unsafe-inline/eval, de wildcard ou d'origine
Google. Les autres directives, dont les origines R2 exactes, restent
inchangées. Le style inline préexistant n'est pas élargi. Les routes exclues
gardent la politique historique. L'upload audio conserve son exception au
proxy pour éviter le clonage/tronquage de son multipart.

Le bootstrap Google préparé réutilise seulement le nonce d'un script Next
du document courant, jamais celui d'une navigation RSC ultérieure. Sans
nonce valide il reste fermé. Le verrou `GOOGLE_CMP_RUNTIME_VERIFIED=false`
reste en place : publier la CMP ou changer un flag ne peut ouvrir les pubs.

## Preuves et limite

- 34 tests CSP/consentement/Ads/R2 et routage canonique du proxy, dont génération et unicité de 32 nonces,
  correspondance requête/réponse, absence de cache, spoofing d'en-têtes,
  exclusion POST/routes privées et signaux TCF simulés.
- Les tests TCF couvrent absence, refus, acceptation, retrait et callback
  tardif. Ce sont des doubles, pas une interaction avec la CMP Google.
- `scripts/verify-csp-preview.mjs` vérifie réellement HTTP, scripts Next,
  exclusions, absence de balise Google et contenu exact d'ads.txt. Il refuse
  une cible Production. Aucune donnée personnelle n'est collectée.
- Lint, typecheck et build Web requis ; aucun rebuild worker nécessaire,
  aucun code de worker modifié.
- Fixture navigateur locale utilisant cette même CSP : nonce valide exécuté ;
  script sans nonce, script avec mauvais nonce et handler inline bloqués.
- Preview : le panier répond 404 lorsque son interrupteur commerce déjà
  existant est fermé. Ce comportement est conservé, pas contourné pour la QA.

La compatibilité réelle des iframes/connexions internes Google n'est PAS
prouvée par une CSP qui ne charge pas Google. Aucune liste de domaines
supposée n'a été ajoutée pour dissimuler cette limite. Elle doit être
observée après publication, sans élargissement aveugle, avant de lever le
verrou de runtime. Les scénarios CMP et le CLS avec un vrai message restent
`PENDING_HUMAN_PUBLICATION`, même si le nonce et le rendu Next sont validés.

## Intervention humaine et reprise

AdSense → Confidentialité et messages → Réglementations européennes →
Messages → ligne « LNX Beats — consentement européen — revue 2026-10-05 » →
commutateur colonne **Publier** (`Publish message`, actuellement désactivé).
L'agent ne l'a pas actionné. Aucun examen du site ni validation de propriété.

La documentation Google exige un message publié pour le site testé : le
brouillon cible actuellement `lnxbeats.fr`, pas le domaine Railway Preview.
La cible de recette doit donc être associée à un message publié avant la
recette réelle ; publier uniquement lnxbeats.fr ne prouve pas la Preview.
Maintenir les annonces OFF et le verrou logiciel jusqu'à cette recette.

## Sources officielles consultées

- https://support.google.com/adsense/answer/16283098?hl=en-GB : prise en
  charge nonce/strict-dynamic ; sa recette comportant unsafe-eval n'est pas
  reprise automatiquement contre la consigne de sécurité de ce lot.
- https://nextjs.org/docs/app/guides/content-security-policy : extraction
  du nonce depuis la CSP de requête et rendu dynamique obligatoire.
- https://developers.google.com/funding-choices/fc-api-docs : message
  publié pour le domaine testé, `fc=alwaysshow&fctype=gdpr`, événements TCF
  et révocation. Ce paramètre n'est pas un moyen de servir un brouillon.
