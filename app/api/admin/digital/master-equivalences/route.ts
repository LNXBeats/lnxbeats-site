import { digitalActor, digitalBody, digitalHttpError, digitalJson, digitalRateLimit } from "@/lib/digital/http";
import { getDigitalMasterEquivalencePair, listDigitalMasterEquivalences, recordDigitalMasterEquivalence } from "@/lib/digital/master-equivalence-service";

export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const actor = await digitalActor(request, true);
    await digitalRateLimit(actor.id, "master-equivalence-read", 30);
    const url = new URL(request.url);
    const source = url.searchParams.getAll("sourceMasterId"), target = url.searchParams.getAll("targetMasterId");
    if ([...url.searchParams.keys()].some(key => !["trackId", "sourceMasterId", "targetMasterId"].includes(key)) || url.searchParams.getAll("trackId").length !== 1 || source.length > 1 || target.length > 1 || source.length !== target.length) return digitalJson({ error: "Choisissez une piste canonique et, pour lire une paire, ses deux versions exactes." }, 400);
    const trackId = url.searchParams.get("trackId") ?? "";
    return digitalJson(source.length ? await getDigitalMasterEquivalencePair(actor, trackId, source[0], target[0]) : await listDigitalMasterEquivalences(actor, trackId));
  } catch (error) { return digitalHttpError(error); }
}
export async function POST(request: Request) {
  try {
    const actor = await digitalActor(request, true);
    await digitalRateLimit(actor.id, "master-equivalence-write", 20);
    const body = await digitalBody(request, ["trackId", "sourceMasterId", "targetMasterId", "status", "expectedReviewId", "privateEvidenceReference", "evidenceSha256", "attested", "reason", "idempotencyKey"]);
    return digitalJson(await recordDigitalMasterEquivalence(actor, body));
  } catch (error) { return digitalHttpError(error); }
}
