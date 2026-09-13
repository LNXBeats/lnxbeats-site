import "server-only";

import { isSameOriginMutation } from "@/lib/auth/origin";
import {
  CREATION_MEDIA_DELETION_CONFIRMATION,
  type CreationMediaRole,
} from "@/lib/creations/media-contract";
import type { CreationMediaUpload } from "@/lib/creations/media-request";
import {
  CreationMediaRequestError,
  readCreationMediaJson,
  readCreationMediaUpload,
} from "@/lib/creations/media-request";
import {
  CreationMediaConflictError,
  CreationMediaError,
  deleteAdminCreationMedia,
  replaceAdminCreationMedia,
} from "@/lib/creations/media-service";

type AdminSession = { user: { id: string } };

export type CreationMediaMutationDependencies = Readonly<{
  baseUrl(): string;
  sameOrigin(request: Request, baseUrl: string): boolean;
  admin(): Promise<AdminSession>;
  readUpload(request: Request): Promise<CreationMediaUpload>;
  readJson(request: Request): Promise<unknown>;
  replace(upload: CreationMediaUpload): Promise<{ assetId: string; slug: string; lockVersion: number }>;
  remove(input: Parameters<typeof deleteAdminCreationMedia>[0]): Promise<{ slug: string; lockVersion: number }>;
}>;

export function createCreationMediaMutationDependencies(
  admin: CreationMediaMutationDependencies["admin"],
): CreationMediaMutationDependencies {
  return {
    baseUrl: () => process.env.AUTH_URL ?? process.env.SITE_URL ?? "http://127.0.0.1:3000",
    sameOrigin: isSameOriginMutation,
    admin,
    readUpload: readCreationMediaUpload,
    readJson: readCreationMediaJson,
    replace: replaceAdminCreationMedia,
    remove: deleteAdminCreationMedia,
  };
}

function json(body: object, status = 200) {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function adminLocation(baseUrl: string, slug: string, state: string) {
  return new URL(`/admin/creations/${encodeURIComponent(slug)}?etat=${encodeURIComponent(state)}`, baseUrl).toString();
}

function errorResponse(error: unknown) {
  if (error instanceof CreationMediaRequestError) {
    const tooLarge = error.code === "FILE_TOO_LARGE";
    const state = tooLarge ? "media-trop-lourd"
      : error.code === "EMPTY_FILE" ? "media-vide"
        : error.code === "UNSUPPORTED_FORMAT" ? "media-format"
          : error.code === "DECODE_FAILED" ? "media-illisible"
            : "media-invalide";
    return json({ ok: false, state }, tooLarge ? 413 : 400);
  }
  if (error instanceof CreationMediaConflictError) {
    return json({
      ok: false,
      state: "media-conflit",
      currentAssetId: error.currentAssetId,
      currentLockVersion: error.currentLockVersion,
    }, 409);
  }
  if (error instanceof CreationMediaError) {
    const state = error.code === "RIGHTS_CONFIRMATION_REQUIRED" ? "media-droits"
      : error.code === "NOT_FOUND" ? "media-creation-absente"
        : error.code === "ARCHIVED" ? "media-creation-archivee"
          : error.code === "NO_MEDIA" ? "media-absent"
            : error.code === "PUBLISHED_INVARIANT" ? "media-publication-bloquee"
              : error.code === "INVALID_IDENTITY" || error.code === "INVALID_VERSION" ? "media-invalide"
                : "media-stockage";
    const status = error.code === "NOT_FOUND" ? 404
      : error.code === "ARCHIVED" || error.code === "PUBLISHED_INVARIANT" ? 409
        : error.code === "INVALID_IDENTITY" || error.code === "INVALID_VERSION" ? 400
          : 422;
    return json({ ok: false, state }, status);
  }
  return json({ ok: false, state: "media-erreur" }, 500);
}

async function authorize(request: Request, dependencies: CreationMediaMutationDependencies) {
  const baseUrl = dependencies.baseUrl();
  if (!dependencies.sameOrigin(request, baseUrl)) return null;
  await dependencies.admin();
  return baseUrl;
}

function creationMediaRole(value: unknown): CreationMediaRole | null {
  return value === "COVER" || value === "VIDEO_POSTER" || value === "AUDIO" || value === "VIDEO"
    ? value
    : null;
}

function closedDeletionPayload(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const object = value as Record<string, unknown>;
  const expected = ["creationId", "slug", "role", "expectedLockVersion", "expectedAssetId", "confirmation"];
  if (Object.keys(object).length !== expected.length || Object.keys(object).some((key) => !expected.includes(key))) return null;
  const role = creationMediaRole(object.role);
  if (
    !role
    || typeof object.creationId !== "string"
    || typeof object.slug !== "string"
    || typeof object.expectedLockVersion !== "number"
    || typeof object.expectedAssetId !== "string"
    || object.confirmation !== CREATION_MEDIA_DELETION_CONFIRMATION
  ) return null;
  return {
    creationId: object.creationId,
    slug: object.slug,
    role,
    expectedLockVersion: object.expectedLockVersion,
    expectedAssetId: object.expectedAssetId,
  };
}

export async function handleCreationMediaUpload(
  request: Request,
  dependencies: CreationMediaMutationDependencies,
) {
  const baseUrl = await authorize(request, dependencies);
  if (!baseUrl) return json({ ok: false }, 403);
  let upload: CreationMediaUpload | null = null;
  try {
    upload = await dependencies.readUpload(request);
    const result = await dependencies.replace(upload);
    return json({
      ok: true,
      state: "media-enregistre",
      currentAssetId: result.assetId,
      currentLockVersion: result.lockVersion,
      location: adminLocation(baseUrl, result.slug, "media-enregistre"),
    });
  } catch (error) {
    return errorResponse(error);
  } finally {
    await upload?.cleanup().catch(() => undefined);
  }
}

export async function handleCreationMediaDelete(
  request: Request,
  dependencies: CreationMediaMutationDependencies,
) {
  const baseUrl = await authorize(request, dependencies);
  if (!baseUrl) return json({ ok: false }, 403);
  try {
    const input = closedDeletionPayload(await dependencies.readJson(request));
    if (!input) return json({ ok: false, state: "media-confirmation" }, 400);
    const result = await dependencies.remove(input);
    return json({
      ok: true,
      state: "media-supprime",
      currentAssetId: null,
      currentLockVersion: result.lockVersion,
      location: adminLocation(baseUrl, result.slug, "media-supprime"),
    });
  } catch (error) {
    return errorResponse(error);
  }
}
