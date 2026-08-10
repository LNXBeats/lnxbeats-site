const INTERNAL_ORIGIN = "https://lnx-studio.invalid";
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export function safeInternalPath(candidate: string | null | undefined, fallback = "/compte") {
  if (
    !candidate ||
    candidate !== candidate.trim() ||
    !candidate.startsWith("/") ||
    candidate.startsWith("//") ||
    candidate.includes("\\") ||
    CONTROL_CHARACTERS.test(candidate)
  ) {
    return fallback;
  }

  try {
    const url = new URL(candidate, INTERNAL_ORIGIN);
    if (url.origin !== INTERNAL_ORIGIN) return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}
