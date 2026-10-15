# DCN — Revue des droits par version, 15 octobre 2026

## Périmètre livré localement

L’Admin peut enregistrer une revue explicite avant toute nouvelle mise en vente numérique : composition, master, interprètes/collaborateurs, samples/reprises éventuels, extrait et autorisation de vente/téléchargement personnel WAV/MP3 en **France métropolitaine, Corse comprise**. L’absence de plateforme externe ne dispense d’aucune autorisation. Il n’y a pas de vérification automatisée de documents juridiques, de reconnaissance de droits ou de nouvelle collecte KYC.

L’actuelle case `rightsConfirmed` ne suffit plus à ouvrir l’offre. Une preuve de revue par master doit également être valide. Les tarifs, la fiscalité, les contrats de vente et les flags de paiement restent des gates indépendants ; cette revue n’autorise ni LIVE ni un pays à elle seule.

## Journal et liaison exacte

Les décisions sont de **nouveaux** événements `DIGITAL_MASTER_RIGHTS_REVIEW` dans `DigitalEvent` : pas de table, migration, DDL ni modification des anciens événements. États : `DRAFT`, `REVIEW_REQUIRED`, `APPROVED`, `REJECTED`, `REVOKED`.

Chaque décision fige le master/track/version, les trois identités d’assets et leurs SHA‑256 (WAV privé, MP3 privé, extrait), le réviseur, l’horodatage, le statut et la référence de manifeste/preuve privée. `APPROVED` exige une référence opaque `private-evidence:…`, un SHA‑256 complet et l’attestation explicite d’examen. Le hash de l’enregistrement est un contrôle d’intégrité technique, **pas une signature juridique ni la preuve que le logiciel a lu les autorisations**.

Seul le **dernier** état est lu, jamais un ancien `APPROVED` en secours. Une décision inconnue, corrompue, liée à une autre édition/empreinte, sans preuve, ou enregistrée par un acteur qui n’est plus Admin actif à e-mail vérifié bloque les nouvelles ventes. Le rôle/état de l’Admin est relu en base, jamais accepté depuis le corps navigateur.

L’approbation nécessite l’édition courante ayant passé l’ingestion audio stricte ; les anciennes preuves d’encodeur ne sont pas maquillées en v2. Une édition stricte antérieure peut néanmoins être **révoquée/refusée après remplacement**, afin de bloquer une première livraison encore engagée sur cette version. Elle peut aussi conserver sa propre approbation valable pour ce checkout déjà figé : la nouvelle édition n’est jamais substituée.

## Administration, confidentialité et concurrence

- `/admin/musique/{slug}` : import → formulaire de revue des versions → offres. Jusqu’à 100 masters par lot, avec un manifeste privé commun possible et une liaison distincte par master. Les nouveaux fichiers ne deviennent pas automatiquement approuvés.
- `GET/POST /api/admin/digital/rights-reviews` : Admin authentifié, vérification fraîche, same-origin sur mutation, corps fermé et borné à 16 Kio, rate limiting, réponses `private, no-store`. Les réponses ne contiennent que master/statut/revue/date, sans référence privée, empreinte de preuve ni correspondance.
- L’Admin affiche les 50 dernières décisions du projet : date, version, statut enregistré et IDs opaques du réviseur/de la revue uniquement. Troncature signalée ; l’historique complet reste conservé dans le journal. État enregistré et approbation actuellement utilisable sont distingués.
- Clé d’idempotence, contrôle de la dernière revue attendue et verrous persistants triés par master, plus verrou de piste partagé avec l’ingestion pour empêcher un remplacement entre vérification et approbation. Tous les éléments du lot sont contrôlés avant la première écriture ; une transaction échouée n’approuve pas seulement une partie du lot. Les dates progressent d’au moins 1 ms sous verrou : deux décisions au même instant ne sont pas départagées arbitrairement par UUID.
- Aucun upload/publication de justificatif, secret ni document privé en réponse publique. L’archive privée doit réellement être conservée et examinée par l’Admin ; saisir sa référence n’accomplit pas cet examen.

## Garde avant nouvelles ventes et première livraison

`catalog.selections()` refuse les masters sans approbation liée ; un panier vide reste un panier vide. `saveOffer(active=true)` contrôle audio et revue **avant toute écriture d’offre, de droits ou d’audit**. La sauvegarde d’un brouillon inactif reste possible. La préparation de l’offre ne modifie plus les droits des versions historiques : seuls les masters courants strictement validés sont concernés par l’ancien workflow de droits des médias.

L’intégration de première délivrance utilise le marqueur versionné `DCN_MASTER_RIGHTS_REVIEW_V1_FR_METROPOLITAN` sur les **nouveaux** snapshots contractuels et revérifie les masters figés. Un marqueur inconnu reste bloqué ; un ancien snapshot sans marqueur conserve sa compatibilité. Les téléchargements historiques déjà acquis ne reçoivent pas ce nouveau formulaire ni une révocation rétroactive implicite. Une véritable suspension légale d’acquisition existante relève d’un traitement d’incident explicite distinct.

Les ACL existantes `digital_events: SELECT/INSERT`, sans `UPDATE/DELETE`, sont réutilisées ; aucun privilège global ni provisionnement modifié. Les preuves de rôle non propriétaire de consolidation restent applicables aux mêmes privilèges. Ce lot ne revendique pas un nouveau test PostgreSQL réel de ces nouveaux événements.

## Contrôles réellement exécutés

```sh
NODE_OPTIONS=--conditions=react-server node --import tsx --test tests/digital/rights-review.test.ts tests/digital/real-album-admin.test.ts
npx eslint lib/digital/rights-review-policy.ts lib/digital/rights-review-service.ts components/digital-rights-review.tsx app/api/admin/digital/rights-reviews/route.ts 'app/admin/musique/[slug]/page.tsx' lib/digital/catalog.ts tests/digital/rights-review.test.ts tests/digital/real-album-admin.test.ts
npm run typecheck
git diff --check
```

**17 tests PASS** : 11 droits et 6 Admin, doubles de dépôts/métadonnées uniquement, aucun document juridique réellement validé ni nouvelle ingestion audio. Couverture : absence/preuve exacte, flags insuffisants, états successifs et révocation même tick, Admin frais, entrées fermées, rejet de référence publique, idempotence et décision concurrente périmée, lot 12 masters, projection de l’historique, édition remplacée, ancienne preuve d’encodeur, hash/attestation corrompus, panier vide et exclusion des re-téléchargements historiques. Lint ciblé et diff-check PASS. Typecheck standard PASS après relance autorisée pour écrire le cache local (premier essai bloqué `EPERM` sur ce seul cache).

Les contrôles d’intégration checkout/première fourniture supplémentaires sont consignés par le lot racine, sans addition artificielle aux 17 ci-dessus. Aucune nouvelle recette prestataire, preuve navigateur physique, mutation DB historique, offre réelle, paiement, e-mail, push ou déploiement effectué par ce sous-lot. **Interface et mécanisme locaux livrés ; documents et autorisations des vrais albums encore à examiner humainement. Pas prêt Production.**
