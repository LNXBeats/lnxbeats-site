export const PREMIERE_TIME_ZONE = "Europe/Paris";

/** A date-only announcement has no provider-confirmed release time. Midnight
 * Paris is a display reference, never a publication or availability trigger. */
export function premiereCountdownTarget(releaseDate: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(releaseDate)) return null;
  const midnightUtc = Date.parse(`${releaseDate}T00:00:00.000Z`);
  if (!Number.isFinite(midnightUtc) || new Date(midnightUtc).toISOString().slice(0, 10) !== releaseDate) return null;
  const formatter = new Intl.DateTimeFormat("en-GB", { timeZone: PREMIERE_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  let instant = midnightUtc;
  for (let attempt = 0; attempt < 4; attempt++) {
    const parts = new Map(formatter.formatToParts(new Date(instant)).map(part => [part.type, part.value]));
    const localAsUtc = Date.parse(`${parts.get("year")?.padStart(4, "0")}-${parts.get("month")}-${parts.get("day")}T${parts.get("hour")}:${parts.get("minute")}:${parts.get("second")}.000Z`);
    if (!Number.isFinite(localAsUtc)) return null;
    const correction = midnightUtc - localAsUtc;
    if (!correction) return instant;
    instant += correction;
  }
  return null;
}

export function premiereCountdownParts(target: number | null, now: number) {
  if (target === null || !Number.isFinite(target) || !Number.isFinite(now)) return null;
  const totalSeconds = Math.max(0, Math.ceil((target - now) / 1000));
  return { reached: now >= target, days: Math.floor(totalSeconds / 86_400), hours: Math.floor(totalSeconds / 3600) % 24,
    minutes: Math.floor(totalSeconds / 60) % 60, seconds: totalSeconds % 60 };
}

type CountdownClock = {
  now: () => number;
  visible: () => boolean;
  everySecond: (tick: () => void) => () => void;
  onVisibilityChange: (changed: () => void) => () => void;
};

/** Re-read wall clock rather than decrementing a counter. Hidden tabs own no
 * interval, and resuming or an overdue date cannot cause a publication. */
export function observePremiereClock(target: number | null, update: (now: number) => void, clock: CountdownClock): () => void {
  if (target === null || !Number.isFinite(target)) return () => undefined;
  let disposed = false;
  let stopInterval: (() => void) | null = null;
  const stop = () => { stopInterval?.(); stopInterval = null; };
  const tick = () => {
    if (disposed || !clock.visible()) { stop(); return; }
    const now = clock.now();
    update(now);
    if (!Number.isFinite(now) || now >= target) stop();
  };
  const resume = () => {
    stop();
    if (disposed || !clock.visible()) return;
    tick();
    const now = clock.now();
    if (Number.isFinite(now) && now < target) stopInterval = clock.everySecond(tick);
  };
  const unsubscribe = clock.onVisibilityChange(resume);
  resume();
  return () => { disposed = true; stop(); unsubscribe(); };
}
