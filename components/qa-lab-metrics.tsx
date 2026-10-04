"use client";

import { useEffect } from "react";

/** Bounded, opt-in synthetic QA only. No network, identifiers, storage or route details. */
export function QaLabMetrics({ mode }: { mode: "off" | "placeholder" }) {
  useEffect(() => {
    if (["lnxbeats.fr", "www.lnxbeats.fr"].includes(location.hostname)) return;
    let lcp: number | null = null;
    let cls: number | null = null;
    const observers: PerformanceObserver[] = [];
    for (const type of ["largest-contentful-paint", "layout-shift"]) {
      if (!PerformanceObserver.supportedEntryTypes.includes(type)) continue;
      if (type === "layout-shift") cls = 0;
      const observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) {
          if (type === "largest-contentful-paint") lcp = entry.startTime;
          else {
            const shift = entry as PerformanceEntry & { hadRecentInput: boolean; value: number };
            if (!shift.hadRecentInput) cls = (cls ?? 0) + shift.value;
          }
        }
      });
      observer.observe({ type, buffered: true });
      observers.push(observer);
    }
    const timer = setTimeout(() => {
      const navigation = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      console.info("LNX_QA_LAB", JSON.stringify({ mode, width: innerWidth, windowMs: 8000, lcpMs: lcp, cumulativeLayoutShift: cls, ttfbMs: navigation ? navigation.responseStart - navigation.requestStart : null, inp: "NOT_MEASURED" }));
      observers.forEach(observer => observer.disconnect());
    }, 8000);
    return () => { clearTimeout(timer); observers.forEach(observer => observer.disconnect()); };
  }, [mode]);
  return null;
}
