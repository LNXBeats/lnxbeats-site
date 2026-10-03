import { normalizePaypalWebhookEvent } from "@/lib/payments/paypal-webhook";
import { boundedSupportText, supportHttpError, supportJson } from "@/lib/support/http";
import { verifySupportPaypalWebhook } from "@/lib/support/providers";
import { reconcileSupportEvidence, validSupportId } from "@/lib/support/service";
import { prisma } from "@/lib/prisma";
import { SupportError } from "@/lib/support/config";
export const runtime = "nodejs";
export async function POST(request: Request) {
  try {
    const raw = await boundedSupportText(request, 262144);
    const headers = {
      transmissionId: request.headers.get("paypal-transmission-id") ?? "",
      transmissionTime: request.headers.get("paypal-transmission-time") ?? "",
      certUrl: request.headers.get("paypal-cert-url") ?? "",
      authAlgo: request.headers.get("paypal-auth-algo") ?? "",
      transmissionSignature: request.headers.get("paypal-transmission-sig") ?? "",
    };
    if (Object.values(headers).some((v) => !v || v.length > 4096)
      || !/^https:\/\/api\.sandbox\.paypal\.com\/v1\/notifications\/certs\/[A-Za-z0-9_-]+$/.test(headers.certUrl)
      || !await verifySupportPaypalWebhook(raw, headers)) return supportJson({ error: "Signature refusée." }, 400);
    const event = JSON.parse(raw);
    if (typeof event.id !== "string" || event.id.length > 200) return supportJson({ error: "Événement invalide." }, 400);
    const evidence = normalizePaypalWebhookEvent(event);
    if (evidence && "captureId" in evidence && evidence.captureId && "providerOrderId" in evidence
      && typeof evidence.amountCents === "number" && evidence.currency === "EUR") {
      let value = await prisma.supportContribution.findUnique({ where: { providerReference: evidence.providerOrderId } });
      if (!value && evidence.paymentId && validSupportId(evidence.paymentId)) {
        value = await prisma.supportContribution.findUnique({ where: { id: evidence.paymentId } });
        if (value && !value.providerReference) throw new SupportError("UNAVAILABLE");
      }
      if (value && evidence.paymentId && evidence.paymentId !== value.id) throw new SupportError("INVALID");
      if (value && validSupportId(value.id)) await reconcileSupportEvidence({ contributionId: value.id, provider: "PAYPAL",
        providerReference: evidence.providerOrderId, paymentReference: evidence.captureId,
        amountCents: evidence.amountCents, currency: evidence.currency,
        status: evidence.status === "COMPLETED" ? "SUCCEEDED" : evidence.status === "PENDING" ? "PENDING" : "FAILED",
      }, `paypal:${event.id}`);
    }
    return supportJson({ received: true });
  } catch (error) { return supportHttpError(error); }
}
