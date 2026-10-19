import path from "node:path";

import { MediaStorageError, type MediaScope, type MediaStorageReference } from "@/lib/media/storage/types";

const publicKey = /^(?:catalog\/(?:covers\/[0-9a-f-]{36}\.webp|audio-previews\/[0-9a-f-]{36}\.mp3|images\/[0-9a-f-]{36}\.(?:webp|avif))|creations\/[0-9a-f-]{36}\/(?:cover|poster)\/[0-9a-f-]{36}\.webp|creations\/[0-9a-f-]{36}\/audio\/[0-9a-f-]{36}\.mp3|creations\/[0-9a-f-]{36}\/video\/[0-9a-f-]{36}\.mp4)$/i;
const privateKey = /^(?:orders\/[0-9a-f-]{36}\/(?:[0-9a-f-]{36}\.webp|deliveries\/[0-9a-f-]{36}\.(?:mp3|wav|flac|zip|pdf|jpg|png)|documents\/[0-9a-f-]{36}\.(?:zip|pdf))|shop-returns\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:jpg|png|webp)|creations\/quarantine\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/(?:video\.mp4|source\.(?:mp4|mov|m4v|webm)))$/i;
const studioKey = /^digital\/studio\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:wav|mp3)$/i;

export function isPrivateStudioStorageKey(key: string) { return studioKey.test(key); }

export function assertMediaStorageKey(scope: MediaScope, key: string) {
  if (key.length > 500 || key.includes("\\") || path.posix.normalize(key) !== key) {
    throw new MediaStorageError("INVALID_KEY", "Invalid media storage key.");
  }
  const accepted = scope === "public" ? publicKey : privateKey;
  const digitalPrivate = scope === "private" && /^(?:digital\/masters\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.(?:wav|mp3|flac)|digital\/derived\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.mp3|digital\/archives\/[0-9a-f-]{36}\/(?:(?:wav|mp3)\/)?[0-9a-f-]{36}\.zip)$/i.test(key);
  const studioPrivate = scope === "private" && isPrivateStudioStorageKey(key);
  if (!accepted.test(key) && !digitalPrivate && !studioPrivate) throw new MediaStorageError("INVALID_KEY", "Invalid media storage key.");
}

export function mediaScopeForVisibility(visibility: "PUBLIC" | "PRIVATE"): MediaScope {
  return visibility === "PUBLIC" ? "public" : "private";
}

/** Studio's short promoted preview may be logically eligible for the existing
 * public route, while its bytes always stay in private storage. Route-specific
 * rights/artistic checks remain mandatory; a PUBLIC flag never widens this key. */
export function mediaScopeForReference(reference: Pick<MediaStorageReference, "storageKey" | "visibility">): MediaScope {
  const scope = isPrivateStudioStorageKey(reference.storageKey) ? "private" : mediaScopeForVisibility(reference.visibility);
  assertMediaStorageKey(scope, reference.storageKey);
  return scope;
}

export function safeContentDisposition(disposition: "inline" | "attachment", filename: string) {
  const basename = path.basename(filename).replace(/[\r\n"\\:;]/g, "-").replace(/[^\x20-\x7e]/g, "-").slice(0, 180) || "media";
  return `${disposition}; filename="${basename}"`;
}
