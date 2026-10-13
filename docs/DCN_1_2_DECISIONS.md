# DCN-1.2 — registre des décisions, sans approbation implicite

Date : 13 octobre 2026. Lecture avec `DCN_1_1_DECISIONS.md`, inclus intégralement dans le dossier. Les pages juridiques et règles des commerces historiques ne sont pas modifiées par ce registre.

## Ce qui est effectivement autorisé

| Décision | Origine traçable | Périmètre autorisé |
| --- | --- | --- |
| Continuer DCN dans la branche existante | Demande DCN-1.2 et fichier joint | Développement, données synthétiques, tests/captures/export et commits locaux uniquement. |
| Conserver les fichiers et compositions achetés | Cadrages DCN-1.0, 1.1 et 1.2 | Snapshot et versionnement technique obligatoires ; ne décide pas des droits commerciaux sur les futures éditions. |
| Pas de prix de lancement issu des maquettes | Instructions humaines répétées | Prix fictifs QA, vente LIVE fermée. |
| Protection provisoire anti-rachat redondant | DCN-1.1/1.2 | Conserver le refus, expliquer les titres concernés, permettre les autres pistes éligibles ; pas de remise automatique. |
| Préserver les autres domaines et les protections | DCN-1.2 | Pas de commande réelle, stock/prix physique, données client, services distants ou droits de publication modifiés. |
| Permettre l’édition Admin du catalogue QA | Autorisation humaine ciblée locale pendant DCN-1.2 | INSERT projets/pistes/project_assets et UPDATE des colonnes éditoriales dans le rôle runtime local exact ; aucune autorisation Production/global/DDL. |

## Propositions et questions encore ouvertes

| ID | Sujet | État actuel / décision non acquise | Effet technique conservé | Validation attendue |
| --- | --- | --- | --- | --- |
| D01 | Tarifs piste / album | NON VALIDÉ. Un prix album indépendant est permis ; il peut dépasser la somme des mêmes pistes. | Démo 12 pistes : prix principal 9,90 EUR ; somme unitaires 17,88 EUR ; avertissement vu temporairement à 19,99 EUR puis retour 9,90. Tout est fictif, aucun blocage arbitraire ni annonce d’économie mensongère. | Prix réels, périmètre de vente, taxes/pays, promotions éventuelles. Aucun initialiseur réel. |
| D02 | Panier numérique séparé | PROPOSÉ, pas une approbation utilisateur. | Panier distinct du physique et accès visible. | Confirmer la séparation et la continuité après connexion ; aucun panier mixte implicite. |
| D03 | Compte actif / email vérifié | PROTECTION LOCALE PROPOSÉE. | Vérification avant checkout et chaque accès privé. | Valider l’UX sans affaiblir le contrôle propriétaire ; récupération du compte et conservation. |
| D04 | Licence personnelle | PROPOSITION de texte 1.1, non active juridiquement. | Écoute/téléchargement ; pas de cession automatique. | Formulation, territoire, durée, appareils et limites légalement admises ; droits impératifs préservés. |
| D05 | Droits œuvre et master | Déclaration Admin auditée, pas preuve extérieure. | Droits confirmés nécessaires pour vente/extrait. | Chaîne de droits, collaborations, samples, distribution/gestion collective et autorisation d’extraits pour chaque contenu. |
| D06 | Futures versions et éditions | NON VALIDÉ. Conservation de l’ancien achat obligatoire. | Ancien master/ordre/contenu inchangé ; aucun bonus ou remaster automatique. | Qui reçoit une nouvelle édition, conditions de correctif légal, tarif et accès supplémentaire auditables. |
| D07 | Albums partiellement possédés | TEMPORAIRE. | Blocage listant les titres déjà acquis ; autres pistes achetables. | « Compléter l’album » : versions couvertes, prix déjà payés, promos, arrondis, remboursements, factures/avoirs. Aucun crédit/remise implicite. |
| D08 | Confirmation préalable / support durable | PROPOSÉ QA, pas preuve de remise juridiquement validée. | PDF privé exact, fin de stream observée, accusé explicite QA, puis fourniture. | Support durable, disponibilité, preuve et reprise ; envoyé/délivré/lu distincts. Paiement/URL/email capturé ne suffisent pas. |
| D09 | Parcours sans fourniture immédiate | FONCTIONNALITÉ MANQUANTE. | Checkout immédiat fermé si deux consentements distincts absents ; aucune renonciation inventée. | Parcours différé, délai, état de commande, fourniture et support avant ouverture. |
| D10 | CGV numériques | Textes locaux de revue, pas CGV acceptées pour LIVE. | Conditions versionnées QA et deux consentements non précochés. | CGV formelles numériques, acceptation dédiée, preuve/version, information précontractuelle et réclamations/médiation. |
| D11 | Fiscalité et pays | NON VALIDÉ. `LOCAL_REVIEW_ONLY`. | Pas de taux nul/exonération copiés du Soutien ou de Commander. | Localisation B2C/B2B, pays, TVA/OSS et déclaration applicables ; mentions et règles réelles validées. |
| D12 | Factures / avoirs / archivage | QA uniquement, numéros DCN-QA dédiés. | Snapshots/PDF immuables, crédit après restitution confirmée. | Mentions, série réelle, conservation, intégrité et accès ; pas de numéro historique consommé. |
| D13 | Réduction / résolution | PROPOSÉ QA. | Réduction conserve les droits ; résolution retire la source ciblée ; aucun effacement. | Motifs, droit consommateur, procédure opérateur, remboursement externe ambigu et information. |
| D14 | Litiges | PROPOSÉ QA. | Suspension ciblée et réversible, résolution favorable ne réactive pas un droit révoqué. | Délais/preuves/support ; pas de qualification automatique de fraude. Un fichier déjà conservé reste hors révocation. |
| D15 | Durée d’accès / archivage | NON VALIDÉ. | Versions acquises préservées dans la démo ; anciens masters non supprimés. | Durée d’hébergement, coûts, sauvegardes, fermeture de compte, conservation des justificatifs. Pas de promesse perpétuelle non budgétée. |
| D16 | Catalogue/grands albums et exploitation | Bornes techniques, pas limites commerciales approuvées. | 512 Mio/master, 30 min, ZIP <4 Gio/100 pistes, concurrence 2 audio/1 ZIP. | Volumes attendus, alertes/capacité, pagination et cadence de réconciliation ; aucun changement de forfait distant implicite. |
| D17 | Recettes externes | NON AUTORISÉES par DCN-1.2. | Préflight local et doubles uniquement ; flag spécifique fermé. | Une réponse groupée nommant comptes/application/buckets/hôte réseau et bornes du document d’autorisation. Jamais de clés dans le chat. |
| D18 | Nouveau visuel DCN-1.2 | PROPOSITION À REVOIR. | Captures réelles de la version locale, garde-fous conservés. | Revue visuelle globale par Ludovic ; anciennes validations V4/DCN ne valent pas accord sur ce lot. |

## Questions groupées pour Ludovic

1. Confirmer ou réviser les choix panier séparé / compte vérifié / licence personnelle / conservation et nouvelles éditions / album partiellement possédé.
2. Fixer ultérieurement les prix réels : aucun prix QA n’est une recommandation de lancement.
3. Faire valider les CGV, la preuve contractuelle et le différé, les pays/TVA et les documents numériques. Les réponses fiscales sur le Soutien ne s’appliquent pas automatiquement au téléchargement musical.
4. Autoriser séparément les cibles et bornes externes proposées dans `DCN_1_2_EXTERNAL_AUTHORIZATION.md` lorsqu’elles sont nommées.

Le traitement de ces décisions n’a pas empêché les travaux locaux indépendants. Le contrat de publication Commander/Rights et son tarif de 150 EUR restent distincts ; l’offre publique abandonnée à 1 500 EUR n’est pas réintroduite.

Le nouveau parcours de paiement **simulé local** est un outil de revue technique réservé à un acheteur QA et une cible loopback exacts ; il ne constitue ni recette Stripe TEST, ni approbation de vente réelle. La passerelle, son compte fictif et ses références identifiables ne sont pas copiables comme configuration de lancement.
