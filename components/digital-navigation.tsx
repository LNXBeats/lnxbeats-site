"use client";
import { T, useSiteLanguage } from "@/components/site-language";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import { DIGITAL_CART_KEY, readDigitalCart,writeDigitalCart } from "./digital-catalog";
import { floatingDigitalCartQuote, showFloatingDigitalCart } from "@/lib/digital/floating-cart-presentation";
import { UiIcon } from "./ui-icon";
import styles from "./digital-navigation.module.css";
import { digitalUiIsLive, type DigitalUiMode } from "./digital-mode-copy";

/** Digital selection only: never reads or mutates the physical shop cart. */
export function DigitalCartNavigation() {
  const { t, money, locale } = useSiteLanguage();
  const pathname = usePathname();
  const [count, setCount] = useState(0);
  const [checking, setChecking] = useState(false);
  const [needsReview, setNeedsReview] = useState(false);
  const [totalCents, setTotalCents] = useState<number | null>(null);
  const [added, setAdded] = useState(false);
  const portalReady = useSyncExternalStore(() => () => undefined, () => true, () => false);
  useEffect(() => {
    let current = 0, confirmed = "", previousCount = 0, timer: ReturnType<typeof setTimeout> | undefined, animationTimer: ReturnType<typeof setTimeout> | undefined, controller: AbortController | undefined;
    const update = () => {
      const ids = readDigitalCart(), key = JSON.stringify(ids), request = ++current;
      clearTimeout(timer); controller?.abort();
      setCount(ids.length); setNeedsReview(false);
      if (!ids.length) { confirmed = ""; setTotalCents(null); setChecking(false); return; }
      if (key === confirmed) { setChecking(false); return; }
      // A changed selection invalidates the cached identity AND amount together.
      // Returning A → A+B → A while A+B is pending must re-quote A, not keep a null total.
      confirmed = "";
      setTotalCents(null);
      setChecking(true);
      // Coalesce rapid additions; only the server decides album-covered membership.
      timer = setTimeout(async () => {
        controller = new AbortController();
        try {
          const response = await fetch("/api/digital/quote", { method: "POST", credentials: "same-origin", signal: controller.signal,
            headers: { "content-type": "application/json" }, body: JSON.stringify({ offerIds: ids }) });
          if (!response.ok) throw new Error("quote unavailable");
          const quoted = floatingDigitalCartQuote(await response.json(), ids);
          if (!quoted) throw new Error("quote invalid");
          if (request !== current || JSON.stringify(readDigitalCart()) !== key) return;
          confirmed = JSON.stringify(quoted.ids); setCount(quoted.ids.length); setTotalCents(quoted.totalCents); setChecking(false);
          if (confirmed !== key) writeDigitalCart(quoted.ids);
        } catch {
          if (request === current) { setChecking(false); setNeedsReview(true); }
        }
      }, 120);
    };
    const cartChanged = () => {
      const nextCount = readDigitalCart().length;
      if (nextCount > previousCount) {
        clearTimeout(animationTimer); setAdded(true);
        animationTimer = setTimeout(() => setAdded(false), 850);
      }
      previousCount = nextCount;
      update();
    };
    const storage = (event: StorageEvent) => { if (event.key === null || event.key === DIGITAL_CART_KEY) update(); };
    previousCount = readDigitalCart().length;
    update();
    window.addEventListener("dcn-cart", cartChanged);
    window.addEventListener("storage", storage);
    return () => { ++current; clearTimeout(timer); clearTimeout(animationTimer); controller?.abort(); window.removeEventListener("dcn-cart", cartChanged); window.removeEventListener("storage", storage); };
  }, []);
  const countLabel = t(count === 1 ? "{count} article" : "{count} articles", { count });
  const status = checking ? t("Vérification du panier…") : needsReview ? t("Sélection à vérifier") : countLabel;
  const floating = portalReady && showFloatingDigitalCart(pathname);
  return <><nav className={styles.nav} lang={locale === "zh" ? "zh-Hans" : locale} aria-label={t("Votre musique numérique")}>
    <Link href="/discographie"><T text="Discographie"/></Link>
    <Link href="/compte/musique"><T text="Ma musique"/></Link>
    <Link className={styles.cart} href="/musique/panier" aria-busy={checking} aria-label={`${t("Panier musique")}, ${status}`}><UiIcon name="bag" /><span><T text="Panier musique"/></span><span className={styles.count} aria-hidden="true">{countLabel}</span></Link>
    <span className="sr-only" role="status" aria-live="polite" aria-atomic="true">{added ? `${t("Ajouté au panier musique")}. ` : ""}{status}</span>
  </nav>{floating ? createPortal(
    <><div className={styles.floatingSpace} aria-hidden="true"/><aside className={`${styles.floating} ${added ? styles.justAdded : ""}`} lang={locale === "zh" ? "zh-Hans" : locale} data-digital-floating-cart data-cart-count={count}>
      <Link className={styles.floatingLink} href="/musique/panier" aria-busy={checking} aria-label={`${t("Voir mon panier")}, ${status}${totalCents !== null && !checking ? `, ${money(totalCents)}` : ""}`}>
        <span className={styles.floatingIcon}><UiIcon name="bag"/>{count > 0 ? <span className={styles.floatingBadge} aria-hidden="true">{count}</span> : null}</span>
        <span className={styles.floatingCopy}><strong>{t("Mon panier musique")}</strong><span>{count ? status : t("Choisissez vos titres")}</span></span>
        <span className={styles.floatingEnd}>{count > 0 && totalCents !== null && !checking ? <strong>{money(totalCents)}</strong> : <small>{t("Formats selon le titre")}</small>}<UiIcon name="arrow-right"/></span>
      </Link>
    </aside></>, document.body
  ) : null}</>;
}
export function DigitalDemoBanner({ mode = "TEST" }: { mode?: DigitalUiMode }) { return digitalUiIsLive(mode) ? null : <p className={styles.demo}><T text="Démonstration — aucun paiement réel"/> <span>· <T text="Prix fictifs"/></span></p>; }
/** Receives only server-confirmed, owner-scoped offers; no URL/status input grants rights. */
export function DigitalConfirmedCartCleanup({offerIds}:{offerIds:string[]}){
  useEffect(()=>{try{const previous=readDigitalCart(),next=previous.filter(id=>!offerIds.includes(id));if(next.length!==previous.length)writeDigitalCart(next);}catch{/* Unavailable browser storage must not hide a confirmed purchase. */}},[offerIds]);
  return null;
}
