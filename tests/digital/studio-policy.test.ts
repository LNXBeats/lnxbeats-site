import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { studioAcquiredAccessEnabled, requireStudioAcquiredAccess, studioBinding, studioEnabled, studioHash, studioMutation, STUDIO_PRODUCTION_CONFIRM } from "../../lib/digital/studio-policy";

test("HTTP init forwards only the explicit Studio opt-in to its gated upload service", () => {
  const route = readFileSync("app/api/admin/digital/tracks/[id]/[operation]/route.ts", "utf8");
  assert.match(route, /initDigitalUpload\(actor,id,await digitalBody\(request,\["filename","mimeType","sizeBytes","expectedVersion","previewStartMs","replaceConfirmed","studio"\]\)\)/);
  const service = readFileSync("lib/digital/upload.ts", "utf8");
  assert.match(service, /typeof raw\.studio !== "boolean"/);
  assert.match(service, /if \(studio\) requireStudioEnvironment\(\)/);
});

test("Studio TEST preparation requires opt-in and rejects mixed Production overrides", () => {
  const qa = { DCN_ENABLED: "true", DCN_MODE: "TEST", NODE_ENV: "test", LNX_STUDIO_ENABLED: "true" };
  assert.equal(studioEnabled(qa), true);
  for (const change of [{ LNX_STUDIO_ENABLED: "false" }, { NODE_ENV: "production" }, { DCN_MODE: "LIVE" }, { RAILWAY_ENVIRONMENT_NAME: "production" }, { MEDIA_DEPLOYMENT_ENV: "production" }]) assert.equal(studioEnabled({ ...qa, ...change }), false);
});
test("Production preparation is closed by default and requires its dedicated exact release confirmation", () => {
  const live = { DCN_ENABLED: "true", DCN_MODE: "LIVE", NODE_ENV: "production", RAILWAY_ENVIRONMENT_NAME: "production",
    MEDIA_DEPLOYMENT_ENV: "production", PAYMENT_DEPLOYMENT_ENV: "production", DCN_STORAGE_MODE: "OBJECT",
    PAYMENT_PRODUCTION_CONFIRM: "payments-production-live-approved" };
  assert.equal(studioEnabled(live), false);
  assert.equal(studioEnabled({ ...live, LNX_STUDIO_ENABLED: "true" }), false);
  const approved = { ...live, LNX_STUDIO_ENABLED: "true", LNX_STUDIO_RELEASE_CONFIRM: STUDIO_PRODUCTION_CONFIRM };
  assert.equal(studioEnabled(approved), true);
  for (const override of [{ LNX_STUDIO_ENABLED: "false" }, { LNX_STUDIO_RELEASE_CONFIRM: "true" }, { LNX_STUDIO_RELEASE_CONFIRM: "" },
    { DCN_MODE: "TEST" }, { DCN_ENABLED: "false" }, { NODE_ENV: "test" }, { RAILWAY_ENVIRONMENT_NAME: "staging" },
    { DCN_STORAGE_MODE: "LOCAL" }, { DCN_EXTERNAL_TEST_AUTHORIZED: "true" }, { DCN_LOCAL_REVIEW_AUTHORIZED: "true" },
    { PAYMENT_PRODUCTION_CONFIRM: "" }]) assert.equal(studioEnabled({ ...approved, ...override }), false);
});
test("suspending Studio preparation and new payments preserves acquired reads in valid TEST and LIVE", () => {
  const testRuntime = { DCN_ENABLED: "true", DCN_MODE: "TEST", NODE_ENV: "test", LNX_STUDIO_ENABLED: "false",
    DCN_NEW_PAYMENTS_ENABLED: "false", PAYMENTS_ENABLED: "false" };
  const liveRuntime = { ...testRuntime, DCN_MODE: "LIVE", NODE_ENV: "production", RAILWAY_ENVIRONMENT_NAME: "production",
    MEDIA_DEPLOYMENT_ENV: "production", PAYMENT_DEPLOYMENT_ENV: "production", DCN_STORAGE_MODE: "OBJECT",
    PAYMENT_PRODUCTION_CONFIRM: "payments-production-live-approved" };
  for (const env of [testRuntime, liveRuntime]) {
    assert.equal(studioEnabled(env), false);
    assert.equal(studioAcquiredAccessEnabled(env), true);
    assert.doesNotThrow(() => requireStudioAcquiredAccess(env));
    const withoutPreparationFlag: Record<string, string | undefined> = { ...env };
    delete withoutPreparationFlag.LNX_STUDIO_ENABLED;
    assert.equal(studioAcquiredAccessEnabled(withoutPreparationFlag), true);
  }
});
test("acquired Studio reads remain fail-closed outside a valid digital runtime", () => {
  const live = { DCN_ENABLED: "true", DCN_MODE: "LIVE", NODE_ENV: "production", RAILWAY_ENVIRONMENT_NAME: "production",
    MEDIA_DEPLOYMENT_ENV: "production", PAYMENT_DEPLOYMENT_ENV: "production", DCN_STORAGE_MODE: "OBJECT",
    PAYMENT_PRODUCTION_CONFIRM: "payments-production-live-approved", LNX_STUDIO_ENABLED: "true" };
  for (const env of [{}, { DCN_ENABLED: "false", DCN_MODE: "TEST" }, { DCN_ENABLED: "true", DCN_MODE: "TEST", MEDIA_DEPLOYMENT_ENV: "production" },
    { ...live, DCN_STORAGE_MODE: "LOCAL" }, { ...live, PAYMENT_PRODUCTION_CONFIRM: "" }, { ...live, DCN_LOCAL_REVIEW_AUTHORIZED: "true" },
    { ...live, RAILWAY_ENVIRONMENT_NAME: "staging" }, { ...live, DCN_EXTERNAL_TEST_AUTHORIZED: "true" }]) {
    assert.equal(studioAcquiredAccessEnabled(env), false);
    assert.throws(() => requireStudioAcquiredAccess(env), { message: "DIGITAL_CLOSED" });
  }
});
test("customer Studio reads use their acquisition gate without enabling preparation or bypassing existing checks", () => {
  const customer = readFileSync("lib/digital/studio-client.ts", "utf8");
  assert.match(customer, /if \(!studioAcquiredAccessEnabled\(\) \|\| !masterIds\.length\) return result/);
  assert.match(customer, /requireStudioAcquiredAccess\(\); assertDigitalUuid\(jobId\)/);
  assert.doesNotMatch(customer, /\bstudioEnabled\(|\brequireStudioEnvironment\(/);
  for (const guard of ["ownedDigitalLine(userId, lineId)", "studioBinding(job, job.artifacts) !== job.binding", "studioAcquisitionAllowed({", "loadDigitalRightsReviews(prisma, published)"])
    assert.ok(customer.includes(guard));
});
test("Studio decisions require an exact binding and do not coerce listening or rights", () => {
  const input = { action: "approve", jobId: "11111111-1111-4111-8111-111111111111", expectedBinding: "a".repeat(64), humanListened: "true" };
  assert.equal(studioMutation(input).humanListened, false);
  assert.throws(() => studioMutation({ ...input, approveRights: true }));
  assert.throws(() => studioMutation({ ...input, expectedBinding: "old" }));
  assert.throws(() => studioMutation({ ...input, jobId: "../../../private" }));
});
test("return preparation binds BOTH the approved source and exact current master without granting approval", () => {
  const input = { action: "restore", jobId: "11111111-1111-4111-8111-111111111111", expectedBinding: "a".repeat(64), expectedCurrentBinding: "b".repeat(64) };
  const parsed = studioMutation(input);
  assert.equal(parsed.expectedCurrentBinding, input.expectedCurrentBinding);
  assert.equal(parsed.humanListened, false);
  assert.equal(parsed.confirmReplacement, false);
  assert.throws(() => studioMutation({ ...input, expectedCurrentBinding: undefined }));
  assert.throws(() => studioMutation({ ...input, expectedCurrentBinding: "stale" }));
  assert.throws(() => studioMutation({ ...input, action: "approve" }));
  const service = readFileSync("lib/digital/studio-service.ts", "utf8");
  assert.match(service, /const prepared = await prepareStudioRestore\(actor, input\)/);
  assert.match(service, /preparationOnly: true/);
});
test("Studio binding pins exact Unicode title, source, report and all format bytes", () => {
  const job = { id: "job", trackId: "track", uploadId: "upload", attempt: 1, sourceAssetId: "source", sourceSha256: "1".repeat(64), title: "Ça l’fait — 東京", album: "Été", metadata: { composer: "Auteur réel" }, report: { measurements: { truePeak: -1.2 } } };
  const artifacts = [{ role: "WAV_CD", assetId: "cd", asset: { checksumSha256: "2".repeat(64), sizeBytes: 100n, durationMs: 50, mimeType: "audio/wav" }, metadataVerified: true }];
  const hash = studioBinding(job, artifacts);
  assert.equal(hash.length, 64);
  assert.notEqual(studioBinding({ ...job, title: "Ça l’fait — 东京" }, artifacts), hash);
  assert.notEqual(studioBinding({ ...job, sourceSha256: "3".repeat(64) }, artifacts), hash);
  assert.notEqual(studioBinding({ ...job, report: { measurements: { truePeak: -1 } } }, artifacts), hash);
  assert.notEqual(studioBinding(job, [{ ...artifacts[0], asset: { ...artifacts[0].asset, checksumSha256: "4".repeat(64) } }]), hash);
  assert.equal(studioHash({ a: 1, b: 2 }), studioHash({ b: 2, a: 1 }));
});
