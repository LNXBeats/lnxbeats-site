import assert from "node:assert/strict";

export const PHASE5E_PREVIEW_BUILD_PROOF_VERSION = 1;

export type Phase5EPreviewBuildProof = Readonly<{
  version: typeof PHASE5E_PREVIEW_BUILD_PROOF_VERSION;
  head: string;
  tree: string;
  buildId: string;
  worktree: string;
  target: string;
  origin: string;
}>;

type Phase5EPreviewBuildIdentity = Omit<Phase5EPreviewBuildProof, "version">;

export function parsePhase5EPreviewBuildProof(value: string): Phase5EPreviewBuildProof {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("La preuve du build Phase 5E est illisible.");
  }
  assert.ok(parsed && typeof parsed === "object" && !Array.isArray(parsed), "La preuve du build Phase 5E est invalide.");
  return parsed as Phase5EPreviewBuildProof;
}

export function assertPhase5EPreviewBuildProof(
  proof: Phase5EPreviewBuildProof,
  current: Phase5EPreviewBuildIdentity,
): void {
  assert.equal(proof.version, PHASE5E_PREVIEW_BUILD_PROOF_VERSION, "Version de preuve Phase 5E inattendue.");
  assert.match(current.head, /^[0-9a-f]{40,64}$/, "HEAD Git Phase 5E invalide.");
  assert.match(current.tree, /^[0-9a-f]{40,64}$/, "Tree Git Phase 5E invalide.");
  assert.ok(current.buildId.length > 0, "BUILD_ID Phase 5E absent.");
  assert.equal(proof.head, current.head, "La preview Phase 5E n’a pas été construite depuis le HEAD courant.");
  assert.equal(proof.tree, current.tree, "La preview Phase 5E ne correspond pas au tree Git courant.");
  assert.equal(proof.buildId, current.buildId, "Le BUILD_ID Phase 5E ne correspond pas à la preuve enregistrée.");
  assert.equal(proof.worktree, current.worktree, "La preview Phase 5E provient d’un autre worktree.");
  assert.equal(proof.target, current.target, "La preview Phase 5E provient d’une autre cible QA.");
  assert.equal(proof.origin, current.origin, "La preview Phase 5E provient d’une autre origine.");
}
