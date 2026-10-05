# CMP / nonce — revue ciblée du 5 octobre 2026

## Reprise après publication humaine — runtime consentement seul

Cette section remplace les restrictions historiques de publication ci-dessous.
La publication humaine a été confirmée puis l'état « Publié » observé dans
AdSense. Le tag exact proposé par le compte dans « Confidentialité et
messages → Incitation à réautoriser les annonces → Ajout de tags » est
`https://fundingchoicesmessages.google.com/i/pub-2056594730161751?ers=1`.
Aucun message de récupération publicitaire n'a été créé ou publié.

Le verrou unique `GOOGLE_CMP_RUNTIME_VERIFIED=false` bloquait à la fois
la collecte de consentement et la diffusion. Il est remplacé par deux
décisions séparées :

- CMP : environnement `production`, `SITE_URL=https://www.lnxbeats.fr`,
  `ADS_CSP_NONCE_ENABLED=true`, `ADS_GOOGLE_CMP_ENABLED=true` et
  `ADS_GOOGLE_CMP_PUBLISHED=true`, sans mode placeholder QA ; nonce du
  document et origine canonique revérifiés dans le navigateur.
- Publicité : `GOOGLE_AD_SERVING_VERIFIED=false` demeure un verrou logiciel
  indépendant. `ADS_ENABLED=false` reste imposé pour cette release.
  Ni une publication CMP, ni une acceptation TCF, ni ses flags ne l'ouvrent.

Le bootstrap charge uniquement la messagerie Google, pas `adsbygoogle.js`.
Il conserve le mode script classique du tag Google (sans crossorigin : la
réponse du tag de messagerie ne fournit pas Access-Control-Allow-Origin).
Il utilise le nonce du document et le marqueur iframe caché fourni par
Google. La CSP conserve `script-src 'nonce-…' 'strict-dynamic'`, sans
unsafe-inline/eval dans cette directive. Seule l'origine exacte
`https://fundingchoicesmessages.google.com` est ajoutée à connect-src et
frame-src, uniquement sur une réponse noncée avec CMP configurée.
Le style inline historique n'est ni ajouté ni élargi. Un changement de
catégorie de route force un nouveau document pour ne pas conserver la CMP
sur une route exclue, y compris après navigation applicative.

La Preview n'est pas un domaine déclaré du message : aucun ajout de domaine,
spoofing ou PASS Google simulé. Les tests locaux couvrent le fail-closed,
la séparation CMP/Ads, les exclusions et la CSP ; la recette Google réelle
doit être effectuée après déploiement sur le domaine publié, annonces OFF.

Sources supplémentaires consultées le 05/10/2026 :
- https://support.google.com/adsense/answer/14325056?hl=en : le tag de
  messagerie peut servir le consentement sans créer de message anti-adblock.
- https://support.google.com/adsense/answer/11575177 : emplacement du tag.

## Historique du candidat précédent (avant publication)

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
