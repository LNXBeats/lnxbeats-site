import { revalidatePath } from "next/cache";
import { NextResponse } from "next/server";

import { isSameOriginMutation } from "@/lib/auth/origin";
import { requireAdmin } from "@/lib/auth/session";
import {
  CatalogAudioConflictError,
  CatalogAudioError,
  catalogAudioRightsConfirmed,
  deleteCatalogAudioPreview,
  generateAndReplaceCatalogAudioPreview,
} from "@/lib/catalog/audio";
import { CatalogAudioRequestError, readCatalogAudioUpload } from "@/lib/catalog/audio-request";
import { removeAudioTempFile } from "@/lib/catalog/audio-temp";

export const runtime = "nodejs";

function refresh(slug: string) {
  revalidatePath("/");
  revalidatePath("/discographie");
  revalidatePath(`/album/${slug}`);
  revalidatePath("/admin");
  revalidatePath("/admin/catalogue");
  revalidatePath(`/admin/catalogue/${slug}`);
}

function audioErrorState(error: unknown) {
  if (error instanceof CatalogAudioRequestError) {
    if (error.code === "TRANSPORT_TOO_LARGE" || error.code === "FILE_TOO_LARGE") return "audio-trop-lourd";
    if (error.code === "EMPTY_FILE") return "audio-vide";
    if (error.code === "UNSUPPORTED_FORMAT") return "audio-format";
    return "audio-invalide";
  }
  if (error instanceof CatalogAudioConflictError) return "audio-conflit";
  if (!(error instanceof CatalogAudioError)) return "audio-erreur";
  if (error.code === "UNREADABLE_AUDIO") return "audio-illisible";
  if (error.code === "GENERATION_FAILED") return "audio-generation";
  if (error.code === "INVALID_OFFSET") return "audio-debut";
  if (error.code === "INVALID_DURATION") return "audio-duree";
  if (error.code === "NO_AUDIO") return "audio-absent";
  if (error.code === "INVALID_VERSION") return "audio-invalide";
  return "audio-format";
}

function response(state: string, status: number, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: status >= 200 && status < 300, state, ...extra }, { status });
}

function validIdentity(projectId: string, slug: string) {
  return /^[0-9a-f-]{36}$/i.test(projectId) && /^[a-z0-9-]{1,160}$/.test(slug);
}

function trustedBaseUrl() {
  return process.env.AUTH_URL ?? process.env.SITE_URL ?? "http://127.0.0.1:3000";
}

export async function POST(request: Request) {
  const baseUrl = trustedBaseUrl();
  if (!isSameOriginMutation(request, baseUrl)) return new Response(null, { status: 403 });
  await requireAdmin();

  let upload;
  try {
    upload = await readCatalogAudioUpload(request);
  } catch (error) {
    const state = audioErrorState(error);
    return response(state, state === "audio-trop-lourd" ? 413 : 400);
  }

  const { projectId, slug } = upload;
  if (!validIdentity(projectId, slug)) {
    await removeAudioTempFile(upload.source.path).catch(() => undefined);
    return response("audio-invalide", 400);
  }
  if (!catalogAudioRightsConfirmed(upload.rightsConfirmed)) {
    await removeAudioTempFile(upload.source.path).catch(() => undefined);
    return response("audio-droits", 422);
  }

  try {
    const generated = await generateAndReplaceCatalogAudioPreview({
      projectId,
      rawExpectedAudioAssetId: upload.expectedAudioAssetId,
      sourcePath: upload.source.path,
      rawOffsetMs: upload.offsetMs,
      rawRequestedDurationMs: upload.requestedDurationMs,
    });
    refresh(slug);
    return response("audio-enregistre", 200, {
      currentAudioAssetId: generated.asset.id,
      sourceDurationMs: generated.sourceDurationMs,
      durationMs: generated.durationMs,
      offsetMs: generated.offsetMs,
      adjustedToSourceEnd: generated.adjustedToSourceEnd,
      location: `/admin/catalogue/${encodeURIComponent(slug)}?etat=audio-enregistre`,
    });
  } catch (error) {
    await removeAudioTempFile(upload.source.path).catch(() => undefined);
    const state = audioErrorState(error);
    const status = error instanceof CatalogAudioConflictError ? 409 : state === "audio-trop-lourd" ? 413 : 422;
    return response(state, status, error instanceof CatalogAudioConflictError ? { currentAudioAssetId: error.currentAudioAssetId } : {});
  }
}

export async function DELETE(request: Request) {
  const baseUrl = trustedBaseUrl();
  if (!isSameOriginMutation(request, baseUrl)) return new Response(null, { status: 403 });
  await requireAdmin();
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isSafeInteger(declaredLength) || declaredLength < 0 || declaredLength > 8_192) return response("audio-invalide", 400);

  let payload: unknown;
  try { payload = await request.json(); }
  catch { return response("audio-invalide", 400); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return response("audio-invalide", 400);
  const input = payload as Record<string, unknown>;
  const projectId = typeof input.projectId === "string" ? input.projectId : "";
  const slug = typeof input.slug === "string" ? input.slug : "";
  if (!validIdentity(projectId, slug)) return response("audio-invalide", 400);

  try {
    await deleteCatalogAudioPreview(projectId, input.expectedAudioAssetId);
    refresh(slug);
    return response("audio-supprime", 200, {
      currentAudioAssetId: null,
      location: `/admin/catalogue/${encodeURIComponent(slug)}?etat=audio-supprime`,
    });
  } catch (error) {
    const state = audioErrorState(error);
    const status = error instanceof CatalogAudioConflictError ? 409 : 422;
    return response(state, status, error instanceof CatalogAudioConflictError ? { currentAudioAssetId: error.currentAudioAssetId } : {});
  }
}
