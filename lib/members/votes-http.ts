import { isSameOriginMutation } from "@/lib/auth/origin";
import { DigitalError, digitalUuid } from "@/lib/digital/domain";
import { readReleaseAlertText } from "@/lib/release-notifications/http";
import { premiereMemberAllowed } from "./premiere-policy";
import type { PremiereVoteChoice, PremiereVoter } from "./votes";
export type PremiereVoteDependencies = { baseUrl: string; user(): Promise<PremiereVoter | null>; rateLimit?(userId: string, write: boolean): Promise<void>;
  get(actor: PremiereVoter, projectId: string, binding: string): Promise<unknown>; save(actor: PremiereVoter, projectId: string, choice: PremiereVoteChoice, binding: string): Promise<unknown> };
const headers = { "Cache-Control": "private, no-store", "Vary": "Cookie", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" };
const json = (data: unknown, status = 200) => Response.json(data, { status, headers });
function failure(error: unknown) { return json({ ok: false }, error instanceof DigitalError ? error.status : 503); }
export async function handlePremiereVoteGet(request: Request, dependencies: PremiereVoteDependencies) {
  try {
    const actor = await dependencies.user(); if (!premiereMemberAllowed(actor)) return json({ ok: false }, 401);
    const params = new URL(request.url).searchParams, projectId = params.get("projet"), binding = params.get("version");
    if (params.size !== 2 || !digitalUuid(projectId) || !binding || !/^[a-f0-9]{64}$/.test(binding)) return json({ ok: false }, 400);
    await dependencies.rateLimit?.(actor!.id, false);
    return json({ ok: true, ...await dependencies.get(actor!, projectId, binding) as object });
  } catch (error) { return failure(error); }
}
export async function handlePremiereVotePatch(request: Request, dependencies: PremiereVoteDependencies) {
  if (!isSameOriginMutation(request, dependencies.baseUrl)) return json({ ok: false }, 403);
  try {
    const actor = await dependencies.user(); if (!premiereMemberAllowed(actor)) return json({ ok: false }, 401);
    if (!request.headers.get("content-type")?.startsWith("application/json")) return json({ ok: false }, 400);
    const raw = await readReleaseAlertText(request); if (raw === null) return json({ ok: false }, 400);
    let body; try { body = JSON.parse(raw); } catch { return json({ ok: false }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length !== 3 || !digitalUuid(body.projectId)
      || typeof body.binding !== "string" || !/^[a-f0-9]{64}$/.test(body.binding)
      || !(body.choice === null || body.choice === "UP" || body.choice === "DOWN")) return json({ ok: false }, 400);
    await dependencies.rateLimit?.(actor!.id, true);
    return json({ ok: true, ...await dependencies.save(actor!, body.projectId, body.choice, body.binding) as object });
  } catch (error) { return failure(error); }
}
