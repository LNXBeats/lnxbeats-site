import { registrationJson } from "@/lib/auth/registration-http";
import { registrationContinuationState } from "@/lib/auth/registration";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    return registrationJson(await registrationContinuationState(request.headers.get("cookie")));
  } catch {
    return registrationJson({ stage: "email" });
  }
}
