import "server-only";

import {
  cleanupTerminalCreationVideoQuarantine,
  processNextCreationVideoValidation,
} from "@/lib/creations/direct-upload-worker";
import { expireAbandonedCreationVideoUploads } from "@/lib/creations/direct-upload-service";

const pollMs = 3_000;
let stopping = false;
const shutdown = new AbortController();

if (process.env.CREATION_MEDIA_WORKER_ENABLED !== "true") {
  throw new Error("CREATION_MEDIA_WORKER_ENABLED=true is required.");
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    stopping = true;
    shutdown.abort();
  });
}

function waitForNextPoll() {
  if (shutdown.signal.aborted) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(done, pollMs);
    function done() {
      clearTimeout(timer);
      shutdown.signal.removeEventListener("abort", done);
      resolve();
    }
    shutdown.signal.addEventListener("abort", done, { once: true });
  });
}

while (!stopping) {
  const result = await processNextCreationVideoValidation(new Date(), { signal: shutdown.signal });
  await cleanupTerminalCreationVideoQuarantine();
  await expireAbandonedCreationVideoUploads();
  if (!result.processed) await waitForNextPoll();
}
