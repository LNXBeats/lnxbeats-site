import { digitalActor, digitalBody, digitalHttpError, digitalJson, digitalRateLimit } from "@/lib/digital/http";
import { loadExpressCollaborations, saveExpressCollaboration } from "@/lib/digital/express-collaborations";
import { DigitalError } from "@/lib/digital/domain";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const actor = await digitalActor(request, true); await digitalRateLimit(actor.id, "express-collaborations-read", 60);
    return digitalJson(await loadExpressCollaborations(new URL(request.url).searchParams.get("projectId") ?? ""));
  } catch (error) { return digitalHttpError(error); }
}
export async function POST(request: Request) {
  let operation: unknown;
  try {
    const actor = await digitalActor(request, true); await digitalRateLimit(actor.id, "express-collaborations-write", 30);
    const body = await digitalBody(request, ["input"], 8192);
    if (body.input && typeof body.input === "object" && !Array.isArray(body.input)) operation = (body.input as Record<string, unknown>).operation;
    return digitalJson(await saveExpressCollaboration(actor, body.input));
  } catch (error) {
    if (error instanceof DigitalError && error.code === "EXPRESS_DUPLICATE") return digitalJson({ code: error.code, error: operation === "credit"
      ? "Cet artiste est déjà enregistré avec ce rôle pour cette sortie ou cette piste. Modifiez le crédit existant plutôt que d’en créer un doublon."
      : "Ce lien est déjà utilisé, ou un lien de cette plateforme et de ce type existe pour cette sortie. Vérifiez les liens existants avant de réessayer." }, error.status);
    return digitalHttpError(error);
  }
}
