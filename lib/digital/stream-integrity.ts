import { createHash } from "node:crypto";
import { DigitalError } from "./domain";
/** A bounded stream verifier. Archives cannot become READY after corrupt or truncated source bytes. */
export function verifiedDigitalStream(body: ReadableStream<Uint8Array>, size: number, sha256: string) {
  if (!Number.isSafeInteger(size) || size < 1 || !/^[a-f0-9]{64}$/.test(sha256)) throw new DigitalError("ARCHIVE_INTEGRITY");
  const reader = body.getReader(), hash = createHash("sha256"); let received = 0;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (next.done) {
          if (received !== size || hash.digest("hex") !== sha256) throw new DigitalError("ARCHIVE_INTEGRITY");
          reader.releaseLock(); controller.close(); return;
        }
        received += next.value.byteLength;
        if (received > size) throw new DigitalError("ARCHIVE_INTEGRITY");
        hash.update(next.value); controller.enqueue(next.value);
      } catch (error) { await reader.cancel().catch(() => undefined); controller.error(error); }
    },
    async cancel(reason) { await reader.cancel(reason); },
  }, { highWaterMark: 65536, size: chunk => chunk.byteLength });
}
