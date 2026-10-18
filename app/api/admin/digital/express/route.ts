import { digitalActor, digitalBody, digitalHttpError, digitalJson, digitalRateLimit } from "@/lib/digital/http";
import { loadExpressDefaults, loadExpressProject, loadExpressManifest, publishExpressProject, saveExpressDefaults, saveExpressDraft, addExpressArtist } from "@/lib/digital/express-service";
import { DigitalError } from "@/lib/digital/domain";
import { revalidatePath } from "next/cache";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  try {
    const actor = await digitalActor(request, true); await digitalRateLimit(actor.id, "express-read", 60);
    const id = new URL(request.url).searchParams.get("projectId");
    if (id && new URL(request.url).searchParams.get("manifeste") === "1") {
      const response = digitalJson(await loadExpressManifest(id)); response.headers.set("Content-Disposition", 'attachment; filename="manifeste-technique-prive.json"'); return response;
    }
    return digitalJson(id ? { project: await loadExpressProject(id) } : { defaults: await loadExpressDefaults() });
  } catch (e) { return digitalHttpError(e); }
}
export async function POST(request: Request) {
  try {
    const actor = await digitalActor(request, true); await digitalRateLimit(actor.id, "express-write", 30);
    const b = await digitalBody(request, ["operation", "input"], 65536);
    if (b.operation === "defaults") return digitalJson({ defaults: await saveExpressDefaults(actor, b.input) });
    if (b.operation === "artist") {
      const v = b.input as Record<string, unknown>;
      if (!v || typeof v !== "object" || Array.isArray(v) || Object.keys(v).some(k => !["projectId", "name"].includes(k))) throw new DigitalError("EXPRESS_INVALID");
      return digitalJson({ project: await addExpressArtist(actor, { projectId: v.projectId as string, name: v.name as string }) });
    }
    if (b.operation === "draft") { const saved = await saveExpressDraft(actor, b.input); return digitalJson({ ...saved, project: await loadExpressProject(saved.projectId) }); }
    if (b.operation === "publish") {
      if (!b.input || typeof b.input !== "object" || Array.isArray(b.input)) throw new DigitalError("EXPRESS_INVALID");
      const v = b.input as Record<string, unknown>;
      if (Object.keys(v).some(k => !["projectId", "reviewToken", "confirmed", "idempotencyKey", "rightsDeclaration"].includes(k)) || typeof v.reviewToken !== "string" || v.rightsDeclaration !== undefined && typeof v.rightsDeclaration !== "string") throw new DigitalError("EXPRESS_INVALID");
      const result = await publishExpressProject(actor, { projectId: v.projectId as string, reviewToken: v.reviewToken, confirmed: v.confirmed === true, idempotencyKey: v.idempotencyKey as string, rightsDeclaration: v.rightsDeclaration as string | undefined });
      const project = await loadExpressProject(v.projectId as string);
      for (const path of ["/", "/discographie", "/admin/musique", `/album/${project.slug}`, "/sitemap.xml"]) revalidatePath(path);
      return digitalJson({ ...result, project });
    }
    throw new DigitalError("EXPRESS_INVALID");
  } catch (e) { return digitalHttpError(e); }
}
