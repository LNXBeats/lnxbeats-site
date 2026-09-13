import { revalidatePath } from "next/cache";

import { requireAdmin } from "@/lib/auth/session";
import {
  createCreationMediaMutationDependencies,
  handleCreationMediaDelete,
  handleCreationMediaUpload,
} from "@/lib/creations/media-route-handler";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const dependencies = createCreationMediaMutationDependencies(requireAdmin);

async function refresh(response: Response) {
  if (!response.ok) return;
  revalidatePath("/admin");
  revalidatePath("/admin/creations");
  revalidatePath("/creations");
  revalidatePath("/sitemap.xml");
  const payload = await response.clone().json().catch(() => null) as { location?: string } | null;
  const location = payload?.location;
  if (!location) return;
  try {
    const slug = new URL(location).pathname.match(/^\/admin\/creations\/([a-z0-9-]+)$/)?.[1];
    if (slug) {
      revalidatePath(`/admin/creations/${slug}`);
      revalidatePath(`/creations/${slug}`);
    }
  } catch {
    // The response is still complete if optional path revalidation cannot be
    // derived. The list and sitemap paths above remain invalidated.
  }
}

export async function POST(request: Request) {
  const response = await handleCreationMediaUpload(request, dependencies);
  await refresh(response);
  return response;
}

export async function DELETE(request: Request) {
  const response = await handleCreationMediaDelete(request, dependencies);
  await refresh(response);
  return response;
}
