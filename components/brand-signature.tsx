"use client";

import { useSyncExternalStore } from "react";
import { useSiteLanguage } from "@/components/site-language";
import type { SiteLocale } from "@/lib/i18n/config";
import styles from "./brand-signature.module.css";

const STILL = "/assets/signature-20261024/lnx-beats-fixe-1600.png";
const ANIMATED = "/assets/signature-20261024/lnx-beats-anime.svg";
const PREFERENCE = "lnx-brand-animation-paused";
const PREFERENCE_EVENT = "lnx-brand-animation-change";
let pausedInMemory: boolean | null = null;

function isPaused() {
  if (pausedInMemory !== null) return pausedInMemory;
  try {
    return window.localStorage.getItem(PREFERENCE) === "true";
  } catch {
    return false;
  }
}

function subscribe(listener: () => void) {
  const storageListener = (event: StorageEvent) => {
    if (event.key === PREFERENCE || event.key === null) {
      pausedInMemory = null;
      listener();
    }
  };
  window.addEventListener(PREFERENCE_EVENT, listener);
  window.addEventListener("storage", storageListener);
  return () => {
    window.removeEventListener(PREFERENCE_EVENT, listener);
    window.removeEventListener("storage", storageListener);
  };
}

// Static before hydration (and without JavaScript); a browser reduction of
// motion always wins through <picture>, independently of the saved preference.
const serverPaused = () => true;
const usePaused = () => useSyncExternalStore(subscribe, isPaused, serverPaused);
const subscribeReady = () => () => {};
const clientReady = () => true;
const serverReady = () => false;

export function BrandSignature({ alt = "", className, priority = false }: {
  alt?: string;
  className?: string;
  priority?: boolean;
}) {
  const paused = usePaused();
  return <picture className={`${styles.signature} notranslate${className ? ` ${className}` : ""}`} translate="no" data-brand-signature>
    <source media="(prefers-reduced-motion: reduce)" srcSet={STILL} type="image/png" />
    <source srcSet={paused ? STILL : ANIMATED} type={paused ? "image/png" : "image/svg+xml"} />
    {/* The supplied, self-contained animation must bypass Next/Image conversion. */}
    <img className={styles.image} src={STILL} width={1600} height={400} alt={alt}
      loading={priority ? "eager" : "lazy"} fetchPriority={priority ? "high" : "auto"} decoding="async" />
  </picture>;
}

const controlLabels: Record<SiteLocale, { pause: string; resume: string }> = {
  fr: { pause: "Mettre le logo en pause", resume: "Animer le logo" },
  en: { pause: "Pause logo animation", resume: "Animate logo" },
  es: { pause: "Pausar la animación del logo", resume: "Animar el logo" },
  pt: { pause: "Pausar a animação do logótipo", resume: "Animar o logótipo" },
  zh: { pause: "暂停标志动画", resume: "播放标志动画" },
  ja: { pause: "ロゴのアニメーションを停止", resume: "ロゴをアニメーション表示" },
};

/** One persistent, keyboard-accessible control pauses every shared signature. */
export function BrandMotionToggle() {
  const paused = usePaused();
  const ready = useSyncExternalStore(subscribeReady, clientReady, serverReady);
  const { locale } = useSiteLanguage();
  return <button type="button" className={styles.motionToggle} data-brand-motion-toggle
    disabled={!ready}
    onClick={() => {
      pausedInMemory = !paused;
      try { window.localStorage.setItem(PREFERENCE, String(pausedInMemory)); } catch { /* Memory-only on storage-restricted browsers. */ }
      window.dispatchEvent(new Event(PREFERENCE_EVENT));
    }}>
    {paused ? controlLabels[locale].resume : controlLabels[locale].pause}
  </button>;
}
