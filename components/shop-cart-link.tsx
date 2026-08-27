"use client";

import Link from "next/link";

import { useShopCart } from "@/components/shop-cart-provider";

export function ShopCartLink() {
  const { itemCount, ready } = useShopCart();
  return (
    <Link className="shop-cart-link" href="/boutique/panier">
      Panier <span aria-label={`${ready ? itemCount : 0} article${itemCount > 1 ? "s" : ""}`}>{ready ? itemCount : 0}</span>
    </Link>
  );
}
