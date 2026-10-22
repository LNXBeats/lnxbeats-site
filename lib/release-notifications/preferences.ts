import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { DEFAULT_RELEASE_ALERT_CHOICES, RELEASE_ALERT_CONSENT_VERSION, parseReleaseAlertChoices, releaseAlertPreferenceData, type ReleaseAlertChoices } from "@/lib/release-notifications/domain";
import { siteLocale } from "@/lib/i18n/config";

export async function getReleaseAlertPreferences(userId: string) {
  const row = await prisma.releaseAlertPreference.findUnique({ where: { userId } });
  return { music: row?.music ?? false, shop: row?.shop ?? false, editorial: row?.editorial ?? false, locale: row?.locale ?? "fr" };
}

export async function saveReleaseAlertPreferencesInTransaction(tx: Prisma.TransactionClient, userId: string, input: ReleaseAlertChoices,
  source: "ACCOUNT" | "REGISTRATION" | "UNSUBSCRIBE" = "ACCOUNT", now = new Date()) {
  const choices = parseReleaseAlertChoices(input);
  if (!choices) throw new Error("INVALID_RELEASE_ALERT_CHOICES");
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`release-alert-preferences:${userId}`})) IS NULL AS locked`;
  const user = await tx.user.findUnique({ where: { id: userId }, select: { emailVerified: true, status: true } });
  if (!user || (source !== "UNSUBSCRIBE" && (!user.emailVerified || user.status !== "ACTIVE"))) throw new Error("RELEASE_ALERT_ACCOUNT_UNAVAILABLE");
  const previous = await tx.releaseAlertPreference.findUnique({ where: { userId } });
  if (previous && previous.music === choices.music && previous.shop === choices.shop && previous.editorial === choices.editorial
    && previous.locale === choices.locale && previous.consentVersion === RELEASE_ALERT_CONSENT_VERSION) {
    return { music: previous.music, shop: previous.shop, editorial: previous.editorial, locale: previous.locale };
  }
  const data = releaseAlertPreferenceData(previous, choices, now);
  const result = await tx.releaseAlertPreference.upsert({ where: { userId }, create: { userId, ...data }, update: data });
  // A durable receipt of precisely the voluntarily selected categories, without IP tracking.
  if (!previous || previous.music !== choices.music || previous.shop !== choices.shop || previous.editorial !== choices.editorial || previous.locale !== choices.locale) {
    await tx.releaseAlertPreferenceEvent.create({ data: { userId, source, consentVersion: RELEASE_ALERT_CONSENT_VERSION, preferences: choices } });
  }
  // Canceled deliveries are never revived by later re-subscription.
  const disabled = [!choices.music ? "MUSIC" : null, !choices.shop ? "SHOP" : null, !choices.editorial ? "EDITORIAL" : null].filter((v): v is string => Boolean(v));
  if (disabled.length) await tx.releaseAlertDelivery.updateMany({ where: { userId, publication: { kind: { in: disabled } }, status: { in: ["PENDING", "FAILED_RETRYABLE"] } }, data: { status: "CANCELED", lastErrorCode: "CONSENT_WITHDRAWN" } });
  return { music: result.music, shop: result.shop, editorial: result.editorial, locale: result.locale };
}

export async function saveReleaseAlertPreferences(userId: string, choices: ReleaseAlertChoices) {
  return prisma.$transaction(tx => saveReleaseAlertPreferencesInTransaction(tx, userId, choices));
}
export async function unsubscribeReleaseAlerts(userId: string) {
  return prisma.$transaction(async tx => {
    const preference = await tx.releaseAlertPreference.findUnique({ where: { userId }, select: { locale: true } });
    return saveReleaseAlertPreferencesInTransaction(tx, userId, { ...DEFAULT_RELEASE_ALERT_CHOICES, locale: siteLocale(preference?.locale) }, "UNSUBSCRIBE");
  });
}
