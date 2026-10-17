"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { DIGITAL_CART_KEY, readDigitalCart,writeDigitalCart } from "./digital-catalog";
import { digitalArticleCount, digitalQuotedCartIds } from "@/lib/digital/cart-presentation";
import { UiIcon } from "./ui-icon";
import styles from "./digital-navigation.module.css";
import { digitalUiIsLive, type DigitalUiMode } from "./digital-mode-copy";

/** Digital selection only: never reads or mutates the physical shop cart. */
export function DigitalCartNavigation() {
  const [count, setCount] = useState(0);
  const [checking, setChecking] = useState(false);
  const [needsReview, setNeedsReview] = useState(false);
  useEffect(() => {
    let current = 0, confirmed = "", timer: ReturnType<typeof setTimeout> | undefined, controller: AbortController | undefined;
    const update = () => {
      const ids = readDigitalCart(), key = JSON.stringify(ids), request = ++current;
      clearTimeout(timer); controller?.abort();
      setCount(ids.length); setNeedsReview(false);
      if (!ids.length || key === confirmed) { setChecking(false); return; }
      setChecking(true);
      // Coalesce rapid additions; only the server decides album-covered membership.
      timer = setTimeout(async () => {
        controller = new AbortController();
        try {
          const response = await fetch("/api/digital/quote", { method: "POST", credentials: "same-origin", signal: controller.signal,
            headers: { "content-type": "application/json" }, body: JSON.stringify({ offerIds: ids }) });
          if (!response.ok) throw new Error("quote unavailable");
          const quoted = digitalQuotedCartIds(await response.json(), ids);
          if (!quoted) throw new Error("quote invalid");
          if (request !== current || JSON.stringify(readDigitalCart()) !== key) return;
          confirmed = JSON.stringify(quoted); setCount(quoted.length); setChecking(false);
          if (confirmed !== key) writeDigitalCart(quoted);
        } catch {
          if (request === current) { setChecking(false); setNeedsReview(true); }
        }
      }, 120);
    };
    const storage = (event: StorageEvent) => { if (event.key === null || event.key === DIGITAL_CART_KEY) update(); };
    update();
    window.addEventListener("dcn-cart", update);
    window.addEventListener("storage", storage);
    return () => { ++current; clearTimeout(timer); controller?.abort(); window.removeEventListener("dcn-cart", update); window.removeEventListener("storage", storage); };
  }, []);
  const countLabel = digitalArticleCount(count);
  return <nav className={styles.nav} aria-label="Votre musique numérique">
    <Link href="/discographie">Discographie</Link>
    <Link href="/compte/musique">Ma musique</Link>
    <Link className={styles.cart} href="/musique/panier" aria-busy={checking} aria-label={`Panier musique, ${countLabel}${checking ? ", vérification en cours" : needsReview ? ", à vérifier" : ""}`}><UiIcon name="bag" /><span>Panier musique</span><span className={styles.count} aria-hidden="true">{countLabel}</span></Link>
    <span className="sr-only" role="status" aria-live="polite">{checking ? "Vérification du panier." : `${countLabel} dans le panier musique${needsReview ? ", sélection à vérifier" : ""}.`}</span>
  </nav>;
}
export function DigitalDemoBanner({ mode = "TEST" }: { mode?: DigitalUiMode }) { return digitalUiIsLive(mode) ? null : <p className={styles.demo}>Démonstration — aucun paiement réel <span>· Prix fictifs</span></p>; }
/** Receives only server-confirmed, owner-scoped offers; no URL/status input grants rights. */
export function DigitalConfirmedCartCleanup({offerIds}:{offerIds:string[]}){
  useEffect(()=>{try{const previous=readDigitalCart(),next=previous.filter(id=>!offerIds.includes(id));if(next.length!==previous.length)writeDigitalCart(next);}catch{/* Unavailable browser storage must not hide a confirmed purchase. */}},[offerIds]);
  return null;
}
