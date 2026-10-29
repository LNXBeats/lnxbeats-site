"use client";

import { useEffect, useMemo, useState } from "react";
import { T, useSiteLanguage } from "@/components/site-language";
import { localeIntl } from "@/lib/i18n/config";
import { observePremiereClock, premiereCountdownParts, premiereCountdownTarget, PREMIERE_TIME_ZONE } from "@/lib/members/premiere-countdown";
import styles from "./premiere-countdown.module.css";

export function PremiereCountdown({ releaseDate, initialNow, className }: { releaseDate: string; initialNow: number; className?: string }) {
  const { locale, t } = useSiteLanguage();
  // Both SSR and the first client render use the same server-provided instant.
  const [now, setNow] = useState(initialNow);
  const target = useMemo(() => premiereCountdownTarget(releaseDate), [releaseDate]);
  const parts = premiereCountdownParts(target, now);

  useEffect(() => observePremiereClock(target, setNow, {
    now: () => Date.now(),
    visible: () => document.visibilityState === "visible",
    everySecond(tick) { const interval = window.setInterval(tick, 1000); return () => window.clearInterval(interval); },
    onVisibilityChange(changed) { document.addEventListener("visibilitychange", changed); return () => document.removeEventListener("visibilitychange", changed); },
  }), [target]);

  if (target === null || !parts) return <p className={styles.note}><T text="Date de sortie à préciser." /></p>;
  const date = new Intl.DateTimeFormat(localeIntl(locale), { timeZone: PREMIERE_TIME_ZONE, dateStyle: "long" }).format(new Date(target));
  const cells = [[parts.days, "Jours"], [parts.hours, "Heures"], [parts.minutes, "Minutes"], [parts.seconds, "Secondes"]] as const;
  return <div className={`${styles.countdown}${className ? ` ${className}` : ""}`} data-premiere-countdown={releaseDate}>
    <p className={styles.date}><T text="Sortie annoncée sur les plateformes" /> <time dateTime={new Date(target).toISOString()}>{date}</time></p>
    {parts.reached ? <p className={styles.reached}><T text="La date annoncée est atteinte. Consultez les liens des plateformes pour vérifier la disponibilité." /></p>
      : <div className={styles.units} role="timer" aria-live="off" aria-label={t("Temps avant la date annoncée, repère de Paris")}>
        {cells.map(([value, label]) => <div className={styles.unit} key={label}><strong className={styles.value}>{String(value).padStart(2, "0")}</strong><span>{t(label)}</span></div>)}
      </div>}
    <p className={styles.note}><T text="Repère : 00:00, heure de Paris. L’heure de disponibilité peut varier selon les plateformes." /></p>
  </div>;
}
