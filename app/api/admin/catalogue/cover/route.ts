import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { isSameOriginMutation } from "@/lib/auth/origin";
import { requireAdmin } from "@/lib/auth/session";
import { CatalogCoverError, replaceCatalogCover } from "@/lib/catalog/cover";
import { CatalogCoverRequestError, readCatalogCoverFormData } from "@/lib/catalog/cover-request";
import { CatalogConflictError } from "@/lib/catalog/service";

export const runtime = "nodejs";

function destination(baseUrl: string, slug: string, state: string) {
  return new URL(`/admin/catalogue/${encodeURIComponent(slug)}?etat=${encodeURIComponent(state)}`, baseUrl);
}

function expectsJson(request: Request) {
  return request.headers.get("x-lnx-cover-upload") === "browser" && request.headers.get("accept")?.includes("application/json");
}

function result(request: Request, baseUrl: string, slug: string, state: string, status = 400) {
  const location = destination(baseUrl, slug, state).toString();
  const responseStatus = state === "cover-enregistree" ? 200 : status;
  const json = expectsJson(request);
  if (json) return NextResponse.json({ ok: state === "cover-enregistree", state, location }, { status: responseStatus });
  return NextResponse.redirect(location, 303);
}

function referringSlug(request: Request, baseUrl: string) {
  const referer = request.headers.get("referer");
  if (!referer) return null;
  try {
    const url = new URL(referer);
    if (url.origin !== new URL(baseUrl).origin) return null;
    const match = url.pathname.match(/^\/admin\/catalogue\/([a-z0-9-]{1,160})$/);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

function coverErrorState(error: unknown) {
  if (error instanceof CatalogCoverRequestError) return error.code === "TRANSPORT_TOO_LARGE" ? "cover-trop-lourde" : "cover-invalide";
  if (error instanceof CatalogConflictError) return "cover-conflit";
  if (!(error instanceof CatalogCoverError)) return "cover-erreur";
  if (error.code === "FILE_TOO_LARGE") return "cover-trop-lourde";
  if (error.code === "EMPTY_FILE") return "cover-vide";
  if (error.code === "UNREADABLE_IMAGE") return "cover-illisible";
  if (error.code === "TOO_MANY_PIXELS") return "cover-dimensions";
  return "cover-format";
}

function refresh(slug: string) {
  revalidatePath("/");
  revalidatePath("/discographie");
  revalidatePath(`/album/${slug}`);
  revalidatePath("/admin");
  revalidatePath("/admin/catalogue");
  revalidatePath(`/admin/catalogue/${slug}`);
  revalidatePath("/sitemap.xml");
}

export async function POST(request: Request) {
  const baseUrl = process.env.AUTH_URL ?? process.env.SITE_URL ?? "http://127.0.0.1:3000";
  if (!isSameOriginMutation(request, baseUrl)) return new Response(null, { status: 403 });
  await requireAdmin();

  let formData: FormData;
  try {
    formData = await readCatalogCoverFormData(request);
  } catch (error) {
    const slug = referringSlug(request, baseUrl);
    if (slug) return result(request, baseUrl, slug, coverErrorState(error));
    return expectsJson(request) ? NextResponse.json({ ok: false, state: "cover-invalide" }, { status: 400 }) : NextResponse.redirect(new URL("/admin/catalogue", baseUrl), 303);
  }

  const projectId = String(formData.get("projectId") ?? "");
  const slug = String(formData.get("slug") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(projectId) || !/^[a-z0-9-]{1,160}$/.test(slug)) {
    return NextResponse.redirect(new URL("/admin/catalogue", baseUrl), 303);
  }

  if (formData.get("rightsConfirmed") !== "on") {
    return result(request, baseUrl, slug, "cover-droits");
  }
  const file = formData.get("cover");
  if (!(file instanceof File)) {
    return result(request, baseUrl, slug, "cover-vide");
  }

  try {
    await replaceCatalogCover(projectId, formData.get("updatedAt"), file, formData.get("alt"));
  } catch (error) {
    return result(request, baseUrl, slug, coverErrorState(error), error instanceof CatalogConflictError ? 409 : 422);
  }

  refresh(slug);
  return result(request, baseUrl, slug, "cover-enregistree", 200);
}
