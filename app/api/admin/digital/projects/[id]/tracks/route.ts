import { moveCatalogTrack, updateCatalogTrack } from "@/lib/catalog/service";
import { assertDigitalUuid, DigitalError } from "@/lib/digital/domain";
import { digitalActor, digitalBody, digitalHttpError, digitalJson, digitalRateLimit } from "@/lib/digital/http";
export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await digitalActor(request, true);
    await digitalRateLimit(actor.id, "catalog-track", 50);
    const { id } = await params; assertDigitalUuid(id);
    const b = await digitalBody(request, ["trackId", "operation", "title", "publication", "durationSeconds"]);
    assertDigitalUuid(b.trackId);
    if (b.operation === "up" || b.operation === "down") await moveCatalogTrack(id, b.trackId, b.operation);
    else if (b.operation === "save") {
      if (typeof b.title !== "string" || !b.title.trim() || b.title.length > 240 || !["released", "announced", "unlisted"].includes(String(b.publication)) || b.durationSeconds !== null && (!Number.isSafeInteger(b.durationSeconds) || Number(b.durationSeconds) < 0 || Number(b.durationSeconds) > 86_400)) throw new DigitalError("INVALID_TRACK");
      await updateCatalogTrack(id, b.trackId, { title: b.title, status: b.publication, durationSeconds: b.durationSeconds === null ? "" : String(b.durationSeconds) });
    } else throw new DigitalError("INVALID_OPERATION");
    return digitalJson({ ok: true });
  } catch (e) { return digitalHttpError(e); }
}
