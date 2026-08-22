import "server-only";

import { isSameOriginMutation } from "@/lib/auth/origin";
import {
  AUTH_QA_ACCESS_SECRET_HEADER,
  ensureQaAccessProfiles,
  enforceQaAccessRateLimit,
  parseQaAccessConfiguration,
  parseQaAccessPayload,
  QA_ACCESS_PROFILES,
  qaAccessSecretMatches,
  QaAccessCollisionError,
  QaAccessRateLimitError,
  QaAccessUnavailableError,
  type QaAccessConfiguration,
  type QaAccessProfile,
} from "@/lib/auth/qa-access";
import { createQaAccessSession } from "@/lib/auth/qa-access-session";

const MAX_QA_ACCESS_BODY_BYTES = 1_024;
const MAX_QA_ACCESS_SECRET_BYTES = 1_024;

export type QaAccessRouteDependencies = Readonly<{
  configuration(): QaAccessConfiguration;
  allowedOrigin(request: Request, baseUrl: string): boolean;
  rateLimit(): Promise<void>;
  ensureProfiles(secret: string): Promise<Readonly<Record<QaAccessProfile, string>>>;
  createSession(request: Request, configuration: QaAccessConfiguration, profile: QaAccessProfile): Promise<readonly string[]>;
  log(event: "qa.auth.login.success" | "qa.auth.login.denied", fields: Readonly<Record<string, string | null>>): void;
}>;

const routeDependencies: QaAccessRouteDependencies = {
  configuration: parseQaAccessConfiguration,
  allowedOrigin: isSameOriginMutation,
  rateLimit: enforceQaAccessRateLimit,
  ensureProfiles: ensureQaAccessProfiles,
  createSession: createQaAccessSession,
  log(event, fields) {
    console.info(JSON.stringify({ event, ...fields }));
  },
};

function json(body: object, status: number, cookies: readonly string[] = []) {
  const headers = new Headers({ "cache-control": "no-store", "content-type": "application/json" });
  for (const cookie of cookies) headers.append("set-cookie", cookie);
  return Response.json(body, { status, headers });
}

function logDenied(dependencies: QaAccessRouteDependencies, profile: QaAccessProfile | null) {
  dependencies.log("qa.auth.login.denied", {
    profile,
    occurredAt: new Date().toISOString(),
  });
}

async function boundedJson(request: Request) {
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  if (contentType !== "application/json") return null;
  const declared = request.headers.get("content-length");
  if (declared !== null) {
    const length = Number(declared);
    if (!Number.isSafeInteger(length) || length < 0 || length > MAX_QA_ACCESS_BODY_BYTES) return null;
  }
  if (!request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_QA_ACCESS_BODY_BYTES) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(chunks, received).toString("utf8")) as unknown;
  } catch {
    return null;
  }
}

export async function handleQaAccessLogin(
  request: Request,
  dependencies: QaAccessRouteDependencies = routeDependencies,
) {
  let configuration: QaAccessConfiguration;
  try {
    configuration = dependencies.configuration();
  } catch (error) {
    if (error instanceof QaAccessUnavailableError) return json({ ok: false }, 404);
    return json({ ok: false }, 404);
  }

  if (!dependencies.allowedOrigin(request, configuration.baseUrl)) {
    logDenied(dependencies, null);
    return json({ ok: false, error: "Accès QA refusé." }, 403);
  }

  try {
    await dependencies.rateLimit();
  } catch (error) {
    logDenied(dependencies, null);
    return json(
      { ok: false, error: "Accès QA temporairement indisponible." },
      error instanceof QaAccessRateLimitError ? 429 : 503,
    );
  }

  const profile = parseQaAccessPayload(await boundedJson(request));
  const candidate = request.headers.get(AUTH_QA_ACCESS_SECRET_HEADER) ?? "";
  if (
    candidate.length > MAX_QA_ACCESS_SECRET_BYTES
    || !qaAccessSecretMatches(candidate, configuration.secret)
  ) {
    logDenied(dependencies, profile);
    return json({ ok: false, error: "Accès QA refusé." }, 401);
  }

  if (!profile) {
    logDenied(dependencies, null);
    return json({ ok: false, error: "Accès QA refusé." }, 400);
  }

  try {
    const profiles = await dependencies.ensureProfiles(configuration.secret);
    const cookies = await dependencies.createSession(request, configuration, profile);
    const userId = profiles[profile];
    dependencies.log("qa.auth.login.success", {
      profile,
      userId,
      occurredAt: new Date().toISOString(),
    });
    return json({ ok: true, redirectTo: QA_ACCESS_PROFILES[profile].redirectTo }, 200, cookies);
  } catch (error) {
    logDenied(dependencies, profile);
    return json(
      { ok: false, error: "Accès QA temporairement indisponible." },
      error instanceof QaAccessCollisionError ? 409 : 503,
    );
  }
}
