import "server-only";

import { creationMediaResponse, type CreationMediaAsset } from "@/lib/creations/media-response";
import { parseCreationIdentity } from "@/lib/creations/validation";

type PublicMediaDependencies = {
  findPublishedAsset(assetId: string): Promise<CreationMediaAsset | null>;
};

export async function handlePublicCreationMediaRequest(
  request: Request,
  assetId: unknown,
  head: boolean,
  dependencies: PublicMediaDependencies,
) {
  let strictAssetId: string;
  try {
    strictAssetId = parseCreationIdentity(assetId);
  } catch {
    return new Response(null, { status: 404 });
  }
  const asset = await dependencies.findPublishedAsset(strictAssetId);
  if (!asset) return new Response(null, { status: 404 });
  return creationMediaResponse(request, asset, head);
}
