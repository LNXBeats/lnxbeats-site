import { digitalActor, digitalBody, digitalHttpError, digitalJson, digitalRateLimit } from "@/lib/digital/http";
import { prepareExistingStudioSources } from "@/lib/digital/studio-existing-source";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** An explicit selection of exact existing versions, never a catalogue-wide
 * approval, upload restart, or commercial publication endpoint. */
export async function POST(request: Request) {
  try {
    const actor = await digitalActor(request, true);
    await digitalRateLimit(actor.id, "studio-existing-prepare", 5);
    const input = await digitalBody(request, ["sources"], 131072);
    return digitalJson(await prepareExistingStudioSources(actor, input));
  } catch (error) { return digitalHttpError(error); }
}
