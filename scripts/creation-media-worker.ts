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
  try {
    const result = await processNextCreationVideoValidation(new Date(), { signal: shutdown.signal });
    await cleanupTerminalCreationVideoQuarantine();
    await expireAbandonedCreationVideoUploads();
    if (!result.processed) await waitForNextPoll();
  } catch (error) {
    // Web and worker deployments can overlap. In particular, the worker may
    // briefly start before the Web pre-deploy has applied an additive schema
    // migration. Treat every failed poll as retryable so a transient database
    // or object-storage outage cannot put the worker into a crash loop. The
    // next successful cycle remains authoritative for state transitions.
    console.error(
      "[creation-media-worker] Cycle failed; retrying after the poll interval.",
      error instanceof Error ? error.message : "Unknown worker error.",
    );
    await waitForNextPoll();
  }
}
