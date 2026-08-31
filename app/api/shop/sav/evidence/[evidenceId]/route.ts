import { readFile } from "node:fs/promises";

import { NextResponse } from "next/server";

import { getAuthSession } from "@/lib/auth/session";
import { getAuthorizedShopReturnEvidence } from "@/lib/shop/evidence-service";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ evidenceId: string }> }) {
  const session = await getAuthSession();
  if (!session?.user) return new NextResponse("Accès refusé", { status: 403 });
  try {
    const { evidence, absolute } = await getAuthorizedShopReturnEvidence({
      id: session.user.id,
      role: session.user.role,
      status: session.user.status,
      emailVerified: session.user.emailVerified,
    }, (await context.params).evidenceId);
    const body = await readFile(absolute);
    return new NextResponse(body, {
      headers: {
        "Content-Type": evidence.mimeType,
        "Content-Disposition": `inline; filename="evidence-${evidence.id}"`,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow, noarchive",
      },
    });
  } catch {
    return new NextResponse("Introuvable", { status: 404 });
  }
}
