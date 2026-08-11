import { isAllowedRegistrationEmailPayload, normalizeEmail } from "@/lib/auth/input";
import { isSameOriginMutation } from "@/lib/auth/origin";
import { readRegistrationJson, registrationError, registrationJson } from "@/lib/auth/registration-http";
import { registrationClientAddress, requestRegistrationCode } from "@/lib/auth/registration";

export const dynamic = "force-dynamic";

const authBaseUrl = process.env.AUTH_URL ?? process.env.SITE_URL ?? "http://localhost:3000";

export async function POST(request: Request) {
  if (!isSameOriginMutation(request, authBaseUrl)) return registrationJson({ error: "Cette demande ne peut pas être traitée." }, 403);
  const body = await readRegistrationJson(request);
  if (!isAllowedRegistrationEmailPayload(body)) return registrationJson({ error: "Saisissez une adresse email valide." }, 400);

  try {
    const payload = body as { email: string };
    return registrationJson(await requestRegistrationCode(normalizeEmail(payload.email), registrationClientAddress(request)));
  } catch (error) {
    return registrationError(error);
  }
}
