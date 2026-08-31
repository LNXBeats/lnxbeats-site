"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { useShopCart } from "@/components/shop-cart-provider";

export function ShopCartLink() {
  const { itemCount, ready } = useShopCart();
  const pathname = usePathname();
  const portalReady = useSyncExternalStore(
    () => () => undefined,
    () => true,
    () => false,
  );
  if (!portalReady || !ready || itemCount === 0 || pathname.startsWith("/boutique/panier")) return null;
  return createPortal(
    <div aria-live="polite" className="shop-commerce-nav">
      <Link className="shop-cart-link" href="/boutique/panier">
        Panier <span aria-label={`${itemCount} article${itemCount > 1 ? "s" : ""}`}>{itemCount}</span>
      </Link>
    </div>,
    document.body,
  );
}
