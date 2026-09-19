import "server-only";

import { isSameOriginMutation } from "@/lib/auth/origin";
import { parseCreationDirectUploadInit, CreationDirectUploadError } from "@/lib/creations/direct-upload-domain";
import {
  abortCreationVideoUpload,
  completeCreationVideoUpload,
  createCreationVideoPartUrl,
  directUploadStatusResponse,
  getCreationVideoUploadStatus,
  initializeCreationVideoUpload,
} from "@/lib/creations/direct-upload-service";

type AdminSession = { user: { id: string } };
type Operation = "init" | "part-url" | "status" | "complete" | "abort";

export type DirectUploadRouteDependencies = {
  baseUrl(): string;
  sameOrigin(request: Request, baseUrl: string): boolean;
  admin(): Promise<AdminSession>;
  initialize: typeof initializeCreationVideoUpload;
  partUrl: typeof createCreationVideoPartUrl;
  status: typeof getCreationVideoUploadStatus;
  complete: typeof completeCreationVideoUpload;
  abort: typeof abortCreationVideoUpload;
};

export function createDirectUploadRouteDependencies(admin: () => Promise<AdminSession>): DirectUploadRouteDependencies {
  return {
    baseUrl: () => process.env.AUTH_URL ?? process.env.SITE_URL ?? "http://127.0.0.1:3000",
    sameOrigin: isSameOriginMutation,
    admin,
    initialize: initializeCreationVideoUpload,
    partUrl: createCreationVideoPartUrl,
    status: getCreationVideoUploadStatus,
    complete: completeCreationVideoUpload,
    abort: abortCreationVideoUpload,
  };
}

function json(body: object, status = 200, retryAfter?: number) {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      ...(retryAfter ? { "retry-after": String(retryAfter) } : {}),
    },
  });
}

async function readSmallJson(request: Request) {
  const declared = request.headers.get("content-length");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > 16_384)) {
    throw new CreationDirectUploadError("INVALID_REQUEST");
  }
  if (!request.body) throw new CreationDirectUploadError("INVALID_REQUEST");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16_384) throw new CreationDirectUploadError("INVALID_REQUEST");
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel("bounded JSON body rejected").catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown; }
  catch { throw new CreationDirectUploadError("INVALID_REQUEST"); }
}

function closedTokenBody(value: unknown, extras: readonly string[] = []) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CreationDirectUploadError("INVALID_REQUEST");
  const record = value as Record<string, unknown>;
  const fields = new Set(["sessionToken", ...extras]);
  if (Object.keys(record).some((key) => !fields.has(key)) || Object.keys(record).length !== fields.size) {
    throw new CreationDirectUploadError("INVALID_REQUEST");
  }
  return record;
}

function errorResponse(error: unknown) {
  if (!(error instanceof CreationDirectUploadError)) return json({ ok: false, state: "media-erreur" }, 500);
  const state = error.code === "FILE_TOO_LARGE" ? "media-trop-lourd"
    : error.code === "UNSUPPORTED_FORMAT" ? "media-format"
      : error.code === "MEDIA_CONFLICT" ? "media-conflit"
        : error.code === "SESSION_EXPIRED" ? "media-expire"
          : error.code === "INVALID_STATE" ? "media-etat"
            : error.code === "STORAGE_INTEGRITY" || error.code === "INCOMPLETE_UPLOAD" ? "media-stockage"
              : "media-invalide";
  const status = error.code === "MEDIA_CONFLICT" || error.code === "INVALID_STATE" ? 409
    : error.code === "SESSION_EXPIRED" ? 410
      : error.code === "FILE_TOO_LARGE" ? 413
        : error.code === "INVALID_SESSION" ? 404
          : 400;
  return json({ ok: false, state }, status);
}

export async function handleDirectUploadOperation(
  request: Request,
  operation: Operation,
  dependencies: DirectUploadRouteDependencies,
) {
  const baseUrl = dependencies.baseUrl();
  if (!dependencies.sameOrigin(request, baseUrl)) return json({ ok: false }, 403);
  const admin = await dependencies.admin();
  try {
    const body = await readSmallJson(request);
    if (operation === "init") {
      const session = await dependencies.initialize({ actorUserId: admin.user.id, media: parseCreationDirectUploadInit(body) });
      return json(directUploadStatusResponse(session, [], baseUrl));
    }
    if (operation === "part-url") {
      const input = closedTokenBody(body, ["partNumber"]);
      return json(await dependencies.partUrl({ actorUserId: admin.user.id, sessionToken: input.sessionToken, partNumber: input.partNumber }));
    }
    if (operation === "status") {
      const input = closedTokenBody(body);
      return json(await dependencies.status({ actorUserId: admin.user.id, sessionToken: input.sessionToken, baseUrl }), 200, 3);
    }
    if (operation === "complete") {
      const input = closedTokenBody(body, ["parts"]);
      return json(await dependencies.complete({ actorUserId: admin.user.id, sessionToken: input.sessionToken, parts: input.parts, baseUrl }), 200, 3);
    }
    const input = closedTokenBody(body);
    return json(await dependencies.abort({ actorUserId: admin.user.id, sessionToken: input.sessionToken, baseUrl }));
  } catch (error) {
    return errorResponse(error);
  }
}
