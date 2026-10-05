"use client";

import { useEffect, useRef, useState } from "react";
import { ADSENSE_CLIENT_ID } from "@/data/adsense";
import { GOOGLE_CMP_SCRIPT_URL } from "@/data/google-cmp";
import { createConsentGate, googlePreferencesAvailable, mayRequestAd, type ConsentState, type TcfData } from "@/lib/ads/consent";
import { allowsAdSlot, type AdSlot } from "@/lib/ads/policy";
import { isScriptNonce } from "@/lib/security/csp-nonce";
import styles from "./editorial-ad-slot.module.css";

type TcfApi = (command: string, version: number, callback: (data: TcfData, success: boolean) => void, parameter?: number) => void;
type AdQueue = Array<Record<string, unknown>> & { pauseAdRequests?: number };
type GoogleWindow = Window & {
  adsbygoogle?: AdQueue;
  __tcfapi?: TcfApi;
  googlefc?: {
    callbackQueue?: Array<Record<string, () => void>>;
    controlledMessagingFunction?: (message: { proceed: (show: boolean) => void }) => void;
    showRevocationMessage?: () => void;
  };
};

/** Paused AFC bootstrap for consent; advertising retains its independent lock. */
export function GoogleConsentAd({ pathname, slot, slotId, enabled }: {
  pathname: string; slot: AdSlot; slotId: string | null; enabled: boolean;
}) {
  const [consent, setConsent] = useState<ConsentState>("unknown");
  const [ready, setReady] = useState(false);
  const element = useRef<HTMLModElement>(null);
  const revoke = useRef<() => void>(() => {});
  const requested = useRef(false);
  useEffect(() => {
    const win = window as GoogleWindow;
    const queue = win.adsbygoogle ??= [] as AdQueue;
    queue.pauseAdRequests = 1; // Before the network script, not after its execution.
    // Use the nonce of the current HTML document, never that of a later RSC
    // response. Only Next's nonced runtime script is a trusted source.
    const nonce = document.querySelector<HTMLScriptElement>('script[nonce][src^="/_next/"]')?.nonce;
    if (!isScriptNonce(nonce) || location.origin !== "https://www.lnxbeats.fr" || !allowsAdSlot(location.pathname, slot)) return;
    const gate = createConsentGate(state => {
      queue.pauseAdRequests = state === "granted" && enabled && slotId && allowsAdSlot(location.pathname, slot) ? 0 : 1;
      setConsent(state);
    });
    let disposed = false;
    let listenerId: number | undefined;
    const fc = win.googlefc ??= {};
    fc.callbackQueue ??= [];
    fc.controlledMessagingFunction = message => message.proceed(allowsAdSlot(location.pathname, slot));
    const subscribe = () => {
      if (disposed) return;
      win.__tcfapi?.("addEventListener", 2, (data, success) => {
        listenerId = data?.listenerId;
        if (disposed) {
          if (listenerId !== undefined) win.__tcfapi?.("removeEventListener", 2, () => {}, listenerId);
          return;
        }
        setReady(googlePreferencesAvailable(data, success) && typeof fc.showRevocationMessage === "function");
        gate.update(data, success);
      });
    };
    fc.callbackQueue.push({ CONSENT_API_READY: subscribe });
    revoke.current = () => {
      gate.revoke(); // Pause first; Google clears/recollects its own consent record.
      setReady(false);
      fc.callbackQueue?.push({ CONSENT_API_READY: () => fc.showRevocationMessage?.() });
    };
    if (!document.getElementById("lnx-google-cmp")) {
      const script = document.createElement("script");
      script.id = "lnx-google-cmp";
      script.async = true;
      script.nonce = nonce;
      script.crossOrigin = "anonymous"; // Official AdSense tag supports CORS.
      script.src = GOOGLE_CMP_SCRIPT_URL;
      document.head.append(script);
    }
    // Leave the advertising document entirely before entering an excluded route.
    // This prevents a previously loaded third-party script surviving an SPA transition.
    const leave = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const anchor = (event.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, location.href);
      if (url.origin === location.origin && !["content", "footer"].some(kind => allowsAdSlot(url.pathname, kind as AdSlot))) {
        event.preventDefault(); queue.pauseAdRequests = 1; location.assign(url.href);
      }
    };
    document.addEventListener("click", leave, true);
    return () => {
      disposed = true;
      gate.dispose();
      queue.pauseAdRequests = 1;
      if (listenerId !== undefined) win.__tcfapi?.("removeEventListener", 2, () => {}, listenerId);
      document.removeEventListener("click", leave, true);
    };
  }, [enabled, pathname, slot, slotId]);
  const canShow = Boolean(slotId) && mayRequestAd(pathname, slot, enabled, consent);
  useEffect(() => {
    if (!canShow) { requested.current = false; return; }
    if (!element.current || requested.current) return;
    requested.current = true;
    ((window as GoogleWindow).adsbygoogle ??= [] as AdQueue).push({});
  }, [canShow]);
  if (!ready && !canShow) return null;
  return <div data-google-cmp-state={consent} data-google-cmp-ready={String(ready)}>
    {canShow ? <aside className={`${styles.section} ${styles.placeholder} ${styles.liveSlot}`} aria-label="Publicité">
      <span className={styles.label}>Publicité</span>
      <ins ref={element} className="adsbygoogle" style={{ display: "block", minHeight: 100 }} data-ad-client={ADSENSE_CLIENT_ID} data-ad-slot={slotId!} data-ad-format="horizontal" data-full-width-responsive="true" />
    </aside> : null}
    {ready ? <button id="choix-publicitaires" type="button" className={styles.preferences} onClick={() => revoke.current()}>Gérer mes choix de confidentialité</button> : null}
  </div>;
}
