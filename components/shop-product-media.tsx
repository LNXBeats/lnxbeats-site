"use client";

import Image from "next/image";
import { useState } from "react";

type ShopProductImage = {
  id: string;
  alt: string;
  width?: number | null;
  height?: number | null;
};

type ShopProductMediaProps = {
  image: ShopProductImage | null;
  productTitle: string;
  priority?: boolean;
  sizes: string;
};

export function ShopProductMedia({ image, productTitle, priority = false, sizes }: ShopProductMediaProps) {
  const source = image ? `/media/boutique/${image.id}` : null;
  const [failedSource, setFailedSource] = useState<string | null>(null);

  if (!image || !source || failedSource === source) {
    return (
      <span
        aria-label={`Visuel indisponible pour ${productTitle}`}
        className="shop-product-media shop-product-media--fallback"
        role="img"
      >
        <span className="shop-product-media__monogram" aria-hidden="true">LNX</span>
        <span className="shop-product-media__fallback-copy" aria-hidden="true">Visuel à venir</span>
      </span>
    );
  }

  return (
    <span className="shop-product-media">
      <Image
        alt={image.alt}
        height={image.height ?? 1200}
        onError={() => setFailedSource(source)}
        priority={priority}
        sizes={sizes}
        src={source}
        width={image.width ?? 1200}
      />
    </span>
  );
}
