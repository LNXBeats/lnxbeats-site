"use client";

import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";

import { useShopCart } from "@/components/shop-cart-provider";
import { formatShopMoney } from "@/lib/shop/order-presentation";

type CartProduct = Readonly<{
  id: string;
  slug: string;
  title: string;
  priceCents: number;
  shippingRequired: boolean;
  shippingPriceCents: number;
  lockVersion: number;
  availableQuantity: number | null;
  soldOut: boolean;
  image: Readonly<{
    id: string;
    alt: string;
    width: number | null;
    height: number | null;
  }> | null;
}>;

type CreatedOrder = Readonly<{ orderNumber: string }>;

const IDEMPOTENCY_STORAGE_KEY = "lnx-shop-order-idempotency-v1";

function messageFromResponse(body: unknown) {
  if (body && typeof body === "object" && "message" in body && typeof body.message === "string") {
    return body.message;
  }
  return "La commande Boutique n’a pas pu être préparée.";
}

export function ShopCart({
  products,
  allowedCountries,
  authenticated,
  memberAllowed,
}: {
  products: readonly CartProduct[];
  allowedCountries: readonly string[];
  authenticated: boolean;
  memberAllowed: boolean;
}) {
  const router = useRouter();
  const { lines, ready, setQuantity, remove, clear } = useShopCart();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [changedProductId, setChangedProductId] = useState<string | null>(null);
  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);
  const cartLines = lines.map((line) => ({ ...line, product: productById.get(line.productId) ?? null }));
  const knownLines = cartLines.filter((line): line is typeof line & { product: CartProduct } => line.product !== null);
  const shippingRequired = knownLines.some(({ product }) => product.shippingRequired);
  const invalid = cartLines.some(({ product, quantity }) => (
    !product
    || product.soldOut
    || (product.availableQuantity !== null && quantity > product.availableQuantity)
  ));
  const subtotalCents = knownLines.reduce((sum, { product, quantity }) => sum + product.priceCents * quantity, 0);
  const shippingCents = knownLines.reduce((sum, { product, quantity }) => (
    sum + (product.shippingRequired ? product.shippingPriceCents * quantity : 0)
  ), 0);

  function resetIdempotency() {
    window.sessionStorage.removeItem(IDEMPOTENCY_STORAGE_KEY);
    setError("");
    setChangedProductId(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!authenticated) {
      router.push("/connexion?retour=%2Fboutique%2Fpanier");
      return;
    }
    if (!memberAllowed) {
      setError("Connectez-vous avec un profil membre pour préparer un achat Boutique.");
      return;
    }
    if (!lines.length || invalid || busy) return;

    const form = new FormData(event.currentTarget);
    const shippingAddress = shippingRequired ? {
      firstName: String(form.get("firstName") ?? ""),
      lastName: String(form.get("lastName") ?? ""),
      addressLine1: String(form.get("addressLine1") ?? ""),
      addressLine2: String(form.get("addressLine2") ?? ""),
      postalCode: String(form.get("postalCode") ?? ""),
      city: String(form.get("city") ?? ""),
      countryCode: String(form.get("countryCode") ?? ""),
    } : null;
    let idempotencyKey = window.sessionStorage.getItem(IDEMPOTENCY_STORAGE_KEY);
    if (!idempotencyKey) {
      idempotencyKey = crypto.randomUUID();
      window.sessionStorage.setItem(IDEMPOTENCY_STORAGE_KEY, idempotencyKey);
    }

    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/shop/orders", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json", "Idempotency-Key": idempotencyKey },
        body: JSON.stringify({
          items: lines.map(({ productId, quantity }) => ({
            productId,
            quantity,
            observedLockVersion: productById.get(productId)?.lockVersion,
          })),
          shippingAddress,
        }),
      });
      const body = await response.json() as {
        order?: CreatedOrder;
        message?: string;
        code?: string;
        productId?: string;
      };
      if (!response.ok || !body.order) {
        if (body.code === "IDEMPOTENCY_CONFLICT") window.sessionStorage.removeItem(IDEMPOTENCY_STORAGE_KEY);
        if ((body.code === "PRODUCT_CHANGED" || body.code === "OUT_OF_STOCK" || body.code === "PRODUCT_UNAVAILABLE") && body.productId) {
          setChangedProductId(body.productId);
          router.refresh();
        }
        if (response.status === 401) {
          router.push("/connexion?retour=%2Fboutique%2Fpanier");
          return;
        }
        setError(messageFromResponse(body));
        return;
      }
      window.sessionStorage.removeItem(IDEMPOTENCY_STORAGE_KEY);
      clear();
      router.push(`/compte/achats/${encodeURIComponent(body.order.orderNumber)}`);
    } catch {
      setError("La réponse du serveur n’a pas été reçue. Réessayez : la même clé empêchera tout doublon.");
    } finally {
      setBusy(false);
    }
  }

  if (!ready) return <p className="shop-cart-loading">Chargement du panier…</p>;
  if (!lines.length) {
    return (
      <div className="shop-cart-empty">
        <h2>Votre panier est vide.</h2>
        <p>Parcourez les éditions LNX Beats disponibles.</p>
        <Link className="button button--primary" href="/boutique">Retour à la Boutique</Link>
      </div>
    );
  }

  return (
    <form className="shop-cart" onChange={resetIdempotency} onSubmit={submit}>
      <div className="shop-cart__content">
        <section className="shop-cart__lines" aria-labelledby="shop-cart-lines-title">
          <h2 id="shop-cart-lines-title">Votre sélection</h2>
          <ul>
            {cartLines.map(({ productId, quantity, product }) => (
              <li className={changedProductId === productId ? "shop-cart__line--changed" : undefined} key={productId}>
                <div className="shop-cart__product">
                  {product?.image ? (
                    <Link aria-label={`Voir ${product.title}`} href={`/boutique/${encodeURIComponent(product.slug)}`}>
                      <Image
                        alt={product.image.alt}
                        height={product.image.height ?? 160}
                        src={`/media/boutique/${product.image.id}`}
                        width={product.image.width ?? 160}
                      />
                    </Link>
                  ) : null}
                  <div>
                    <strong>{product?.title ?? "Produit indisponible"}</strong>
                    <small>{product ? formatShopMoney(product.priceCents) : "Retirez cette ligne pour continuer."}</small>
                    {product?.soldOut ? <em>Épuisé</em> : null}
                    {product?.availableQuantity !== null && product && quantity > product.availableQuantity
                      ? <em>Quantité disponible : {product.availableQuantity}</em>
                      : null}
                    {changedProductId === productId
                      ? <em>Prix ou disponibilité modifié : vérifiez cette ligne.</em>
                      : null}
                  </div>
                </div>
                <label>
                  <span>Quantité</span>
                  <input
                    aria-label={`Quantité pour ${product?.title ?? "le produit indisponible"}`}
                    disabled={!product}
                    max={Math.min(20, product?.availableQuantity ?? 20)}
                    min="1"
                    onChange={(event) => setQuantity(productId, Number(event.target.value))}
                    type="number"
                    value={quantity}
                  />
                </label>
                <strong>{product ? formatShopMoney(product.priceCents * quantity) : "—"}</strong>
                <button className="text-link" onClick={() => remove(productId)} type="button">Retirer</button>
              </li>
            ))}
          </ul>
        </section>

        {shippingRequired && authenticated && memberAllowed ? (
          <fieldset className="shop-cart__address">
            <legend>Adresse de livraison</legend>
            <p>Elle est transmise au serveur uniquement lorsque vous préparez la commande et n’est jamais enregistrée dans le panier local.</p>
            <div className="shop-cart__field-grid">
              <label><span>Prénom</span><input autoComplete="given-name" maxLength={100} name="firstName" required /></label>
              <label><span>Nom</span><input autoComplete="family-name" maxLength={100} name="lastName" required /></label>
              <label className="shop-cart__field-wide"><span>Adresse</span><input autoComplete="address-line1" maxLength={240} name="addressLine1" required /></label>
              <label className="shop-cart__field-wide"><span>Complément <small>(facultatif)</small></span><input autoComplete="address-line2" maxLength={240} name="addressLine2" /></label>
              <label><span>Code postal</span><input autoComplete="postal-code" maxLength={32} name="postalCode" required /></label>
              <label><span>Ville</span><input autoComplete="address-level2" maxLength={120} name="city" required /></label>
              <label className="shop-cart__field-wide"><span>Pays</span><select autoComplete="country" name="countryCode" required>{allowedCountries.map((country) => <option key={country} value={country}>{country}</option>)}</select></label>
            </div>
          </fieldset>
        ) : null}
      </div>

      <aside className="shop-cart__summary" aria-labelledby="shop-cart-summary-title">
        <p className="eyebrow">Récapitulatif</p>
        <h2 id="shop-cart-summary-title">Commande Boutique</h2>
        <dl>
          <div><dt>Sous-total</dt><dd>{formatShopMoney(subtotalCents)}</dd></div>
          <div><dt>Expédition</dt><dd>{formatShopMoney(shippingCents)}</dd></div>
          <div className="shop-cart__total"><dt>Total</dt><dd>{formatShopMoney(subtotalCents + shippingCents)}</dd></div>
        </dl>
        <p>Aucun paiement ne sera créé. Le serveur revérifie prix, disponibilité et frais d’envoi avant de réserver le stock.</p>
        {error ? <p className="shop-cart__error" role="alert">{error}</p> : null}
        {authenticated ? (
          <button
            className="button button--primary"
            disabled={busy || invalid}
            formNoValidate={!memberAllowed}
            type="submit"
          >
            {busy ? "Préparation…" : "Préparer ma commande"}
          </button>
        ) : (
          <Link className="button button--primary" href="/connexion?retour=%2Fboutique%2Fpanier">
            Se connecter pour continuer
          </Link>
        )}
      </aside>
    </form>
  );
}
