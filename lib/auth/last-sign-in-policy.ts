/** Authentication evidence only; profile/session refresh activity is not a login. */
export const LAST_SIGN_IN_ENDPOINT = "/sign-in/email";
type DateValue = Date | string | null | undefined;
function validDate(value: DateValue): Date | null {
  if (!(value instanceof Date) && typeof value !== "string") return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.getTime() > 0 ? date : null;
}

export function successfulSignInReceipt(
  session: { userId: string; createdAt: Date | string },
  endpoint: string | null | undefined,
  now = new Date(),
) {
  if (endpoint !== LAST_SIGN_IN_ENDPOINT || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(session.userId)) return null;
  const signedInAt = validDate(session.createdAt);
  if (!signedInAt || !Number.isFinite(now.getTime()) || signedInAt.getTime() > now.getTime() + 60_000) return null;
  return { userId: session.userId, signedInAt };
}

export type LastSignInObservation = { at: Date | null; source: "CONFIRMED_SIGN_IN" | "RETAINED_SESSION" | "UNKNOWN" };
/** A retained session is only a labelled historical fallback. Never backfill it
 * into the confirmed field or replace a confirmed sign-in with session activity. */
export function lastSignInObservation(confirmed: DateValue, retainedSessionCreatedAt: DateValue): LastSignInObservation {
  const known = validDate(confirmed);
  if (known) return { at: known, source: "CONFIRMED_SIGN_IN" };
  const partial = validDate(retainedSessionCreatedAt);
  return partial ? { at: partial, source: "RETAINED_SESSION" } : { at: null, source: "UNKNOWN" };
}

export function formatLastSignIn(observation: LastSignInObservation, now = new Date()) {
  if (!observation.at) return { absolute: "Non connue", relative: null, explanation: "Aucune authentification datée conservée ; ce membre peut s’être connecté avant le début du suivi." };
  const parts = new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false }).formatToParts(observation.at);
  const part = (type: string) => parts.find(p => p.type === type)?.value ?? "";
  const absolute = `${part("day")}/${part("month")}/${part("year")} à ${part("hour")}:${part("minute")}:${part("second")} (Paris)`;
  const seconds = Math.max(0, Math.floor((now.getTime() - observation.at.getTime()) / 1000));
  const relative = seconds < 60 ? "À l’instant" : seconds < 3600
    ? new Intl.RelativeTimeFormat("fr-FR", { numeric: "auto" }).format(-Math.floor(seconds / 60), "minute")
    : seconds < 86400 ? new Intl.RelativeTimeFormat("fr-FR", { numeric: "auto" }).format(-Math.floor(seconds / 3600), "hour")
      : new Intl.RelativeTimeFormat("fr-FR", { numeric: "auto" }).format(-Math.floor(seconds / 86400), "day");
  return { absolute, relative, explanation: observation.source === "CONFIRMED_SIGN_IN"
    ? "Authentification réussie enregistrée ; ce n’est pas la dernière activité."
    : "Session conservée uniquement : historique partiel, pas une authentification attestée." };
}
