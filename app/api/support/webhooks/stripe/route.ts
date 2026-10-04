import { boundedSupportText, supportHttpError, supportJson } from "@/lib/support/http";
import { stripeSupportEvidence, verifySupportStripeWebhook } from "@/lib/support/providers";
import { reconcileSupportEvidence } from "@/lib/support/service";
import { requireSupportEnvironment } from "@/lib/support/config";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const raw = await boundedSupportText(request, 262144);
    let event;
    try { event = await verifySupportStripeWebhook(raw, request.headers.get("stripe-signature") ?? ""); }
    catch { return supportJson({ error: "Signature refusée." }, 400); }
    const evidence = stripeSupportEvidence(event, requireSupportEnvironment());
    if (evidence) await reconcileSupportEvidence(evidence, `stripe:${event.id}`);
    return supportJson({ received: true });
  } catch (error) { return supportHttpError(error); }
}
