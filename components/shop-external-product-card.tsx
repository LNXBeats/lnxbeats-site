import { ButtonLink } from "@/components/button";
import { ShopProductMedia } from "@/components/shop-product-media";
import { formatExternalProductPrice } from "@/lib/shop/external-product-domain";

type ExternalProduct = {
  title: string;
  providerLabel: string;
  externalUrl: string;
  priceCents: number | null;
  currency: string;
  image: { id: string; alt: string | null; width: number | null; height: number | null } | null;
};

export function ShopExternalProductCard({ product }: { product: ExternalProduct }) {
  return (
    <article className="shop-product-card shop-external-product-card" data-motion-tilt="shop-product">
      <a className="shop-product-card__image" href={product.externalUrl} target="_blank" rel="noopener noreferrer" aria-label={`${product.title} sur DistroKid — nouvel onglet`}>
        <ShopProductMedia
          image={product.image ? { ...product.image, alt: product.image.alt || product.title } : null}
          productTitle={product.title}
          sizes="(max-width: 429px) calc(100vw - 32px), (max-width: 900px) calc(50vw - 40px), (max-width: 1440px) calc(33vw - 48px), 340px"
        />
      </a>
      <div className="shop-product-card__body">
        <p className="shop-product-card__status">{product.providerLabel}</p>
        <h3>{product.title}</h3>
        <div className="shop-product-card__footer">
          <strong>{formatExternalProductPrice(product.priceCents, product.currency)}</strong>
          <div className="shop-product-card__actions">
            <ButtonLink href={product.externalUrl} external>Acheter sur DistroKid</ButtonLink>
          </div>
        </div>
      </div>
    </article>
  );
}
