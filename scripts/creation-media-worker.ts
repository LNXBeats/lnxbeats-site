import "server-only";

import {
  cleanupTerminalCreationVideoQuarantine,
  processNextCreationVideoValidation,
} from "@/lib/creations/direct-upload-worker";
import { expireAbandonedCreationVideoUploads } from "@/lib/creations/direct-upload-service";

const pollMs = 3_000;
let stopping = false;

if (process.env.CREATION_MEDIA_WORKER_ENABLED !== "true") {
  throw new Error("CREATION_MEDIA_WORKER_ENABLED=true is required.");
}

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => { stopping = true; });
}

while (!stopping) {
  const result = await processNextCreationVideoValidation();
  await cleanupTerminalCreationVideoQuarantine();
  await expireAbandonedCreationVideoUploads();
  if (!result.processed) await new Promise((resolve) => setTimeout(resolve, pollMs));
}
