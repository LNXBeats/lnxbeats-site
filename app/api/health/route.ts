import { NextResponse } from "next/server";

import { validateMediaStorageConfiguration } from "@/lib/media/storage/config";

export const dynamic = "force-dynamic";

export function GET() {
  try {
    validateMediaStorageConfiguration();
  } catch {
    return NextResponse.json(
      { ok: false, service: "lnx-studio", check: "media-storage" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
  return NextResponse.json(
    { ok: true, service: "lnx-studio" },
    { status: 200, headers: { "Cache-Control": "no-store" } },
  );
}
