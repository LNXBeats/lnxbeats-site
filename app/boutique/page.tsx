import type { Metadata } from "next";
import { EditorialAdSlot } from "@/components/editorial-ad-slot";
import { Fragment } from "react";
import Link from "next/link";
import { UiIcon } from "@/components/ui-icon";

import { ButtonLink } from "@/components/button";
import { ShopAddButton } from "@/components/shop-add-button";
import { ShopExternalProductCard } from "@/components/shop-external-product-card";
import { ShopProductMedia } from "@/components/shop-product-media";
import { ShopSupportCard } from "@/components/shop-support-card";
import { Container } from "@/components/container";
import { siteConfig } from "@/data/site";
import { parseShopConfiguration } from "@/lib/shop/config";
import { formatShopMoney } from "@/lib/shop/order-presentation";
import { listPublicExternalProducts } from "@/lib/shop/external-product-service";
import { listPublicShopProducts } from "@/lib/shop/order-service";
import { createPublicPageMetadata } from "@/lib/seo/metadata";

export const dynamic = "force-dynamic";

export const metadata: Metadata = createPublicPageMetadata({
  title: "Boutique officielle",
  description: "Découvrez les CD, éditions physiques et objets LNX Beats actuellement publiés dans la Boutique officielle.",
  pathname: "/boutique",
});

const distroKidMerchShop = siteConfig.shops[0];

function DistroKidMerchSection({ soft = false }: { soft?: boolean }) {
  return (
    <section className={`section${soft ? " section--soft" : ""}`} aria-labelledby="distrokid-merch-title">
      <Container className="shop-grid shop-grid--single motion-reveal motion-reveal--soft">
        <article className="shop-card shop-card--merch">
          <span className="shop-card__index">PRODUITS DÉRIVÉS</span>
          <div className="shop-card__content">
            <h2 id="distrokid-merch-title">Boutique DistroKid</h2>
            <p>Mugs, vêtements et autres produits dérivés LNX Beats sont proposés dans cette boutique externe, distincte de la Boutique LNX.</p>
            <ButtonLink href={distroKidMerchShop.url} external>Découvrir les produits dérivés — DistroKid</ButtonLink>
          </div>
        </article>
      </Container>
    </section>
  );
}

function ShopTeaser() {
  return (
    <>
      <header className="page-hero page-hero--shop">
        <Container className="page-hero__grid">
          <div><p className="eyebrow">LNX Beats — au-delà du streaming</p><h1>La musique s’écoute.<br />Certaines histoires se gardent.</h1></div>
          <p className="page-hero__intro">Les morceaux vivent en streaming. Certains projets vont plus loin : éditions physiques, objets et créations LNX Beats seront à retrouver dans les espaces officiels lorsqu’ils seront réellement disponibles. Aucun achat n’est traité sur ce site.</p>
          <div className="page-hero__visual page-hero__visual--shop" aria-hidden="true"><span>Hors scène</span></div>
        </Container>
      </header>
      <DistroKidMerchSection />
      <section className="section section--soft">
        <Container className="content-columns motion-reveal">
          <p className="content-columns__label">Éditions futures</p>
          <div className="editorial-copy">
            <p>Certains univers pourront un jour prendre une forme physique.</p>
            <p>Albums sur CD, éditions limitées, objets collector ou prolongements visuels font partie des pistes à étudier. Rien n’est annoncé ni disponible ici pour le moment : aucun produit, stock, prix ou calendrier n’est confirmé.</p>
          </div>
        </Container>
      </section>
    </>
  );
}

function ShopEmptyState() {
  return (
    <div className="shop-commerce-shell">
      <header className="shop-commerce-hero" data-motion-scene="shop">
        <div className="shop-commerce-hero__backdrop" aria-hidden="true" data-motion-layer="media" />
        <Container className="shop-commerce-hero__inner">
          <p className="eyebrow">Boutique LNX Beats</p>
          <h1>La collection se prépare.</h1>
          <p>La Boutique est activée, mais aucun produit publié n’est disponible pour le moment.</p>
        </Container>
      </header>
      <section className="section">
        <Container>
          <div className="shop-cart-empty">
            <h2>Aucune édition disponible.</h2>
            <p>Revenez bientôt pour découvrir les prochaines éditions et créations LNX Beats.</p>
          </div>
        </Container>
      </section>
      <DistroKidMerchSection soft />
      <EditorialAdSlot pathname="/boutique" slot="footer" />
    </div>
  );
}

export default async function ShopPage() {
  let shopEnabled = false;
  try {
    shopEnabled = parseShopConfiguration().enabled;
  } catch {
    shopEnabled = false;
  }
  if (!shopEnabled) return <ShopTeaser />;

  const [products, externalProducts] = await Promise.all([listPublicShopProducts(), listPublicExternalProducts()]);
  if (!products.length && !externalProducts.length) return <ShopEmptyState />;
  const collection = [
    ...products.map((product) => ({ kind: "internal" as const, id: product.id, position: product.position, product })),
    ...externalProducts.map((product) => ({ kind: "external" as const, id: product.id, position: product.position, product })),
  ].sort((left, right) => left.position - right.position || left.kind.localeCompare(right.kind) || left.id.localeCompare(right.id));

  return (
    <div className="shop-commerce-shell">
      <header className="shop-commerce-hero" data-motion-scene="shop">
        <div className="shop-commerce-hero__backdrop" aria-hidden="true" data-motion-layer="media" />
        <Container className="shop-commerce-hero__inner">
          <p className="eyebrow">Boutique LNX Beats</p>
          <h1><span>Boutique</span> LNX Beats</h1>
          <p>Éditions physiques et objets officiels, préparés en quantité maîtrisée.</p>
        </Container>
      </header>
      <section className="section" aria-labelledby="shop-products-title">
        <Container>
          <div className="shop-commerce-heading">
            <div>
              <p className="eyebrow">Sélection disponible</p>
              <h2 id="shop-products-title">La collection.</h2>
            </div>
            <Link className="text-link" href="/boutique/panier">Voir le panier <span aria-hidden="true"><UiIcon name="arrow-right" /></span></Link>
          </div>
          <div className="shop-product-grid">
            {collection.map((item) => item.kind === "internal" ? (
              <Fragment key={`internal:${item.id}`}>
              <article className="shop-product-card" data-motion-tilt="shop-product">
                <Link className="shop-product-card__image" href={`/boutique/${encodeURIComponent(item.product.slug)}`}>
                  <ShopProductMedia
                    image={item.product.image}
                    productTitle={item.product.title}
                    sizes="(max-width: 429px) calc(100vw - 32px), (max-width: 900px) calc(50vw - 40px), (max-width: 1440px) calc(33vw - 48px), 340px"
                  />
                </Link>
                <div className="shop-product-card__body">
                  <p className="shop-product-card__status">
                    {item.product.availabilityState === "SOLD_OUT"
                      ? "Épuisé"
                      : item.product.availabilityState === "TEMPORARILY_UNAVAILABLE"
                        ? "Temporairement indisponible"
                        : "Disponible"}
                  </p>
                  <h3><Link href={`/boutique/${encodeURIComponent(item.product.slug)}`}>{item.product.title}</Link></h3>
                  <div className="shop-product-card__footer">
                    <strong>{formatShopMoney(item.product.priceCents)}</strong>
                    <div className="shop-product-card__actions">
                      <Link className="text-link" href={`/boutique/${encodeURIComponent(item.product.slug)}`}>Voir le produit</Link>
                      <ShopAddButton
                        disabled={item.product.soldOut}
                        maxQuantity={item.product.availableQuantity}
                        productId={item.product.id}
                        unavailableLabel={item.product.availabilityState === "TEMPORARILY_UNAVAILABLE" ? "Temporairement indisponible" : "Épuisé"}
                      />
                    </div>
                  </div>
                </div>
              </article>
              </Fragment>
            ) : <ShopExternalProductCard key={`external:${item.id}`} product={item.product} />)}
            <ShopSupportCard />
          </div>
          {externalProducts.length ? <p className="shop-external-product-disclosure">Pour les produits externes, prix et conditions définitifs affichés sur DistroKid.</p> : null}
        </Container>
      </section>
      <DistroKidMerchSection soft />
      <EditorialAdSlot pathname="/boutique" slot="footer" />
    </div>
  );
}
