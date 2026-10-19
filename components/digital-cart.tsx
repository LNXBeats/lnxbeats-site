"use client";
import { T, useSiteLanguage } from "@/components/site-language";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { readDigitalCart, writeDigitalCart, type DigitalCompletionView } from "./digital-catalog";
import { DigitalRequestError } from "@/lib/digital/request-error";
import styles from "./digital.module.css";
import { digitalUiIsLive, type DigitalUiMode } from "./digital-mode-copy";
import { digitalFormatsLabel } from "@/lib/digital/format-presentation";
import type { DigitalAudioFormat } from "@/lib/digital/formats";

type Quote = { totalCents: number; removed: string[]; lines: Array<{ id: string; title: string; scope: string; priceCents: number; trackCount: number; version: number; formats?: readonly DigitalAudioFormat[]; completion?: DigitalCompletionView | null }> };
export async function digitalRequest(path: string, body?: unknown) {
  const r = await fetch(path, { method: body === undefined ? "GET" : "POST", credentials: "same-origin", headers: body === undefined ? {} : { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const v = await r.json();
  if (!r.ok) throw new DigitalRequestError(typeof v?.error === "string" ? v.error : "Action indisponible.", r.status, typeof v?.code === "string" ? v.code : null);
  return v;
}

export function DigitalCart({ mode = "TEST" }: { mode?: DigitalUiMode }) {
  const { t, money } = useSiteLanguage();
  const [value, setValue] = useState<Quote | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [updating, setUpdating] = useState(true), [notice, setNotice] = useState("");
  const serial = useRef({ value: 0 });
  const router = useRouter();
  const refresh = useCallback(async () => {
    const n = ++serial.current.value, ids = readDigitalCart();
    setUpdating(true);
    try {
      const q = await digitalRequest("/api/digital/quote", { offerIds: ids }) as Quote;
      if (n !== serial.current.value || JSON.stringify(readDigitalCart()) !== JSON.stringify(ids)) return;
      setValue(q); setError("");
      if (q.removed.length) {
        setNotice("Les titres inclus dans l’album ont été retirés : ils ne seront pas facturés deux fois.");
        writeDigitalCart(q.lines.map(l => l.id));
      }
    } catch (e) {
      if (n === serial.current.value) { setError(e instanceof Error ? e.message : "Panier indisponible."); setValue(null); }
    } finally { if (n === serial.current.value) setUpdating(false); }
  }, []);
  useEffect(() => {
    const requests = serial.current;
    const initial = setTimeout(() => void refresh(), 0);
    const update = () => void refresh();
    window.addEventListener("storage", update); window.addEventListener("dcn-cart", update);
    return () => { clearTimeout(initial); ++requests.value; window.removeEventListener("storage", update); window.removeEventListener("dcn-cart", update); };
  }, [refresh]);

  function remove(id: string, title: string) {
    try { writeDigitalCart(readDigitalCart().filter(item => item !== id)); setNotice(t("{title} a été retiré du panier.", { title })); }
    catch { setError("Le navigateur n’a pas pu modifier le panier. Réessayez."); }
  }
  async function continueCheckout() {
    setBusy(true);
    try {
      const response = await fetch("/api/digital/cart", { credentials: "same-origin" });
      if (response.status === 401) { router.push("/connexion?retour=%2Fmusique%2Fpanier"); return; }
      if (!response.ok) throw new Error("Votre panier nécessite une vérification.");
      const cart = await response.json();
      await digitalRequest("/api/digital/cart", { offerIds: readDigitalCart(), revision: cart.revision });
      // A new document receives the checkout-scoped CSP nonce used by PayPal.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- full navigation is required to receive this document-scoped CSP.
      window.location.assign("/musique/checkout");
    } catch (e) { setError(e instanceof Error ? e.message : "Connexion requise."); }
    finally { setBusy(false); }
  }
  return <div className={`${styles.grid} ${styles.cartGrid}`}>
    <section className={`${styles.panel} ${styles.cartPanel}`} aria-labelledby="digital-cart-selection">
      <div className={styles.cartHeading}><h2 id="digital-cart-selection"><T text="Votre sélection"/></h2>{value ? <span><T text={value.lines.length === 1 ? "{count} article" : "{count} articles"} values={{ count: value.lines.length }}/></span> : null}</div>
      <p className={styles.note}><T text="Formats indiqués pour chaque article. Panier séparé de la Boutique physique."/></p>
      {error ? <p role="alert" className={styles.status}><T text={error}/></p> : null}
      <p className="sr-only" role="status" aria-live="polite">{notice === "Les titres inclus dans l’album ont été retirés : ils ne seront pas facturés deux fois." ? <T text={notice}/> : notice}</p>
      {value?.lines.length ? <ul className={styles.cartRows} aria-busy={updating}>{value.lines.map(l => <li className={styles.cartRow} key={l.id}>
        <span className={styles.cartIcon} aria-hidden="true">♪</span>
        <div className={styles.cartIdentity}><strong translate="no" className="notranslate">{l.title}</strong><p>{l.scope === "ALBUM" ? <T text="{count} pistes · Album" values={{ count: l.trackCount }}/> : <T text="Titre individuel"/>} · <T text={digitalFormatsLabel(l.formats)}/></p>{l.formats?.length === 1 && l.formats[0] === "MP3" ? <p className={styles.muted}><T text="Fichier source compressé. Aucun WAV ni amélioration de qualité inclus."/></p> : null}{l.completion ? <div className={styles.cartCompletion}><span><T text="Prix de l’album"/> <span className={styles.cartAmount}>{money(l.completion.basePriceCents)}</span></span><span><T text="Titres déjà payés, après remboursements"/> <span className={styles.cartAmount}>−{money(l.completion.creditCents)}</span></span></div> : null}</div>
        <div className={styles.cartLineActions}><strong className={styles.cartAmount}>{money(l.priceCents)}</strong><button type="button" className={styles.cartRemove} aria-label={t("Retirer {title} du panier", { title: l.title })} disabled={busy || updating} onClick={() => remove(l.id, l.title)}><T text="Retirer"/></button></div>
      </li>)}</ul> : <p role="status">{value ? <T text="Votre panier numérique est vide."/> : error ? <T text="Sélection à vérifier avant tout paiement."/> : <T text="Vérification de votre sélection…"/>}</p>}
      {error ? <div className={styles.actions}><Link href="/contact" className="text-link"><T text="Contacter LNX Beats"/></Link><button type="button" className={styles.quiet} onClick={() => { try { writeDigitalCart([]); } catch { setError("Le navigateur n’a pas pu modifier le panier."); } }}><T text="Vider la sélection numérique"/></button><p className={styles.muted}><T text="Cela n’annule pas un paiement déjà engagé."/></p></div> : null}
      <Link className={styles.cartBack} href="/discographie"><T text="Continuer à découvrir la musique"/></Link>
    </section>
    <aside className={`${styles.panel} ${styles.cartPanel}`} aria-labelledby="digital-cart-summary">
      <h2 id="digital-cart-summary"><T text="Récapitulatif"/></h2>
      <div className={styles.cartTotal} aria-busy={updating}><span><T text="Total à payer"/>{value ? <small><T text={value.lines.length === 1 ? "{count} article" : "{count} articles"} values={{ count: value.lines.length }}/></small> : null}</span><strong className={styles.cartAmount}>{value ? money(value.totalCents) : "—"}</strong></div>
      <p className={styles.muted}><T text="Les titres inclus dans un album ne sont pas facturés deux fois. Un complément d’album déduit seulement les achats éligibles déjà payés, après remboursements."/></p>
      <p className={styles.note}>{!digitalUiIsLive(mode) ? <T text="Tarifs de test, non définitifs."/> : ""}<T text="France métropolitaine et Corse, sous réserve d’éligibilité."/></p>
      <div className={styles.cartCheckoutActions}><button className={styles.button} type="button" disabled={busy || updating || !value?.lines.length || !!error} onClick={() => void continueCheckout()}>{busy ? <T text="Vérification…"/> : <T text="Passer au paiement"/>}</button><Link className="text-link" href="/connexion?retour=%2Fmusique%2Fpanier"><T text="Se connecter"/></Link></div>
    </aside>
  </div>;
}
