import type { ReactNode } from "react";

import { ShopCartLink } from "@/components/shop-cart-link";
import { ShopCartProvider } from "@/components/shop-cart-provider";
import { parseShopConfiguration } from "@/lib/shop/config";

import "./shop.css";

export default function ShopLayout({ children }: { children: ReactNode }) {
  let enabled = false;
  try {
    enabled = parseShopConfiguration().enabled;
  } catch {
    enabled = false;
  }
  if (!enabled) return children;
  return (
    <ShopCartProvider>
      <div className="shop-commerce-nav"><ShopCartLink /></div>
      {children}
    </ShopCartProvider>
  );
}
