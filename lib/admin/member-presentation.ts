const memberLoginDateFormatter = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

const memberLoginTimeFormatter = new Intl.DateTimeFormat("fr-FR", {
  timeZone: "Europe/Paris",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

export function formatMemberLastLogin(lastLoginAt: Date | null): string | null {
  if (!lastLoginAt || !Number.isFinite(lastLoginAt.getTime())) return null;
  return `${memberLoginDateFormatter.format(lastLoginAt)} à ${memberLoginTimeFormatter.format(lastLoginAt)}`;
}
