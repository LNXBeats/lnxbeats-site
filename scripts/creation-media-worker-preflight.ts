import "server-only";

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { catalogFfmpegPath } from "@/lib/catalog/ffmpeg";
import { processNextCreationVideoValidation, cleanupTerminalCreationVideoQuarantine } from "@/lib/creations/direct-upload-worker";
import { expireAbandonedCreationVideoUploads } from "@/lib/creations/direct-upload-service";
import { prisma } from "@/lib/prisma";
import { processNextDeliveryValidation, cleanupDeliveryUploadSessions } from "@/lib/orders/delivery-direct-worker";

// Import the real worker graph under the same TS loader and server-only
// condition as runtime. Never start polling, connect to DB or touch R2 here.
assert.equal(typeof processNextCreationVideoValidation, "function");
assert.equal(typeof cleanupTerminalCreationVideoQuarantine, "function");
assert.equal(typeof expireAbandonedCreationVideoUploads, "function");
assert.equal(typeof prisma.creationMediaUploadSession.findFirst, "function");
assert.equal(typeof prisma.orderDeliveryUploadSession.findFirst, "function");
assert.equal(typeof processNextDeliveryValidation, "function");
assert.equal(typeof cleanupDeliveryUploadSessions, "function");
const encoders = execFileSync(catalogFfmpegPath(), ["-hide_banner", "-encoders"], {
  encoding: "utf8", timeout: 15_000, maxBuffer: 512 * 1024, stdio: ["ignore", "pipe", "ignore"],
});
assert.match(encoders, /\blibx264\b/);
assert.match(encoders, /\baac\b/);
console.log("[creation-media-worker] Build preflight PASS: TS graph, Prisma, FFmpeg H.264/AAC; no DB/R2 access.");
