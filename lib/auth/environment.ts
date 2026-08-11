import "server-only";

export const ADMIN_PRINCIPAL_EMAIL = "lnx.beats.pro@gmail.com";
export const LOCAL_PREVIEW_DATABASE_TARGET = "lnx-studio-local-preview";

export function isLoopbackUrl(value: string | undefined) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return url.protocol === "http:"
      && ["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

export function isPersistentLocalPreview() {
  return process.env.LNX_PREVIEW_MODE === "persistent-local"
    && process.env.LNX_DATABASE_TARGET === LOCAL_PREVIEW_DATABASE_TARGET
    && isLoopbackUrl(process.env.AUTH_URL ?? process.env.SITE_URL);
}

export function configuredAdminEmail() {
  const configured = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!configured || configured !== ADMIN_PRINCIPAL_EMAIL) {
    throw new Error("ADMIN_EMAIL must identify the approved LNX Beats administrator account.");
  }
  return configured;
}
