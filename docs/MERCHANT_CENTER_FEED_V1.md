# Flux Google Merchant Center V1

## Objet

Le candidat expose un flux RSS 2.0 XML à l’URL publique future :

`https://www.lnxbeats.fr/merchant-center.xml`

Il est généré à la demande depuis `listPublicShopProducts()`, la même lecture publique que la Boutique et le sitemap. Il ne possède aucun catalogue, prix, stock, slug, texte ou média codé en dur.

## Inclusion et source de vérité

Le lecteur public existant limite déjà les données aux produits `PUBLISHED` avec un prix et une image principale publique, cleared et exploitable. Le sérialiseur Merchant conserve uniquement les produits physiques (`shippingRequired=true`) compatibles avec le format Google.

- produit publié et disponible : `in_stock` ;
- produit publié mais épuisé ou temporairement indisponible à cause des réservations actives : `out_of_stock` ;
- produit DRAFT, ARCHIVED, masqué ou sans image publique : absent ;
- service, création musicale, licence Rights et produit sans expédition physique : absent ;
- merchandising DistroKid externe : absent, car il n’appartient pas au catalogue Boutique interne.

La quantité numérique, les réservations et les données de commande ne sont jamais sérialisées.

## Champs

Chaque article fournit `g:id`, `g:title`, `g:description`, `g:link`, `g:image_link`, `g:availability`, `g:price`, `g:condition`, `g:brand`, `g:mpn` et `g:shipping_weight`.

Les URL utilisent exclusivement `https://www.lnxbeats.fr`. Le prix vient de `priceCents`, avec deux décimales et la devise EUR du contrat Boutique. La marque vient de l’identité centrale du site. L’image est la première image publique déjà retenue par le catalogue.

## Poids d’expédition V1.1

`g:shipping_weight` vient exclusivement de `Product.shippingWeightGrams`, déjà exposé par la projection publique du catalogue. La valeur doit être un entier strictement positif ; sans poids fiable, le produit est exclu du flux. Il n’existe aucun poids par défaut ni déduction à partir du titre, du slug, de la catégorie, du MPN ou de l’UUID.

Les mesures produit validées sont actuellement :

- CD « J’ai adopté un humain » : poids produit et `g:shipping_weight` de `25 g` ;
- Badge LNX Beats : poids produit et `g:shipping_weight` de `10 g`.

Le packaging de `60 g` est ajouté une seule fois par commande par le checkout. Il n’est donc jamais ajouté au poids de chaque offre Merchant, ce qui éviterait un double comptage pour plusieurs unités ou un panier mixte. Le minimum facturable de `250 g` reste lui aussi une règle tarifaire du checkout et n’est pas appliqué au flux. Les tranches de livraison Merchant Center sont configurées séparément.

La couleur du badge n’est pas émise : aucune valeur métier n’a encore été validée humainement (`COLOR_ATTRIBUTE_HUMAN_DECISION_REQUIRED`). Aucune couleur n’est déduite de l’image.

## Identifiants produits

Les références fabricant suivantes sont officiellement attribuées par LNX Beats et constituent des identifiants stables :

- CD « J’ai adopté un humain » : `MPN = LNX-CD-JAI-ADOPTE-UN-HUMAIN`, aucun GTIN/EAN ;
- Badge LNX Beats : `MPN = LNX-BADGE-001`, aucun GTIN/EAN.

Ces MPN ne doivent plus être modifiés après leur utilisation dans Merchant Center, même si un titre marketing évolue. Le registre versionné est limité à la couche Merchant et associe la fiche publique stable à son MPN officiel. Il n’utilise ni UUID comme MPN, ni valeur aléatoire.

Tout futur produit doit recevoir une référence fabricant explicite avant son inclusion. Sans GTIN réel ni MPN enregistré dans ce registre, le sérialiseur l’exclut du flux : il ne fabrique jamais silencieusement un identifiant. Le flux n’émet plus `g:identifier_exists=no` pour les deux produits actuels, car chacun possède désormais `g:brand` et `g:mpn`.

Références Google :

- https://support.google.com/merchants/answer/14987622?hl=fr
- https://support.google.com/merchants/answer/6324478?hl=fr
- https://support.google.com/merchants/answer/160161?hl=fr

## HTTP, cache et sécurité

- méthode publique : GET, sans authentification ;
- `Content-Type: application/xml; charset=utf-8` ;
- `Cache-Control: no-store, max-age=0` ;
- `X-Robots-Tag: noindex` pour la recherche Web ;
- le chemin n’est pas ajouté au sitemap et n’est pas bloqué par `robots.txt` ;
- génération serveur depuis une liste fermée, sans paramètre utilisateur ;
- chaînes filtrées pour XML 1.0 puis échappées ;
- aucune DTD, entité externe ou entrée XML n’est parsée : une XXE est impossible dans ce générateur.

La livraison et les retours restent configurés séparément dans Merchant Center. Le flux ne duplique ni tarifs Colissimo, ni politiques contractuelles, ni règles de remboursement.

## Connexion future à Merchant Center

Après revue, commit, déploiement contrôlé et validation HTTP Production :

1. créer une source de données produit par URL dans Merchant Center ;
2. saisir `https://www.lnxbeats.fr/merchant-center.xml` ;
3. choisir la récupération quotidienne ;
4. configurer séparément la livraison France et la politique de retour à partir des règles réelles ;
5. examiner les diagnostics Google avant toute diffusion.

## Validation et rollback

Le flux se valide avec la suite `npm run test:merchant`, puis avec `xmllint` sur une sortie locale. Le rollback futur est uniquement applicatif : revenir au dernier commit Web stable retire la route. Aucun rollback de données, de schéma, de stock ou de configuration Google n’est requis.

## Limites V1

- France uniquement, conformément au lancement Boutique actuel ;
- aucune livraison ni politique de retour dans le XML ;
- aucun GTIN ; MPN officiels gérés dans le registre Merchant dédié ;
- tout futur produit sans MPN officiel est exclu jusqu’à attribution explicite ;
- aucune soumission automatique, aucun appel Content API et aucun IndexNow.
