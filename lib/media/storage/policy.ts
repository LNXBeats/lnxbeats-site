import path from "node:path";

import { MediaStorageError, type MediaScope } from "@/lib/media/storage/types";

const publicKey = /^catalog\/(?:covers\/[0-9a-f-]{36}\.webp|audio-previews\/[0-9a-f-]{36}\.mp3|images\/[0-9a-f-]{36}\.(?:webp|avif))$/i;
const privateKey = /^orders\/[0-9a-f-]{36}\/(?:[0-9a-f-]{36}\.webp|deliveries\/[0-9a-f-]{36}\.(?:mp3|wav)|documents\/[0-9a-f-]{36}\.(?:zip|pdf))$/i;

export function assertMediaStorageKey(scope: MediaScope, key: string) {
  if (key.length > 500 || key.includes("\\") || path.posix.normalize(key) !== key) {
    throw new MediaStorageError("INVALID_KEY", "Invalid media storage key.");
  }
  const accepted = scope === "public" ? publicKey : privateKey;
  if (!accepted.test(key)) throw new MediaStorageError("INVALID_KEY", "Invalid media storage key.");
}

export function mediaScopeForVisibility(visibility: "PUBLIC" | "PRIVATE"): MediaScope {
  return visibility === "PUBLIC" ? "public" : "private";
}

export function safeContentDisposition(disposition: "inline" | "attachment", filename: string) {
  const basename = path.basename(filename).replace(/[\r\n"\\:;]/g, "-").replace(/[^\x20-\x7e]/g, "-").slice(0, 180) || "media";
  return `${disposition}; filename="${basename}"`;
}
