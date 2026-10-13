"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { readDigitalCart } from "./digital-catalog";
import { UiIcon } from "./ui-icon";
import styles from "./digital-navigation.module.css";

/** Digital selection only: never reads or mutates the physical shop cart. */
export function DigitalCartNavigation() {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const update = () => setCount(readDigitalCart().length);
    update();
    window.addEventListener("dcn-cart", update);
    window.addEventListener("storage", update);
    return () => { window.removeEventListener("dcn-cart", update); window.removeEventListener("storage", update); };
  }, []);
  return <nav className={styles.nav} aria-label="Votre musique numérique">
    <Link href="/compte/musique">Ma musique</Link>
    <Link className={styles.cart} href="/musique/panier" aria-label={`Panier musique, ${count} sélection${count > 1 ? "s" : ""}`}><UiIcon name="bag" />Panier musique <span aria-hidden="true">{count}</span></Link>
  </nav>;
}
export function DigitalDemoBanner() { return <p className={styles.demo}>Démonstration — aucun paiement réel <span>· Prix fictifs</span></p>; }
