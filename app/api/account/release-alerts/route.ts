import { getAuthSession } from "@/lib/auth/session";
import { getReleaseAlertPreferences, saveReleaseAlertPreferences } from "@/lib/release-notifications/preferences";
import { handleReleaseAlertGet, handleReleaseAlertPatch, type ReleaseAlertHttpDependencies } from "@/lib/release-notifications/http";

export const dynamic = "force-dynamic";
const dependencies: ReleaseAlertHttpDependencies = {
  baseUrl: process.env.AUTH_URL ?? process.env.SITE_URL ?? "http://localhost:3000",
  user: async () => (await getAuthSession())?.user ?? null,
  get: getReleaseAlertPreferences,
  save: saveReleaseAlertPreferences,
};
export const GET = () => handleReleaseAlertGet(dependencies);
export const PATCH = (request: Request) => handleReleaseAlertPatch(request, dependencies);
