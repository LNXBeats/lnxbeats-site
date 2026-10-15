/** Local, real route handlers + PostgreSQL + bounded FFmpeg, not a browser/provider recipe.
 * Reuses the existing synthetic private-edition fixture. Never selects a passage for VIE DE CHIEN.
 * Run: NODE_OPTIONS=--conditions=react-server node --import tsx scripts/test-digital-excerpt-runtime.ts
 */
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertSafeDigitalLocalPostgresUrl } from "@/lib/digital/local-review-database";
import type { DigitalExcerptInput, DigitalExcerptSelection } from "@/lib/digital/excerpt-policy";

// No PSP, hosted storage, remote mail or inherited Production credentials enter this process.
for (const key of Object.keys(process.env)) if (/STRIPE|PAYPAL|RESEND|RAILWAY|S3|R2|AWS|SMTP/i.test(key)) delete process.env[key];
const config = JSON.parse(await readFile(".private/dcn-france-commercial-config.json", "utf8")) as Record<string, string>;
const target = assertSafeDigitalLocalPostgresUrl(config.DATABASE_URL);
assert.equal(target.hostname, "127.0.0.1"); assert.equal(target.port, "55473");
assert.equal(target.pathname, "/lnx_dcn_france_commercial_test_20261015"); assert.equal(target.username, "dcn_runtime_a");
assert.equal(target.searchParams.get("options"), "-c timezone=UTC");
assert.equal(config.MEDIA_STORAGE_DRIVER, "local"); assert.equal(config.EMAIL_PROVIDER, "capture");
assert.equal(config.DCN_MODE, "TEST"); assert.equal(config.DCN_NEW_PAYMENTS_ENABLED, "false");
for (const key of Object.keys(config)) assert.doesNotMatch(key, /STRIPE|PAYPAL|RESEND|RAILWAY|S3|R2|AWS|SMTP/i);
for (const key of ["MEDIA_LOCAL_PRIVATE_ROOT", "MEDIA_LOCAL_PUBLIC_ROOT", "DCN_WORK_ROOT"]) assert.ok(config[key]?.startsWith("/private/tmp/lnx-dcn-"));
const base = new URL(config.AUTH_URL);
assert.equal(base.protocol, "http:"); assert.equal(base.hostname, "127.0.0.1"); assert.equal(base.port, "3140");
Object.assign(process.env, config, { DCN_ENABLED: "true", DCN_MODE: "TEST", DCN_EXTERNAL_TEST_AUTHORIZED: "false", DCN_NEW_PAYMENTS_ENABLED: "false", DCN_LOCAL_REVIEW_AUTHORIZED: "true" });
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
  assert.equal(url.origin, base.origin, "Only the existing loopback QA origin may be requested.");
  return nativeFetch(input, init);
};
const { prisma } = await import("@/lib/prisma");
const { auth } = await import("@/lib/auth");
const { getMediaObject } = await import("@/lib/media/storage");
const { previewWindow } = await import("@/lib/digital/domain");
const { validateDigitalMp3 } = await import("@/lib/digital/audio");
const { digitalCommercialAudioReady } = await import("@/lib/digital/formats");
const { DIGITAL_EXCERPT_EVENT } = await import("@/lib/digital/excerpt-policy");
const { recordDigitalExcerptSelection } = await import("@/lib/digital/excerpt-service");
const { processDigitalExcerpt } = await import("@/lib/digital/excerpt-worker");
const masterRoute = await import("@/app/api/admin/digital/masters/[id]/route");
const excerptRoute = await import("@/app/api/admin/digital/excerpts/[id]/route");
const candidateRoute = await import("@/app/api/admin/digital/excerpt-candidates/[id]/route");
const publicRoute = await import("@/app/media/digital/previews/[id]/route");

const fixtureFile = ".private/dcn-admin-preparation-credentials-9d063091-fe2e-432a-bdae-53dd46988e2f.json";
assert.equal((await stat(fixtureFile)).mode & 0o077, 0, "Synthetic credentials must be private (0600).");
const fixture = JSON.parse(await readFile(fixtureFile, "utf8")) as { adminEmail: string; memberEmail: string; password: string; slug: string; projectId: string; trackId: string };
assert.equal(fixture.slug, "dcn-edition-privee-9d063091-fe2e-432a-bdae-53dd46988e2f");
assert.ok(fixture.adminEmail.endsWith("@example.invalid") && fixture.memberEmail.endsWith("@example.invalid"));
const runId = randomUUID(), checks: Record<string, "PASS"> = {}, measurements: unknown[] = [];
const routeResults: { route: string; status: number; method: string }[] = [];
const createdCandidateIds: string[] = [];
const temporary = await mkdtemp("/private/tmp/lnx-dcn-excerpt-runtime-");
const serialize = (value: unknown) => JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item);
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const digest = (value: unknown) => hash(serialize(value));
const masterInclude = { masterAsset: true, mp3Asset: true, previewAsset: true } as const;
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const request = (family: string, id: string, cookie?: string, method = "GET", body?: unknown, range?: string) => new Request(`${base.origin}/api/admin/digital/${family}/${id}`, {
  method, headers: { ...(cookie ? { cookie } : {}), ...(range ? { range } : {}), ...(method === "POST" ? { origin: base.origin, "content-type": "application/json" } : {}) },
  ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
});
const requestBody = (selection: DigitalExcerptSelection, action: DigitalExcerptInput["action"], startMs = selection.startMs, attested = false): DigitalExcerptInput => ({
  action, startMs, expectedRevisionId: selection.revisionId, idempotencyKey: randomUUID(), attested,
});
function recordRoute(route: string, method: string, response: Response, expected: number) {
  assert.equal(response.status, expected, `${method} ${route}: expected ${expected}, got ${response.status}`);
  routeResults.push({ route, method, status: response.status }); return response;
}
async function selection(id: string, cookie: string) {
  const response = recordRoute("excerpts", "GET", await excerptRoute.GET(request("excerpts", id, cookie), params(id)), 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  return (await response.json() as { selection: DigitalExcerptSelection }).selection;
}
async function mutate(id: string, cookie: string, body: DigitalExcerptInput, expected = 200) {
  const response = recordRoute("excerpts", "POST", await excerptRoute.POST(request("excerpts", id, cookie, "POST", body), params(id)), expected);
  return response.json() as Promise<{ selection: DigitalExcerptSelection; code?: string }>;
}
async function objectHash(asset: Parameters<typeof getMediaObject>[0]) {
  const object = await getMediaObject(asset), reader = object.body.getReader(), sha = createHash("sha256");
  let size = 0;
  for (;;) { const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength; sha.update(chunk.value); }
  return { sha256: sha.digest("hex"), bytes: size };
}

try {
  const identity = await prisma.$queryRaw<Array<{ database: string; role: string; timezone: string; owner: boolean }>>`
    SELECT current_database()::text AS database, current_user::text AS role, current_setting('TimeZone')::text AS timezone,
      pg_get_userbyid(datdba) = current_user AS owner FROM pg_database WHERE datname = current_database()`;
  assert.deepEqual(identity, [{ database: target.pathname.slice(1), role: "dcn_runtime_a", timezone: "UTC", owner: false }]);
  checks.NON_OWNER_RUNTIME_EXACT_LOCAL_DATABASE = "PASS";
  const project = await prisma.project.findUniqueOrThrow({ where: { id: fixture.projectId }, include: { tracks: { orderBy: { position: "asc" } } } });
  assert.equal(project.slug, fixture.slug); assert.equal(project.status, "DRAFT"); assert.equal(project.publicVisible, false);
  assert.equal(project.tracks.length, 1); assert.equal(project.tracks[0].id, fixture.trackId);
  const master = await prisma.digitalMaster.findFirstOrThrow({ where: { trackId: fixture.trackId }, orderBy: { version: "desc" }, include: masterInclude });
  assert.equal(digitalCommercialAudioReady(master), true);
  assert.equal(await prisma.digitalEntitlement.count({ where: { masterId: master.id } }), 0, "Never use an acquired master as a mutable test fixture.");
  assert.equal(await prisma.digitalOffer.count({ where: { projectId: project.id } }), 0);
  const admin = await prisma.user.findUniqueOrThrow({ where: { email: fixture.adminEmail } });
  const member = await prisma.user.findUniqueOrThrow({ where: { email: fixture.memberEmail } });
  assert.equal(admin.role, "ADMIN"); assert.equal(admin.status, "ACTIVE"); assert.equal(admin.emailVerified, true);
  assert.equal(member.role, "MEMBER"); assert.equal(member.status, "ACTIVE"); assert.equal(member.emailVerified, true);
  const actor = { id: admin.id, email: admin.email, name: admin.displayName, role: "ADMIN" as const, status: "ACTIVE" as const, emailVerified: true as const };
  const existingMasterIds = (await prisma.digitalMaster.findMany({ select: { id: true } })).map(row => row.id);
  const existingAssetIds = (await prisma.asset.findMany({ select: { id: true } })).map(row => row.id);
  const existingEventIds = (await prisma.digitalEvent.findMany({ select: { id: true } })).map(row => row.id);
  async function canaries() {
    const rows = {
      orders: await prisma.digitalOrder.findMany({ orderBy: { id: "asc" } }),
      lines: await prisma.digitalOrderLine.findMany({ orderBy: { id: "asc" } }),
      entitlements: await prisma.digitalEntitlement.findMany({ orderBy: { id: "asc" } }),
      documents: await prisma.digitalDocument.findMany({ orderBy: { id: "asc" } }),
      masters: await prisma.digitalMaster.findMany({ where: { id: { in: existingMasterIds } }, include: masterInclude, orderBy: { id: "asc" } }),
      originalAssets: await prisma.asset.findMany({ where: { id: { in: existingAssetIds } }, orderBy: { id: "asc" } }),
      previousEvents: await prisma.digitalEvent.findMany({ where: { id: { in: existingEventIds } }, orderBy: { id: "asc" } }),
      project: await prisma.project.findUniqueOrThrow({ where: { id: project.id }, include: { tracks: { orderBy: { id: "asc" } } } }),
    };
    return Object.fromEntries(Object.entries(rows).map(([key, value]) => [key, { count: Array.isArray(value) ? value.length : 1, sha256: digest(value) }]));
  }
  const before = await canaries(), originalMasterBytes = await objectHash(master.masterAsset), originalPreviewBytes = await objectHash(master.previewAsset!);
  assert.equal(originalMasterBytes.sha256, master.masterAsset.checksumSha256); assert.equal(originalPreviewBytes.sha256, master.previewAsset!.checksumSha256);
  async function cookie(email: string) {
    const response = await auth.handler(new Request(`${base.origin}/api/auth/sign-in/email`, { method: "POST", headers: { "content-type": "application/json", origin: base.origin }, body: JSON.stringify({ email, password: fixture.password }) }));
    assert.equal(response.status, 200, "Existing synthetic QA account authentication failed; no credential will be changed.");
    const result = response.headers.getSetCookie().map(part => part.split(";")[0]).join("; "); assert.ok(result); return result;
  }
  const adminCookie = await cookie(admin.email), memberCookie = await cookie(member.email);
  const full = recordRoute("masters", "GET", await masterRoute.GET(request("masters", master.id, adminCookie), params(master.id)), 200);
  assert.equal(full.headers.get("cache-control"), "private, no-store"); assert.equal(full.headers.get("cross-origin-resource-policy"), "same-origin");
  assert.match(full.headers.get("x-robots-tag") ?? "", /noindex/);
  assert.equal(hash(new Uint8Array(await full.arrayBuffer())), originalMasterBytes.sha256);
  const head = recordRoute("masters", "HEAD", await masterRoute.HEAD(request("masters", master.id, adminCookie, "HEAD"), params(master.id)), 200);
  assert.equal(Number(head.headers.get("content-length")), originalMasterBytes.bytes); assert.equal((await head.arrayBuffer()).byteLength, 0);
  const range = recordRoute("masters", "GET Range", await masterRoute.GET(request("masters", master.id, adminCookie, "GET", undefined, "bytes=100-199"), params(master.id)), 206);
  assert.equal((await range.arrayBuffer()).byteLength, 100); assert.equal(range.headers.get("content-range"), `bytes 100-199/${originalMasterBytes.bytes}`);
  recordRoute("masters", "GET bad Range", await masterRoute.GET(request("masters", master.id, adminCookie, "GET", undefined, `bytes=${originalMasterBytes.bytes + 1}-`), params(master.id)), 416);
  for (const [authCookie, code] of [[undefined, 401], [memberCookie, 403]] as const) {
    recordRoute("masters", "GET denied", await masterRoute.GET(request("masters", master.id, authCookie), params(master.id)), code);
    recordRoute("excerpts", "GET denied", await excerptRoute.GET(request("excerpts", master.id, authCookie), params(master.id)), code);
    recordRoute("excerpts", "POST denied", await excerptRoute.POST(request("excerpts", master.id, authCookie, "POST", requestBody({ revisionId: null, status: "TO_LISTEN", startMs: 0, previewDurationMs: null, candidateUrl: null, errorCode: null }, "save")), params(master.id)), code);
  }
  for (const assetId of [master.masterAssetId, master.mp3AssetId!]) {
    recordRoute("public-preview", "GET complete audio denied", await publicRoute.GET(new Request(`${base.origin}/media/digital/previews/${assetId}`), params(assetId)), 404);
  }
  checks.PRIVATE_MASTER_REAL_GET_HEAD_RANGE_NO_STORE = "PASS"; checks.ANONYMOUS_AND_MEMBER_DENIED = "PASS";
  let current = await selection(master.id, adminCookie);
  const draftBody = requestBody(current, "save", 12_345);
  const saved = (await mutate(master.id, adminCookie, draftBody)).selection;
  assert.equal(saved.status, "DRAFT"); assert.equal(saved.startMs, 12_345); assert.equal(saved.candidateUrl, null);
  assert.deepEqual((await mutate(master.id, adminCookie, draftBody)).selection, saved);
  assert.equal((await mutate(master.id, adminCookie, { ...draftBody, startMs: 12_346 }, 409)).code, "IDEMPOTENCY_CONFLICT");
  assert.equal((await mutate(master.id, adminCookie, requestBody(current, "save", 20_000), 409)).code, "EXCERPT_SELECTION_CHANGED");
  const concurrent = await Promise.all([13_001, 14_002].map(async startMs => {
    const response = await excerptRoute.POST(request("excerpts", master.id, adminCookie, "POST", requestBody(saved, "save", startMs)), params(master.id));
    routeResults.push({ route: "excerpts", method: "POST concurrent", status: response.status });
    return { status: response.status, result: await response.json() as { selection?: DigitalExcerptSelection; code?: string } };
  }));
  // Either writer may win: the first request is not guaranteed to acquire the advisory lock first.
  assert.deepEqual(concurrent.map(result => result.status).sort(), [200, 409]);
  assert.equal(concurrent.find(result => result.status === 409)!.result.code, "EXCERPT_SELECTION_CHANGED");
  current = await selection(master.id, adminCookie);
  assert.ok([13_001, 14_002].includes(current.startMs));
  checks.APPEND_ONLY_DRAFT_DUPLICATE_IDEMPOTENCY_AND_CAS = "PASS";
  const freshMemberSpoof = { ...actor, id: member.id, email: member.email };
  await assert.rejects(recordDigitalExcerptSelection(freshMemberSpoof, master.id, requestBody(current, "save", current.startMs)), { code: "ADMIN_REQUIRED" });
  const crossOrigin = request("excerpts", master.id, adminCookie, "POST", requestBody(current, "save", 0));
  crossOrigin.headers.set("origin", "https://forbidden.invalid");
  recordRoute("excerpts", "POST cross-origin", await excerptRoute.POST(crossOrigin, params(master.id)), 403);
  const outOfRange = await mutate(master.id, adminCookie, requestBody(current, "save", master.masterAsset.durationMs!), 400);
  assert.ok(outOfRange.code); assert.equal((await selection(master.id, adminCookie)).revisionId, current.revisionId);
  checks.FRESH_ADMIN_ORIGIN_AND_WINDOW_FAIL_CLOSED = "PASS";

  async function generate(startMs: number) {
    const queued = (await mutate(master.id, adminCookie, requestBody(current, "generate", startMs))).selection;
    assert.equal(queued.status, "QUEUED"); assert.equal(queued.candidateUrl, null);
    await assert.rejects(processDigitalExcerpt({}), { code: "EXCERPT_SCOPE_REQUIRED" });
    await assert.rejects(processDigitalExcerpt({ projectId: randomUUID(), requestId: queued.revisionId! }), { code: "EXCERPT_SCOPE_MISMATCH" });
    const results = await Promise.all([processDigitalExcerpt({ projectId: project.id, requestId: queued.revisionId! }), processDigitalExcerpt({ projectId: project.id, requestId: queued.revisionId! })]);
    measurements.push(...results);
    assert.equal(results.filter(result => result.processed).length, 1, "Only one worker may claim the same live request.");
    assert.equal(results.filter(result => result.processed && result.ready).length, 1, "Scoped excerpt-only generation must finish READY.");
    current = await selection(master.id, adminCookie); assert.equal(current.status, "READY"); assert.equal(current.startMs, startMs);
    assert.ok(current.candidateUrl); assert.ok(current.previewDurationMs! > 0 && current.previewDurationMs! <= 60_000);
    const candidateId = current.candidateUrl.split("/").at(-1)!; createdCandidateIds.push(candidateId);
    const asset = await prisma.asset.findUniqueOrThrow({ where: { id: candidateId } });
    assert.equal(asset.visibility, "PRIVATE"); assert.equal(asset.type, "AUDIO_PREVIEW"); assert.equal(asset.rightsStatus, "PENDING");
    const output = recordRoute("excerpt-candidates", "GET", await candidateRoute.GET(request("excerpt-candidates", candidateId, adminCookie), params(candidateId)), 200);
    assert.equal(output.headers.get("cache-control"), "private, no-store"); assert.equal(output.headers.get("cross-origin-resource-policy"), "same-origin");
    const bytes = new Uint8Array(await output.arrayBuffer()); assert.equal(hash(bytes), asset.checksumSha256);
    const local = path.join(temporary, `${candidateId}.mp3`); await writeFile(local, bytes, { mode: 0o600, flag: "wx" });
    const window = previewWindow(master.masterAsset.durationMs!, startMs);
    const decoded = await validateDigitalMp3(local, AbortSignal.timeout(60_000), { durationMs: window.durationMs, bitrateKbps: 192 });
    assert.ok(Math.abs(decoded.decodedDurationMs - window.durationMs) <= 100); assert.equal(decoded.durationMs, current.previewDurationMs);
    measurements.push({ candidateId, startMs, requestedDurationMs: window.durationMs, decodedDurationMs: decoded.decodedDurationMs, durationMs: decoded.durationMs, sha256: asset.checksumSha256, bytes: bytes.length });
    const candidateRange = recordRoute("excerpt-candidates", "GET Range", await candidateRoute.GET(request("excerpt-candidates", candidateId, adminCookie, "GET", undefined, "bytes=0-15"), params(candidateId)), 206);
    assert.equal((await candidateRange.arrayBuffer()).byteLength, 16);
    const candidateHead = recordRoute("excerpt-candidates", "HEAD", await candidateRoute.HEAD(request("excerpt-candidates", candidateId, adminCookie, "HEAD"), params(candidateId)), 200);
    assert.equal(Number(candidateHead.headers.get("content-length")), bytes.length); assert.equal((await candidateHead.arrayBuffer()).byteLength, 0);
    for (const [authCookie, code] of [[undefined, 401], [memberCookie, 403]] as const) recordRoute("excerpt-candidates", "GET denied", await candidateRoute.GET(request("excerpt-candidates", candidateId, authCookie), params(candidateId)), code);
    recordRoute("public-preview", "GET", await publicRoute.GET(new Request(`${base.origin}/media/digital/previews/${candidateId}`), params(candidateId)), 404);
    recordRoute("excerpt-candidates", "GET arbitrary private WAV", await candidateRoute.GET(request("excerpt-candidates", master.masterAssetId, adminCookie), params(master.masterAssetId)), 404);
    return current;
  }
  await generate(12_345);
  checks.SCOPED_CONCURRENT_WORKERS_ONE_PRIVATE_CANDIDATE = "PASS";
  checks.REAL_MP3_DECODE_PRECISE_WINDOW_60_SECONDS_MAX = "PASS";
  checks.CANDIDATE_RANGE_HEAD_PUBLIC_AND_UNRELATED_ASSET_DENIED = "PASS";
  assert.equal((await mutate(master.id, adminCookie, requestBody(current, "validate", current.startMs, false), 409)).code, "EXCERPT_ATTESTATION_REQUIRED");
  assert.equal((await mutate(master.id, adminCookie, requestBody(current, "validate", current.startMs + 1, true), 409)).code, "EXCERPT_NOT_READY");
  const validateBody = requestBody(current, "validate", current.startMs, true);
  current = (await mutate(master.id, adminCookie, validateBody)).selection; assert.equal(current.status, "VALIDATED");
  assert.deepEqual((await mutate(master.id, adminCookie, validateBody)).selection, current);
  const firstCandidate = current.candidateUrl!;
  current = (await mutate(master.id, adminCookie, requestBody(current, "save", 60_000))).selection;
  assert.equal(current.status, "DRAFT"); assert.equal(current.candidateUrl, null);
  checks.EXPLICIT_ATTESTATION_VALIDATION_AND_EDIT_INVALIDATION = "PASS";
  await generate(60_000);
  assert.notEqual(current.candidateUrl, firstCandidate);
  const oldCandidateId = firstCandidate.split("/").at(-1)!;
  recordRoute("excerpt-candidates", "GET previous preserved", await candidateRoute.HEAD(request("excerpt-candidates", oldCandidateId, adminCookie, "HEAD"), params(oldCandidateId)), 200);
  checks.END_OF_MASTER_SHORT_EXCERPT_AND_OLDER_CANDIDATE_PRESERVED = "PASS";
  assert.deepEqual(await objectHash(master.masterAsset), originalMasterBytes); assert.deepEqual(await objectHash(master.previewAsset!), originalPreviewBytes);
  const after = await canaries(); assert.deepEqual(after, before);
  assert.equal(await prisma.digitalMaster.count(), existingMasterIds.length);
  assert.equal(await prisma.digitalOffer.count({ where: { projectId: project.id } }), 0);
  const scopedEvents = await prisma.digitalEvent.count({ where: { kind: DIGITAL_EXCERPT_EVENT, details: { path: ["binding", "masterId"], equals: master.id } } });
  assert.ok(scopedEvents >= 8);
  assert.equal(await prisma.asset.count({ where: { id: { in: createdCandidateIds } } }), 2);
  assert.equal(await prisma.digitalWorkSlot.count({ where: { jobId: { in: (await prisma.digitalEvent.findMany({ where: { kind: DIGITAL_EXCERPT_EVENT, details: { path: ["binding", "masterId"], equals: master.id } }, select: { id: true } })).map(row => row.id) } } }), 0);
  checks.HISTORICAL_MASTERS_ASSETS_ORDERS_RIGHTS_DOCUMENTS_AUDIT_UNCHANGED = "PASS";
  checks.ORIGINAL_SOURCE_AND_PROVISIONAL_BYTES_UNCHANGED = "PASS";
  checks.NO_OFFER_RIGHTS_APPROVAL_PAYMENT_OR_GLOBAL_QUEUE_MUTATION = "PASS";
  const proof = { localOnly: true, runId, database: target.pathname.slice(1), runtimeRole: target.username, checks, measurements, routeResults,
    projectId: project.id, masterId: master.id, adminUrl: `${base.origin}/admin/musique/${project.slug}/extraits`, finalSyntheticSelection: current,
    createdCandidateIds, scopedEvents, canariesBefore: before, canariesAfter: after,
    providerCalls: 0, productionMutation: false, realEmails: 0, originalFilesDeleted: false, readyProduction: false,
    routeVerification: "IN_PROCESS_REAL_ROUTE_HANDLERS_AUTH_POSTGRESQL_LOCAL_STORAGE_FFMPEG_NOT_BROWSER_HTTP" };
  await mkdir("output/dcn-france-commercial", { recursive: true });
  const proofPath = `output/dcn-france-commercial/excerpt-selection-runtime-${runId}.json`;
  await writeFile(proofPath, JSON.stringify(proof, null, 2), { flag: "wx" });
  console.log(JSON.stringify({ ...proof, proofPath }));
} finally {
  await prisma.$disconnect(); globalThis.fetch = nativeFetch;
  // Only this run's own bounded MP3 copies; no masters, acquired assets, documents or shared trees.
  await rm(temporary, { recursive: true, force: true });
}
