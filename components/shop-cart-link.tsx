"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { useShopCart } from "@/components/shop-cart-provider";

export function ShopCartLink() {
  const { itemCount, ready } = useShopCart();
  const pathname = usePathname();
  if (!ready || itemCount === 0 || pathname.startsWith("/boutique/panier")) return null;
  return (
    <div aria-live="polite" className="shop-commerce-nav">
      <Link className="shop-cart-link" href="/boutique/panier">
        Panier <span aria-label={`${itemCount} article${itemCount > 1 ? "s" : ""}`}>{itemCount}</span>
      </Link>
    </div>
  );
}
