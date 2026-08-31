"use client";

import { useState } from "react";

import { useShopCart } from "@/components/shop-cart-provider";

const MAX_QUANTITY = 20;

export function ShopAddButton({
  productId,
  disabled = false,
  unavailableLabel = "Épuisé",
  showQuantity = false,
  maxQuantity = null,
}: {
  productId: string;
  disabled?: boolean;
  unavailableLabel?: string;
  showQuantity?: boolean;
  maxQuantity?: number | null;
}) {
  const { add, lines, ready } = useShopCart();
  const [announcement, setAnnouncement] = useState("");
  const [quantity, setQuantity] = useState(1);
  const existingQuantity = ready
    ? lines.find((line) => line.productId === productId)?.quantity ?? 0
    : 0;
  const cartLimit = maxQuantity === null
    ? MAX_QUANTITY
    : Math.min(MAX_QUANTITY, Math.max(0, maxQuantity));
  const remainingQuantity = Math.max(0, cartLimit - existingQuantity);
  const selectedQuantity = Math.min(quantity, Math.max(1, remainingQuantity));
  const limitReached = remainingQuantity === 0;
  const buttonDisabled = disabled || limitReached;
  const button = (
    <>
      <button
        className="button button--primary shop-add-button"
        disabled={buttonDisabled}
        onClick={() => {
          add(productId, showQuantity ? selectedQuantity : 1);
          setAnnouncement(showQuantity && selectedQuantity > 1
            ? `${selectedQuantity} produits ajoutés au panier.`
            : "Produit ajouté au panier.");
        }}
        type="button"
      >
        {disabled ? unavailableLabel : limitReached ? "Maximum au panier" : "Ajouter au panier"}
      </button>
      <span className="sr-only" aria-live="polite">{announcement}</span>
    </>
  );

  if (!showQuantity) return button;
  return (
    <div className="shop-product-purchase">
      <label>
        <span>Quantité</span>
        <select
          disabled={buttonDisabled}
          onChange={(event) => setQuantity(Number(event.target.value))}
          value={selectedQuantity}
        >
          {Array.from({ length: Math.max(1, remainingQuantity) }, (_, index) => index + 1).map((value) => (
            <option key={value} value={value}>{value}</option>
          ))}
        </select>
      </label>
      {button}
    </div>
  );
}
