import { isAllowedRegistrationCompletionPayload } from "@/lib/auth/input";
import { isSameOriginMutation } from "@/lib/auth/origin";
import { readRegistrationJson, registrationError, registrationJson } from "@/lib/auth/registration-http";
import { clearRegistrationProofCookie, completeRegistration, registrationClientAddress } from "@/lib/auth/registration";

export const dynamic = "force-dynamic";

const authBaseUrl = process.env.AUTH_URL ?? process.env.SITE_URL ?? "http://localhost:3000";

export async function POST(request: Request) {
  if (!isSameOriginMutation(request, authBaseUrl)) return registrationJson({ error: "Cette demande ne peut pas être traitée." }, 403);
  const body = await readRegistrationJson(request);
  if (!isAllowedRegistrationCompletionPayload(body)) {
    return registrationJson({ error: "Choisissez deux mots de passe identiques de 12 à 128 caractères." }, 400);
  }

  try {
    const payload = body as { password: string; passwordConfirmation: string };
    await completeRegistration({
      password: payload.password,
      cookieHeader: request.headers.get("cookie"),
      clientAddress: registrationClientAddress(request),
    });
    return registrationJson(
      { completed: true, message: "Votre espace est prêt. Vous pouvez maintenant vous connecter." },
      200,
      clearRegistrationProofCookie(),
    );
  } catch (error) {
    return registrationError(error);
  }
}
