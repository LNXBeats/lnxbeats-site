"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireAdmin } from "@/lib/auth/session";
import { isSameOriginMutation } from "@/lib/auth/origin";
import {
  addCatalogPlatformLink, addCatalogTrack, deleteCatalogPlatformLink, deleteCatalogTrack,
  moveCatalogTrack, updateCatalogPlatformLink, updateCatalogProject, updateCatalogTrack,
} from "@/lib/catalog/service";

async function authorize() {
  const requestHeaders = await headers();
  const baseUrl = process.env.AUTH_URL ?? process.env.SITE_URL ?? "http://127.0.0.1:3000";
  if (!isSameOriginMutation(new Request(baseUrl, { method: "POST", headers: requestHeaders }), baseUrl)) throw new Error("Origine refusée.");
  return requireAdmin();
}

function values(formData: FormData) { return Object.fromEntries(formData.entries()) as Record<string, unknown>; }
function path(slug: string, state: string) { return `/admin/catalogue/${encodeURIComponent(slug)}?etat=${encodeURIComponent(state)}`; }
function validIdentity(formData: FormData) {
  const projectId = String(formData.get("projectId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(projectId) || !/^[a-z0-9-]{1,160}$/.test(slug)) throw new Error("Projet invalide.");
  return { projectId, slug };
}
function refresh(slug: string) {
  revalidatePath("/"); revalidatePath("/discographie"); revalidatePath(`/album/${slug}`);
  revalidatePath("/admin"); revalidatePath("/admin/catalogue"); revalidatePath(`/admin/catalogue/${slug}`); revalidatePath("/sitemap.xml");
}

export async function saveCatalogProjectAction(formData: FormData) {
  const { projectId, slug } = validIdentity(formData); await authorize();
  try { await updateCatalogProject(projectId, values(formData)); } catch { redirect(path(slug, "projet-refuse")); }
  refresh(slug); redirect(path(slug, "projet-enregistre"));
}
export async function addCatalogTrackAction(formData: FormData) {
  const { projectId, slug } = validIdentity(formData); await authorize();
  try { await addCatalogTrack(projectId, values(formData)); } catch { redirect(path(slug, "piste-refusee")); }
  refresh(slug); redirect(path(slug, "piste-ajoutee"));
}
export async function saveCatalogTrackAction(formData: FormData) {
  const { projectId, slug } = validIdentity(formData); await authorize();
  try { await updateCatalogTrack(projectId, String(formData.get("trackId") ?? ""), values(formData)); } catch { redirect(path(slug, "piste-refusee")); }
  refresh(slug); redirect(path(slug, "piste-enregistree"));
}
export async function moveCatalogTrackAction(formData: FormData) {
  const { projectId, slug } = validIdentity(formData); await authorize();
  const direction = formData.get("direction") === "up" ? "up" : "down";
  try { await moveCatalogTrack(projectId, String(formData.get("trackId") ?? ""), direction); } catch { redirect(path(slug, "ordre-refuse")); }
  refresh(slug); redirect(path(slug, "ordre-enregistre"));
}
export async function deleteCatalogTrackAction(formData: FormData) {
  const { projectId, slug } = validIdentity(formData); await authorize();
  try { await deleteCatalogTrack(projectId, String(formData.get("trackId") ?? "")); } catch { redirect(path(slug, "suppression-refusee")); }
  refresh(slug); redirect(path(slug, "piste-supprimee"));
}
export async function addCatalogLinkAction(formData: FormData) {
  const { projectId, slug } = validIdentity(formData); await authorize();
  try { await addCatalogPlatformLink(projectId, values(formData)); } catch { redirect(path(slug, "lien-refuse")); }
  refresh(slug); redirect(path(slug, "lien-ajoute"));
}
export async function saveCatalogLinkAction(formData: FormData) {
  const { projectId, slug } = validIdentity(formData); await authorize();
  try { await updateCatalogPlatformLink(projectId, String(formData.get("linkId") ?? ""), values(formData)); } catch { redirect(path(slug, "lien-refuse")); }
  refresh(slug); redirect(path(slug, "lien-enregistre"));
}
export async function deleteCatalogLinkAction(formData: FormData) {
  const { projectId, slug } = validIdentity(formData); await authorize();
  try { await deleteCatalogPlatformLink(projectId, String(formData.get("linkId") ?? "")); } catch { redirect(path(slug, "suppression-refusee")); }
  refresh(slug); redirect(path(slug, "lien-supprime"));
}
