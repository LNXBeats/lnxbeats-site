import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ShopCart } from "@/components/shop-cart";
import { Container } from "@/components/container";
import { getAuthSession } from "@/lib/auth/session";
import { parseShopConfiguration } from "@/lib/shop/config";
import { listPublicShopProducts } from "@/lib/shop/order-service";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Panier Boutique",
  robots: { index: false, follow: false },
};

export default async function ShopCartPage() {
  let configuration;
  try {
    configuration = parseShopConfiguration();
  } catch {
    notFound();
  }
  if (!configuration.enabled) notFound();
  const [products, session] = await Promise.all([listPublicShopProducts(), getAuthSession()]);
  return (
    <div className="shop-commerce-shell shop-cart-page">
      <Container>
        <Link className="text-link shop-back-link" href="/boutique"><span aria-hidden="true">←</span> Continuer mes achats</Link>
        <header className="shop-cart-page__heading">
          <p className="eyebrow">Boutique LNX Beats</p>
          <h1>Votre panier.</h1>
          <p>Vérifiez votre sélection, votre livraison et le total avant de préparer la commande.</p>
        </header>
        <ShopCart
          allowedCountries={configuration.allowedCountries}
          authenticated={Boolean(session)}
          memberAllowed={session?.user.role === "MEMBER" || session?.user.role === "CUSTOMER"}
          purchasesEnabled={process.env.SHOP_PAYMENTS_ENABLED === "true"}
          products={products}
        />
      </Container>
    </div>
  );
}
