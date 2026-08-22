import { handleQaAccessLogin } from "@/lib/auth/qa-access-route-handler";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export function POST(request: Request) {
  return handleQaAccessLogin(request);
}
