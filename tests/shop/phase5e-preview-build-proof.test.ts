import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  assertPhase5EPreviewBuildProof,
  parsePhase5EPreviewBuildProof,
  PHASE5E_PREVIEW_BUILD_PROOF_VERSION,
  type Phase5EPreviewBuildProof,
} from "@/lib/shop/phase5e-preview-build-proof";

const identity = {
  head: "1".repeat(40),
  tree: "2".repeat(40),
  buildId: "phase5e-build-id",
  worktree: "/private/tmp/lnxbeats-v110-production-readiness-worktree",
  target: "lnx-studio-v110-production-readiness-preview-test",
  origin: "http://127.0.0.1:31780",
};

function proof(overrides: Partial<Phase5EPreviewBuildProof> = {}): Phase5EPreviewBuildProof {
  return { version: PHASE5E_PREVIEW_BUILD_PROOF_VERSION, ...identity, ...overrides };
}

test("guarded Phase 5E start accepts only its exact committed build identity", () => {
  assert.doesNotThrow(() => assertPhase5EPreviewBuildProof(proof(), identity));
  for (const changed of [
    { head: "3".repeat(40) },
    { tree: "4".repeat(40) },
    { buildId: "stale-build" },
    { worktree: "/private/tmp/other-worktree" },
    { target: "other-target" },
    { origin: "http://127.0.0.1:3000" },
  ]) assert.throws(() => assertPhase5EPreviewBuildProof(proof(changed), identity));
});

test("guarded Phase 5E build proof rejects malformed JSON", () => {
  assert.throws(() => parsePhase5EPreviewBuildProof("not-json"), /illisible/);
});

test("Phase 5E preview command records build identity and verifies it before start", async () => {
  const source = await readFile(new URL("../../scripts/shop-phase5e-preview.ts", import.meta.url), "utf8");
  assert.match(source, /gitValue\("rev-parse", "HEAD"\)/);
  assert.match(source, /gitValue\("rev-parse", "HEAD\^\{tree\}"\)/);
  assert.match(source, /writeFile\(BUILD_PROOF_PATH/);
  assert.match(source, /parsePhase5EPreviewBuildProof\(await readFile\(BUILD_PROOF_PATH/);
  assert.match(source, /assertPhase5EPreviewBuildProof\(proof, identity\)/);
  assert.match(source, /git", \["diff", "--quiet", "HEAD", "--"\]/);
});
