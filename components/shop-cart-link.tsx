"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { useShopCart } from "@/components/shop-cart-provider";
import { useSiteLanguage } from "@/components/site-language";

export function ShopCartLink() {
  const { itemCount, ready } = useShopCart();
  const { t } = useSiteLanguage();
  const pathname = usePathname();
  const portalReady = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
  if (!portalReady || !ready || itemCount === 0 || pathname.startsWith("/boutique/panier")) return null;
  return createPortal(
    <div aria-live="polite" className="shop-commerce-nav">
      <Link className="shop-cart-link" href="/boutique/panier" aria-label={`${t("Panier Boutique")}, ${t(itemCount === 1 ? "{count} article" : "{count} articles", { count: itemCount })}`}>
        {t("Panier Boutique")} <span>{itemCount}</span>
      </Link>
    </div>,
    document.body,
  );
}
