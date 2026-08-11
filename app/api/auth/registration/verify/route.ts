import { isAllowedRegistrationCodePayload } from "@/lib/auth/input";
import { isSameOriginMutation } from "@/lib/auth/origin";
import { readRegistrationJson, registrationError, registrationJson } from "@/lib/auth/registration-http";
import { registrationClientAddress, registrationProofCookie, verifyRegistrationCode } from "@/lib/auth/registration";

export const dynamic = "force-dynamic";

const authBaseUrl = process.env.AUTH_URL ?? process.env.SITE_URL ?? "http://localhost:3000";

export async function POST(request: Request) {
  if (!isSameOriginMutation(request, authBaseUrl)) return registrationJson({ error: "Cette demande ne peut pas être traitée." }, 403);
  const body = await readRegistrationJson(request);
  if (!isAllowedRegistrationCodePayload(body)) return registrationJson({ error: "Saisissez les six chiffres du code." }, 400);

  try {
    const payload = body as { attemptId: string; code: string };
    const result = await verifyRegistrationCode({ ...payload, clientAddress: registrationClientAddress(request) });
    if (result.next === "code") {
      return registrationJson({
        next: "code",
        attemptsRemaining: result.attemptsRemaining,
        error: result.attemptsRemaining > 0
          ? `Ce code n’est pas valide. ${result.attemptsRemaining} essai${result.attemptsRemaining > 1 ? "s" : ""} restant${result.attemptsRemaining > 1 ? "s" : ""}.`
          : "Ce code n’est plus valable. Demandez-en un nouveau.",
      }, 400);
    }
    if (result.next === "login") {
      return registrationJson({ next: "login", message: "Cette adresse possède déjà un espace. Vous pouvez vous connecter ou réinitialiser votre mot de passe." });
    }
    return registrationJson(
      { next: "password", maskedEmail: result.maskedEmail },
      200,
      registrationProofCookie(payload.attemptId, result.proof),
    );
  } catch (error) {
    return registrationError(error);
  }
}
