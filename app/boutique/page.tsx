import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";

import { ButtonLink } from "@/components/button";
import { ShopAddButton } from "@/components/shop-add-button";
import { Container } from "@/components/container";
import { siteConfig } from "@/data/site";
import { parseShopConfiguration } from "@/lib/shop/config";
import { formatShopMoney } from "@/lib/shop/order-presentation";
import { listPublicShopProducts } from "@/lib/shop/order-service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Boutique",
  description: "Les éditions et objets officiels de l’univers LNX Beats.",
  alternates: { canonical: "/boutique" },
};

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
      <section className="section">
        <Container className="shop-grid motion-reveal motion-reveal--soft">
          <article className="shop-card">
            <span className="shop-card__index">01 · MUSIQUE</span>
            <div className="shop-card__content">
              <h2>DistroKid Direct</h2>
              <p>Le lien mène vers l’espace musical officiel. Les disponibilités et les éventuels achats y sont gérés hors de ce site.</p>
              <ButtonLink href={siteConfig.shops[0].url} external>Ouvrir DistroKid Direct</ButtonLink>
            </div>
          </article>
          <article className="shop-card">
            <span className="shop-card__index">02 · CRÉATIONS</span>
            <div className="shop-card__content">
              <h2>Etsy</h2>
              <p>Le lien mène vers la page Etsy officielle de LNX Beats. Son contenu et ses disponibilités peuvent évoluer indépendamment de ce site.</p>
              <ButtonLink href={siteConfig.shops[1].url} external>Ouvrir la page Etsy</ButtonLink>
            </div>
          </article>
        </Container>
      </section>
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
      <header className="shop-commerce-hero">
        <Container>
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

  const products = await listPublicShopProducts();
  if (!products.length) return <ShopEmptyState />;

  return (
    <div className="shop-commerce-shell">
      <header className="shop-commerce-hero">
        <Container>
          <p className="eyebrow">Boutique LNX Beats</p>
          <h1>Des histoires à garder.</h1>
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
            <Link className="text-link" href="/boutique/panier">Voir le panier <span aria-hidden="true">→</span></Link>
          </div>
          <div className="shop-product-grid">
            {products.map((product) => (
              <article className="shop-product-card" key={product.id}>
                <Link className="shop-product-card__image" href={`/boutique/${encodeURIComponent(product.slug)}`}>
                  {product.image ? (
                    <Image
                      alt={product.image.alt}
                      height={product.image.height ?? 1200}
                      src={`/media/boutique/${product.image.id}`}
                      width={product.image.width ?? 1200}
                    />
                  ) : null}
                </Link>
                <div className="shop-product-card__body">
                  <p className="shop-product-card__status">
                    {product.availabilityState === "SOLD_OUT"
                      ? "Épuisé"
                      : product.availabilityState === "TEMPORARILY_UNAVAILABLE"
                        ? "Temporairement indisponible"
                        : "Disponible"}
                  </p>
                  <h3><Link href={`/boutique/${encodeURIComponent(product.slug)}`}>{product.title}</Link></h3>
                  <p>{product.description}</p>
                  <div className="shop-product-card__footer">
                    <strong>{formatShopMoney(product.priceCents)}</strong>
                    <div className="shop-product-card__actions">
                      <Link className="text-link" href={`/boutique/${encodeURIComponent(product.slug)}`}>Voir le produit</Link>
                      <ShopAddButton
                        disabled={product.soldOut}
                        maxQuantity={product.availableQuantity}
                        productId={product.id}
                        unavailableLabel={product.availabilityState === "TEMPORARILY_UNAVAILABLE" ? "Temporairement indisponible" : "Épuisé"}
                      />
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </Container>
      </section>
    </div>
  );
}
