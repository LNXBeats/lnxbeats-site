import "server-only";
import assert from "node:assert/strict";
import { runDigitalWorkerCycle } from "./digital-media-worker";
import { digitalReconciliationDependencies } from "./digital-reconcile";
import { processDigitalArchives } from "@/lib/digital/archive-worker";
import { processDigitalMedia } from "@/lib/digital/media-worker";

// Import the actual runtime graph with the same loader. No loop, DB connection,
// provider request, email, object access, FFmpeg execution or data mutation.
assert.equal(typeof runDigitalWorkerCycle, "function");
assert.equal(typeof digitalReconciliationDependencies.recoverOrder, "function");
assert.equal(typeof digitalReconciliationDependencies.recoverRefund, "function");
assert.equal(typeof processDigitalArchives, "function");
assert.equal(typeof processDigitalMedia, "function");
console.log("[digital-worker] Build preflight PASS: bounded graph imported; no DB/PSP/media access.");
