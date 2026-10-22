import { isSameOriginMutation } from "@/lib/auth/origin";
import { parseReleaseAlertChoices, type ReleaseAlertChoices } from "@/lib/release-notifications/domain";

type SessionUser = { id: string; status: string; emailVerified: boolean };
export type ReleaseAlertHttpDependencies = {
  baseUrl: string;
  user(): Promise<SessionUser | null>;
  get(userId: string): Promise<unknown>;
  save(userId: string, choices: ReleaseAlertChoices): Promise<unknown>;
};
const headers = { "Cache-Control": "private, no-store", "Referrer-Policy": "no-referrer" };
const json = (body: unknown, status = 200) => Response.json(body, { status, headers });
const verified = (user: SessionUser | null) => user?.status === "ACTIVE" && user.emailVerified === true;

export async function readReleaseAlertText(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > 2048 || !request.body) return null;
  const reader = request.body.getReader();
  let size = 0; const chunks: Uint8Array[] = [];
  try {
    while (true) { const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength; if (size > 2048) { await reader.cancel(); return null; } chunks.push(value);
    }
    const bytes = new Uint8Array(size); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return new TextDecoder().decode(bytes);
  } catch { return null; } finally { reader.releaseLock(); }
}
async function readBody(request: Request) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) return null;
  const raw = await readReleaseAlertText(request);
  if (raw === null) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
export async function handleReleaseAlertGet(dependencies: ReleaseAlertHttpDependencies) {
  try {
    const user = await dependencies.user(); if (!verified(user)) return json({ ok: false }, 401);
    return json({ ok: true, preferences: await dependencies.get(user!.id) });
  } catch { return json({ ok: false }, 503); }
}
export async function handleReleaseAlertPatch(request: Request, dependencies: ReleaseAlertHttpDependencies) {
  if (!isSameOriginMutation(request, dependencies.baseUrl)) return json({ ok: false }, 403);
  try {
    const user = await dependencies.user(); if (!verified(user)) return json({ ok: false }, 401);
    const choices = parseReleaseAlertChoices(await readBody(request));
    if (!choices) return json({ ok: false }, 400);
    // No client-provided user ID is accepted; always bind to the verified session.
    return json({ ok: true, preferences: await dependencies.save(user!.id, choices) });
  } catch { return json({ ok: false }, 503); }
}

export type ReleaseUnsubscribeDependencies = {
  verify(token: unknown): string | null;
  unsubscribe(userId: string): Promise<unknown>;
};
export async function handleReleaseAlertUnsubscribe(request: Request, dependencies: ReleaseUnsubscribeDependencies) {
  let userId: string | null;
  try {
    const raw = await readReleaseAlertText(request); if (raw === null) return json({ ok: false }, 400);
    const contentType = request.headers.get("content-type") ?? "";
    let token: unknown;
    if (contentType.startsWith("application/json")) {
      const value: unknown = JSON.parse(raw);
      token = value && typeof value === "object" && !Array.isArray(value) ? (value as { token?: unknown }).token : undefined;
    } else if (contentType.startsWith("application/x-www-form-urlencoded") && new URLSearchParams(raw).get("List-Unsubscribe") === "One-Click") {
      token = new URL(request.url).searchParams.get("token");
    }
    userId = dependencies.verify(token);
    if (!userId) return json({ ok: false }, 400);
  } catch { return json({ ok: false }, 400); }
  try {
    await dependencies.unsubscribe(userId);
    return json({ ok: true });
  } catch {
    // A valid withdrawal must be retried after infrastructure failure, not
    // rejected as malformed. Never expose a DB, token or provider error.
    return Response.json({ ok: false }, { status: 503, headers: { ...headers, "Retry-After": "60" } });
  }
}
