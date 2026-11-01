"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useSiteLanguage } from "./site-language";
import { allowsAnalyticsPath, type AnalyticsConfiguration, type AnalyticsConsent, type AnalyticsDecision } from "@/lib/analytics/policy";
import { createAnalyticsBrowserSession, createAnalyticsDocumentBoundary } from "@/lib/analytics/browser";
import styles from "./site-analytics.module.css";

const COPY = {
  fr: {
    title: "Un choix pour votre confidentialité",
    body: "Autoriser Google Analytics à mesurer la fréquentation de nos pages publiques ? Aucun suivi dans votre compte, vos commandes ou le paiement. Refuser ne change rien à votre visite.",
    detail: "Votre choix est conservé pendant 6 mois maximum. Vous pourrez le modifier ici à tout moment. La mesure utilise des cookies et transmet des données techniques de navigation à Google.",
    accept: "Accepter la mesure", refuse: "Refuser la mesure", manage: "Mes choix de mesure d’audience", privacy: "Confidentialité", close: "Fermer sans changer mon choix",
    error: "Votre choix n’a pas pu être enregistré. La mesure reste désactivée.",
  },
  en: {
    title: "Your privacy, your choice",
    body: "Allow Google Analytics to measure visits to our public pages? There is no tracking in your account, orders or checkout. Refusing will not affect your visit.",
    detail: "Your choice is saved for up to 6 months. You can change it here at any time. Measurement uses cookies and sends technical browsing data to Google.",
    accept: "Allow measurement", refuse: "Reject measurement", manage: "My audience measurement choices", privacy: "Privacy", close: "Close without changing my choice",
    error: "Your choice could not be saved. Measurement remains disabled.",
  },
  es: {
    title: "Tu privacidad, tu decisión",
    body: "¿Permites que Google Analytics mida las visitas a nuestras páginas públicas? No hay seguimiento en tu cuenta, pedidos ni pago. Rechazarlo no afecta a tu visita.",
    detail: "Tu elección se guarda durante un máximo de 6 meses. Puedes cambiarla aquí en cualquier momento. La medición utiliza cookies y envía datos técnicos de navegación a Google.",
    accept: "Aceptar la medición", refuse: "Rechazar la medición", manage: "Mis preferencias de medición", privacy: "Privacidad", close: "Cerrar sin cambiar mi elección",
    error: "No se pudo guardar tu elección. La medición sigue desactivada.",
  },
  pt: {
    title: "A sua privacidade, a sua escolha",
    body: "Permitir que o Google Analytics meça as visitas às nossas páginas públicas? Não há acompanhamento na sua conta, encomendas ou pagamento. Recusar não altera a sua visita.",
    detail: "A sua escolha é guardada por até 6 meses. Pode alterá-la aqui a qualquer momento. A medição utiliza cookies e envia dados técnicos de navegação à Google.",
    accept: "Aceitar a medição", refuse: "Recusar a medição", manage: "As minhas preferências de medição", privacy: "Privacidade", close: "Fechar sem alterar a minha escolha",
    error: "Não foi possível guardar a sua escolha. A medição continua desativada.",
  },
  zh: {
    title: "您的隐私，由您选择",
    body: "是否允许 Google Analytics 统计公开页面的访问情况？您的账户、订单和付款页面不会被跟踪。拒绝不会影响您浏览本站。",
    detail: "您的选择最多保存六个月，您可以随时在此修改。访问统计使用 Cookie，并向 Google 发送技术性浏览数据。",
    accept: "允许访问统计", refuse: "拒绝访问统计", manage: "访问统计偏好", privacy: "隐私政策", close: "关闭且不更改选择",
    error: "无法保存您的选择。访问统计仍处于关闭状态。",
  },
  ja: {
    title: "プライバシーをご自身で選択",
    body: "Google Analytics による公開ページのアクセス解析を許可しますか？アカウント、注文、決済ページでは追跡しません。拒否してもサイトの利用に影響はありません。",
    detail: "選択は最大6か月間保存され、いつでもここで変更できます。アクセス解析では Cookie を使用し、閲覧に関する技術情報を Google に送信します。",
    accept: "解析を許可", refuse: "解析を拒否", manage: "アクセス解析の設定", privacy: "プライバシー", close: "選択を変更せず閉じる",
    error: "選択を保存できませんでした。解析は無効のままです。",
  },
} as const;

/** Deliberately separate from AdSense/TCF, account and marketing preferences. */
export function SiteAnalytics({ configuration }: { configuration: AnalyticsConfiguration | null }) {
  const pathname = usePathname();
  const { locale } = useSiteLanguage();
  const copy = COPY[locale];
  const [consent, setConsent] = useState<AnalyticsConsent>("unknown");
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState(false);
  const session = useRef<ReturnType<typeof createAnalyticsBrowserSession> | null>(null);
  const { enabled, mode, origin, measurementId } = configuration ?? {};
  useEffect(() => {
    if (!enabled || !mode || !origin || !measurementId) return;
    const currentConfiguration = { enabled, mode, origin, measurementId };
    const boundary = createAnalyticsDocumentBoundary({ configuration: currentConfiguration, win: window });
    if (!boundary.mayStartSession() || !allowsAnalyticsPath(pathname)) return;
    const current = createAnalyticsBrowserSession({ configuration: currentConfiguration, win: window, doc: document, onConsent: value => {
      setConsent(value);
      setReady(true);
      if (value === "unknown") setOpen(true);
    } });
    session.current = current;
    return () => { current.dispose(); if (session.current === current) session.current = null; };
  }, [enabled, mode, origin, measurementId, pathname]);
  useEffect(() => {
    if (!open) return;
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("keydown", escape);
    return () => document.removeEventListener("keydown", escape);
  }, [open]);
  if (!configuration || !allowsAnalyticsPath(pathname) || !ready) return null;
  const choose = (decision: AnalyticsDecision) => {
    const saved = session.current?.choose(decision) ?? false;
    setError(!saved);
    if (saved) setOpen(false);
  };
  return <div id="mesure-audience" className={styles.root} data-analytics-consent={consent}>
    {open ? <aside role="dialog" aria-modal="false" className={styles.panel} aria-labelledby="lnx-analytics-title" aria-describedby="lnx-analytics-description">
      <div className={styles.heading}><h2 id="lnx-analytics-title">{copy.title}</h2><button type="button" className={styles.close} aria-label={copy.close} onClick={() => setOpen(false)}>×</button></div>
      <p id="lnx-analytics-description">{copy.body}</p>
      <p className={styles.detail}>{copy.detail} <a href="/confidentialite">{copy.privacy}</a></p>
      <div className={styles.actions}><button type="button" onClick={() => choose("denied")}>{copy.refuse}</button><button type="button" onClick={() => choose("granted")}>{copy.accept}</button></div>
      {error ? <p role="alert">{copy.error}</p> : null}
    </aside> : null}
    <button type="button" className={styles.preferences} onClick={() => { setOpen(true); setError(false); }}>{copy.manage}</button>
  </div>;
}
