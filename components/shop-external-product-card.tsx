"use client";

import { ButtonLink } from "@/components/button";
import { ShopProductMedia } from "@/components/shop-product-media";
import { formatExternalProductPrice } from "@/lib/shop/external-product-domain";
import { T, useSiteLanguage } from "@/components/site-language";
import { OriginalName } from "@/components/original-name";
import { localeIntl } from "@/lib/i18n/config";

type ExternalProduct = {
  title: string;
  providerLabel: string;
  externalUrl: string;
  priceCents: number | null;
  currency: string;
  image: { id: string; alt: string | null; width: number | null; height: number | null } | null;
};

export function ShopExternalProductCard({ product }: { product: ExternalProduct }) {
  const { t, locale } = useSiteLanguage();
  return (
    <article className="shop-product-card shop-external-product-card" data-motion-tilt="shop-product">
      <a className="shop-product-card__image" href={product.externalUrl} target="_blank" rel="noopener noreferrer" aria-label={`${product.title} ${t("sur DistroKid — nouvel onglet")}`}>
        <ShopProductMedia
          image={product.image ? { ...product.image, alt: product.image.alt || product.title } : null}
          productTitle={product.title}
          sizes="(max-width: 429px) calc(100vw - 32px), (max-width: 900px) calc(50vw - 40px), (max-width: 1440px) calc(33vw - 48px), 340px"
        />
      </a>
      <div className="shop-product-card__body">
        <p className="shop-product-card__status">{product.providerLabel}</p>
        <h3><OriginalName>{product.title}</OriginalName></h3>
        <div className="shop-product-card__footer">
          <strong>{product.priceCents === null ? t(formatExternalProductPrice(null, product.currency)) : new Intl.NumberFormat(localeIntl(locale), { style: "currency", currency: product.currency }).format(product.priceCents / 100)}</strong>
          <div className="shop-product-card__actions">
            <ButtonLink href={product.externalUrl} external><T text="Acheter sur DistroKid" /></ButtonLink>
          </div>
        </div>
      </div>
    </article>
  );
}
