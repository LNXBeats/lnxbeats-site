# Checklist de revue humaine

Candidates finales à examiner sans modifier leurs empreintes :

- `legal-notices-2026-04-candidate` ;
- `music-cgv-2026-04-candidate` ;
- `shop-cgv-2026-05-candidate` ;
- `privacy-2026-04-candidate` ;
- `withdrawal-2026-03-candidate`.

Le rendu public masque les statuts et reason codes internes. L’approbation reste interdite tant que la revue professionnelle, sa référence, l’Admin approbateur et l’horodatage ne sont pas enregistrés. L’activation constitue une étape séparée.

## Juriste

- [ ] identité EI et usage des noms LNX Beats/LNX STUDIO ;
- [ ] qualification du contrat musique ;
- [ ] formation des contrats musique/Boutique ;
- [ ] commencement anticipé et cases séparées ;
- [ ] rétractation, exceptions et retours ;
- [ ] garanties légales et SAV ;
- [ ] CM2C et réclamation préalable ;
- [ ] droits de propriété intellectuelle et B2B ;
- [ ] libellé « commande avec obligation de paiement » ;
- [ ] durées probatoires et accusé durable.
- [ ] entités/adresses contractuelles Railway, Cloudflare et OVHcloud relues sur les contrats applicables ;
- [ ] mécanismes et lieux de transfert hors EEE vérifiés dans les DPA applicables ;
- [x] preuve distincte du commencement anticipé implémentée localement ; migration additive, case non précochée, snapshot serveur et gate paiement couverts par tests. Son déploiement reste soumis à cette revue.

## Expert-comptable

- [ ] régime TVA effectif et mentions ;
- [ ] prix HT/TTC ;
- [ ] facture, séquence et support ;
- [ ] conservation comptable et accès client.

## Logistique

- [ ] pays, préparation, livraison et retour ;
- [ ] poids facturable produits seuls ; emballage/protection physiques non facturés ;
- [ ] minimum commercial 250 g ; carton CD 60 g ; maximum 16 articles ;
- [ ] grille Colissimo versionnée ;
- [ ] suivi Colissimo manuel au lancement ; aucun statut transporteur simulé.

## Technique/QA

- [ ] aucun document candidat actif ;
- [ ] QA Phase 3 toujours Production-forbidden ;
- [ ] version/hash/date/utilisateur/commande persistés ;
- [ ] case CGV non précochée et version serveur ;
- [ ] rétractation sans login, sans motif, anti-IDOR et rate-limit ;
- [ ] accusé horodaté, hashé, imprimable et e-mail durable validé ;
- [ ] aucun remboursement automatique ;
- [ ] noindex/no-store des accusés privés ;
- [ ] responsive 320–1440, clavier, focus, labels et contraste ;
- [ ] suites complètes, PostgreSQL jetable, build/audits/secrets.
