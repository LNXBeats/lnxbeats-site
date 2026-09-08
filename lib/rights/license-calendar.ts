export const RIGHTS_TIME_ZONE = "Europe/Paris";
export const RIGHTS_WITHDRAWAL_DAYS = 14;
export const RIGHTS_DURATION_YEARS = 5;

type Parts = Readonly<{
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}>;

const formatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: RIGHTS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function localParts(value: Date): Parts {
  if (Number.isNaN(value.getTime())) throw new TypeError("Invalid rights calendar date.");
  const values = Object.fromEntries(
    formatter.formatToParts(value)
      .filter(({ type }) => type !== "literal")
      .map(({ type, value: part }) => [type, Number(part)]),
  );
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
    second: values.second,
    millisecond: value.getUTCMilliseconds(),
  };
}

function utcWallClock(parts: Parts) {
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, parts.millisecond);
}

function fromParisParts(parts: Parts) {
  const desired = utcWallClock(parts);
  let candidate = desired;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const observed = utcWallClock(localParts(new Date(candidate)));
    const correction = desired - observed;
    if (correction === 0) return new Date(candidate);
    candidate += correction;
  }
  const resolved = new Date(candidate);
  if (utcWallClock(localParts(resolved)) !== desired) throw new RangeError("Nonexistent Europe/Paris wall-clock time.");
  return resolved;
}

function daysInMonth(year: number, month: number) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

export function withdrawalEndsAt(paidAt: Date) {
  const parts = localParts(paidAt);
  const calendar = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + RIGHTS_WITHDRAWAL_DAYS));
  return fromParisParts({
    ...parts,
    year: calendar.getUTCFullYear(),
    month: calendar.getUTCMonth() + 1,
    day: calendar.getUTCDate(),
  });
}

export function licenseExpiresAt(effectiveAt: Date) {
  const parts = localParts(effectiveAt);
  const year = parts.year + RIGHTS_DURATION_YEARS;
  return fromParisParts({
    ...parts,
    year,
    day: Math.min(parts.day, daysInMonth(year, parts.month)),
  });
}
