import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ShopAddButton } from "@/components/shop-add-button";
import { Container } from "@/components/container";
import { formatShopMoney } from "@/lib/shop/order-presentation";
import { getPublicShopProduct } from "@/lib/shop/order-service";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Context): Promise<Metadata> {
  const { slug } = await params;
  const product = await getPublicShopProduct(slug);
  if (!product) return { title: "Produit indisponible", robots: { index: false, follow: false } };
  return {
    title: product.title,
    description: product.description.slice(0, 180),
    alternates: { canonical: `/boutique/${product.slug}` },
    openGraph: product.image ? { images: [{ url: `/media/boutique/${product.image.id}`, alt: product.image.alt }] } : undefined,
  };
}

export default async function ShopProductPage({ params }: Context) {
  const { slug } = await params;
  const product = await getPublicShopProduct(slug);
  if (!product) notFound();
  return (
    <div className="shop-commerce-shell shop-product-page">
      <Container>
        <Link className="text-link shop-back-link" href="/boutique"><span aria-hidden="true">←</span> Retour à la Boutique</Link>
        <article className="shop-product-detail">
          <div className="shop-product-detail__image">
            {product.image ? (
              <Image
                alt={product.image.alt}
                height={product.image.height ?? 1200}
                priority
                src={`/media/boutique/${product.image.id}`}
                width={product.image.width ?? 1200}
              />
            ) : null}
          </div>
          <div className="shop-product-detail__copy">
            <p className="eyebrow">Édition LNX Beats</p>
            <h1>{product.title}</h1>
            <p className="shop-product-detail__description">{product.description}</p>
            <strong className="shop-product-detail__price">{formatShopMoney(product.priceCents)}</strong>
            <p className="shop-product-detail__availability">
              {product.soldOut
                ? "Ce produit est actuellement épuisé."
                : product.availableQuantity === null
                  ? "Disponible."
                  : `${product.availableQuantity} exemplaire${product.availableQuantity > 1 ? "s" : ""} disponible${product.availableQuantity > 1 ? "s" : ""}.`}
            </p>
            {product.shippingRequired ? (
              <p className="shop-product-detail__shipping">
                Expédition calculée par le serveur selon le poids du panier et la grille QA active. Le montant exact est affiché avant la création de la commande.
              </p>
            ) : <p className="shop-product-detail__shipping">Aucun envoi postal requis.</p>}
            <ShopAddButton
              disabled={product.soldOut}
              maxQuantity={product.availableQuantity}
              productId={product.id}
              showQuantity
            />
            <p className="shop-product-detail__notice">Votre panier ne déclenche aucun paiement. Prix, poids, livraison et stock seront revérifiés par le serveur lors de la préparation de la commande.</p>
          </div>
        </article>
      </Container>
    </div>
  );
}
