/** Real Studio mutation service qualification against the existing disposable
 * synthetic fixture. No new master, approval, copy, or payment is created. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { prisma } from "@/lib/prisma";
import type { OrderActor } from "@/lib/orders/domain";
import { listStudioJobs, mutateStudioJob } from "@/lib/digital/studio-service";
import { studioHash } from "@/lib/digital/studio-policy";

const url = new URL(process.env.DATABASE_URL ?? "");
assert.equal(url.hostname, "localhost"); assert.equal(url.port, "55546"); assert.equal(url.pathname, "/lnx_studio_synthetic_20261019");
assert.equal(url.username, "studio_owner"); assert.equal(url.searchParams.get("host"), "/private/tmp/lnx-studio-qa-20261019"); assert.equal(url.searchParams.size, 1);
assert.equal(process.env.DCN_MODE, "TEST"); assert.equal(process.env.NODE_ENV, "test"); assert.equal(process.env.MEDIA_STORAGE_DRIVER, "local");
assert.equal(process.env.LNX_STUDIO_ENABLED, "true"); assert.equal(process.env.DCN_NEW_PAYMENTS_ENABLED, "false"); assert.equal(process.env.PAYMENTS_ENABLED, "false");
assert.ok(process.env.STUDIO_RESTORE_ACTION_OUTPUT?.includes("/STABILISATION_20261019/admin/"));
const results: Array<{ name: string; status: "PASS" }> = [];
async function check(name: string, work: () => Promise<void>) { await work(); results.push({ name, status: "PASS" }); console.log(JSON.stringify({ name, status: "PASS" })); }
const tables = ["digital_masters", "digital_offers", "digital_orders", "digital_order_lines", "digital_entitlements", "digital_documents", "digital_download_tickets", "projects", "tracks", "credits", "assets", "digital_uploads", "digital_studio_jobs", "digital_studio_artifacts", "digital_events"] as const;
async function fingerprints() {
  const result: Record<string, { count: number; sha256: string }> = {};
  for (const table of tables) {
    const rows = await prisma.$queryRawUnsafe<Array<{ row: string }>>(`SELECT row_to_json(t)::text AS row FROM public."${table}" t ORDER BY id`);
    result[table] = { count: rows.length, sha256: studioHash(rows.map(row => row.row)) };
  }
  return result;
}
try {
  const source = await prisma.digitalStudioJob.findUniqueOrThrow({ where: { id: "623cf07f-a07c-45a3-b056-d1b1bebf4b0d" } });
  const track = await prisma.track.findUniqueOrThrow({ where: { id: source.trackId }, include: { project: true } });
  assert.equal(source.title, "Ça l’fait — 東京"); assert.equal(source.status, "READY"); assert.equal(source.decision, "APPROVED"); assert.equal(source.sourceLossy, false);
  assert.match(track.project.slug, /^studio-[0-9a-f-]{36}$/); assert.equal(track.project.publicVisible, false);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: source.actorId } });
  const actor: OrderActor = { id: user.id, email: user.email, role: "ADMIN", status: "ACTIVE", emailVerified: true, name: user.displayName };
  const projection = await listStudioJobs(actor, track.projectId), view = projection.jobs.find(job => job.id === source.id);
  assert.ok(view?.restoreAllowed && view.restoreCurrent, "The authoritative current-version projection must allow this old synthetic version");
  const request = { action: "restore", jobId: source.id, expectedBinding: view.binding, expectedCurrentBinding: view.restoreCurrent.binding,
    confirmReplacement: true, confirmExistingPurchases: false, humanListened: false };
  const candidateId = "27b89c2c-b364-4554-bf45-884121b47fc8", candidateBefore = await prisma.digitalStudioJob.findUniqueOrThrow({ where: { id: candidateId } });
  assert.equal(candidateBefore.baseMasterId, view.restoreCurrent.masterId); assert.equal(candidateBefore.status, "READY"); assert.equal(candidateBefore.decision, "PENDING"); assert.equal(candidateBefore.publishedMasterId, null);
  const before = await fingerprints();
  await check("A forged ADMIN actor with no active verified Admin row cannot prepare a return", async () => {
    await assert.rejects(mutateStudioJob({ ...actor, id: randomUUID() }, request), { message: "ADMIN_REQUIRED" });
  });
  await check("Missing current-version binding is rejected by the real mutation parser", async () => {
    const { expectedCurrentBinding: _binding, ...missing } = request; void _binding;
    await assert.rejects(mutateStudioJob(actor, missing), { message: "INVALID_STUDIO_ACTION" });
  });
  await check("Stale old-source and current-version bindings fail closed without jobs or copies", async () => {
    await assert.rejects(mutateStudioJob(actor, { ...request, expectedBinding: "0".repeat(64) }), { message: "STUDIO_VERSION_CHANGED" });
    await assert.rejects(mutateStudioJob(actor, { ...request, expectedCurrentBinding: "0".repeat(64) }), { message: "STUDIO_VERSION_CHANGED" });
  });
  await check("Explicit private-preparation confirmation remains required without claiming a new listening approval", async () => {
    await assert.rejects(mutateStudioJob(actor, { ...request, confirmReplacement: false }), { message: "STUDIO_REPLACEMENT_CONFIRMATION_REQUIRED" });
  });
  await check("The real restore action idempotently returns the existing private PENDING candidate, not a master switch", async () => {
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await mutateStudioJob(actor, request);
      assert.ok("preparationOnly" in result && result.preparationOnly === true && "jobId" in result && result.jobId === candidateId);
      const candidate = result.jobs.find(job => job.id === candidateId); assert.ok(candidate);
      assert.equal(candidate.status, "READY"); assert.equal(candidate.decision, "PENDING"); assert.equal(candidate.approved, false); assert.equal(candidate.publishedMasterId, null);
    }
  });
  await check("All 15 critical, audio, import, Studio and audit tables remain byte-fingerprint identical", async () => {
    assert.deepEqual(await fingerprints(), before);
    assert.equal((await prisma.digitalMaster.findFirstOrThrow({ where: { trackId: source.trackId }, orderBy: { version: "desc" } })).id, view.restoreCurrent.masterId);
  });
  const after = await fingerprints();
  await writeFile(process.env.STUDIO_RESTORE_ACTION_OUTPUT!, JSON.stringify({ status: "PASS", scope: "FIXED_LOCAL_SYNTHETIC_DATABASE_ONLY", actualEntryPoint: "mutateStudioJob action restore",
    authorization: "Accord précis du propriétaire pour les retours de version ; nouvelle candidate privée uniquement, puis future écoute/validation explicite.",
    noHttpSessionClaim: true, noProductionAccess: true, noPaymentApi: true, noNewHumanApproval: true, noMasterSwitch: true,
    reusedSyntheticSourceJobId: source.id, currentMasterId: view.restoreCurrent.masterId, reusedPrivateCandidateId: candidateId,
    candidateDecision: "PENDING", candidatePublishedMasterId: null, tests: results, before, after }, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ status: "PASS", tests: results.length, candidateId, noDatabaseMutation: true }));
} finally { await prisma.$disconnect(); }
