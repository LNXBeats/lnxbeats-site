import { requireAdmin } from "@/lib/auth/session";
import { createDirectUploadRouteDependencies, handleDirectUploadOperation } from "@/lib/creations/direct-upload-route-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const dependencies = createDirectUploadRouteDependencies(requireAdmin);
export function POST(request: Request) { return handleDirectUploadOperation(request, "status", dependencies); }
