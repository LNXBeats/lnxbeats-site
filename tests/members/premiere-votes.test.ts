import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { before, after, test } from "node:test";
import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { DIGITAL_MP3_ENCODER_VERSION } from "@/lib/digital/formats";
import { DigitalError } from "@/lib/digital/domain";
import { DIGITAL_RIGHTS_ATTESTATION, DIGITAL_RIGHTS_REVIEW_EVENT, DIGITAL_RIGHTS_REVIEW_POLICY, digitalRightsMasterBinding, digitalRightsReviewHash } from "@/lib/digital/rights-review-policy";
import { getPremiereVote, savePremiereVote, premiereVoteSummary, type PremiereVoteChoice, type PremiereVoter } from "@/lib/members/votes";
import { handlePremiereVoteGet, handlePremiereVotePatch, type PremiereVoteDependencies } from "@/lib/members/votes-http";
import { MEMBER_PREMIERE_EVENT, memberPremiereBinding } from "@/lib/members/premiere-policy";
import { syntheticExistingExcerptApproval } from "../digital/fixtures/excerpt-approval";

// Real vote/premiere/rights/excerpt services over repository doubles only.
// No user, actual vote, database, email, media or payment is read or changed.
const environment = { ...process.env }, now = new Date("2026-10-22T10:00:00.000Z"), baseUrl = "http://127.0.0.1:3170";
before(() => {
  Object.assign(process.env, { DCN_ENABLED: "true", DCN_MODE: "TEST", NODE_ENV: "test", MEDIA_DEPLOYMENT_ENV: "test" });
  for (const key of ["RAILWAY_ENVIRONMENT", "RAILWAY_ENVIRONMENT_NAME", "PAYMENT_DEPLOYMENT_ENV"]) delete process.env[key];
});
after(() => {
  for (const key of Object.keys(process.env)) if (!(key in environment)) delete process.env[key];
  Object.assign(process.env, environment);
});

function fixture() {
  const actor: PremiereVoter = { id: randomUUID(), status: "ACTIVE", role: "MEMBER", emailVerified: true };
  const reviewer = { id: randomUUID(), status: "ACTIVE", role: "ADMIN", emailVerified: true };
  const users = new Map([[actor.id, { ...actor }], [reviewer.id, reviewer]]);
  const wavId = randomUUID(), mp3Id = randomUUID(), previewId = randomUUID(), trackId = randomUUID(), projectId = randomUUID();
  const asset = (id: string, mimeType: string, visibility: string, durationMs: number) => ({ id, mimeType, visibility, durationMs,
    sizeBytes: 4096n, checksumSha256: "a".repeat(64), type: visibility === "PUBLIC" ? "AUDIO_PREVIEW" : "AUDIO", rightsStatus: "CLEARED",
    storageKey: `digital/studio/${randomUUID()}/${randomUUID()}.mp3` });
  const master = { id: randomUUID(), trackId, version: 1, status: "READY", codec: "wav", encoderVersion: DIGITAL_MP3_ENCODER_VERSION, mp3BitrateKbps: 320,
    masterAssetId: wavId, mp3AssetId: mp3Id, previewAssetId: previewId, previewStartMs: 0, previewDurationMs: 59_950,
    masterAsset: asset(wavId, "audio/wav", "PRIVATE", 120000), mp3Asset: asset(mp3Id, "audio/mpeg", "PRIVATE", 120000), previewAsset: asset(previewId, "audio/mpeg", "PUBLIC", 59_950) };
  const project = { id: projectId, slug: "vote-qa-only", title: "Titre original non traduit — 東京", type: "SINGLE", status: "PUBLISHED", publicVisible: true,
    membersPreviewEnabled: true, releaseDate: new Date("2026-10-30T00:00:00.000Z"), digitalOffers: [{ active: false }],
    assets: [{ asset: { id: randomUUID(), checksumSha256: "b".repeat(64), visibility: "PUBLIC", rightsStatus: "CLEARED" } }],
    tracks: [{ id: trackId, position: 1, title: "Titre de piste", status: "ANNOUNCED", digitalMasters: [master] }] };
  const at = new Date("2026-10-22T09:00:00.000Z"), proof = { policy: DIGITAL_RIGHTS_REVIEW_POLICY, binding: digitalRightsMasterBinding(master), status: "APPROVED",
    privateEvidenceReference: "private-evidence:synthetic-qa/member-votes", evidenceSha256: "d".repeat(64), attestation: DIGITAL_RIGHTS_ATTESTATION,
    reason: "SYNTHETIC_REPOSITORY_FIXTURE_ONLY_NOT_REAL_APPROVAL", reviewedAt: at.toISOString(), requestHash: "e".repeat(64) };
  const rights = { id: randomUUID(), actorId: reviewer.id, kind: DIGITAL_RIGHTS_REVIEW_EVENT, createdAt: at,
    details: { ...proof, recordHash: digitalRightsReviewHash({ actorId: reviewer.id, ...proof }) } };
  let artistic: ReturnType<typeof syntheticExistingExcerptApproval> | null = syntheticExistingExcerptApproval(master, reviewer.id, at);
  let publication: { actorId: string; details: { projectId: string; premiereBinding: string } } | null = null;
  const publish = () => { publication = { actorId: reviewer.id, details: { projectId, premiereBinding: memberPremiereBinding(project) } }; };
  publish();
  type Row = { projectId: string; userId: string; binding: string; choice: PremiereVoteChoice };
  const rows = new Map<string, Row>(), key = (row: Omit<Row, "choice">) => [row.projectId, row.userId, row.binding].join(":");
  let creates = 0, updates = 0, reads = 0, locks = 0, tail: Promise<unknown> = Promise.resolve(); const queries: unknown[] = [];
  const db = {
    async $queryRaw(parts: TemplateStringsArray, ...values: unknown[]) {
      reads++; const sql = parts.join("?"); if (values.some(value => typeof value === "string" && value.startsWith("premiere-vote:"))) locks++;
      if (sql.includes("dcn-excerpt-current-masters")) return [{ id: master.id, trackId }];
      if (sql.includes("dcn-excerpt-latest-artistic-events")) return artistic && (values[1] as string[]).includes(master.id) ? [artistic] : [];
      return [];
    },
    project: { async findUnique() { reads++; return project; } },
    digitalMaster: { async findMany() { reads++; return [master]; } },
    user: {
      async findUnique({ where }: { where: { id: string } }) { reads++; return users.get(where.id) ?? null; },
      async findMany() { reads++; return [reviewer]; },
    },
    digitalEvent: { async findFirst({ where }: { where: { kind: string } }) { reads++; return where.kind === MEMBER_PREMIERE_EVENT ? publication : rights; } },
    asset: { async findMany() { return []; } },
    memberPremiereVote: {
      async findUnique({ where }: { where: { projectId_userId_binding: Omit<Row, "choice"> } }) { reads++; return rows.get(key(where.projectId_userId_binding)) ?? null; },
      async create({ data }: { data: Row }) { assert(!rows.has(key(data)), "Composite uniqueness is mandatory"); creates++; rows.set(key(data), { ...data }); return data; },
      async update({ where, data }: { where: { projectId_userId_binding: Omit<Row, "choice"> }; data: { choice: PremiereVoteChoice } }) {
        const row = rows.get(key(where.projectId_userId_binding)); assert(row); updates++; row.choice = data.choice; return row;
      },
      async groupBy(query: { where: { projectId: string; binding: string; choice: { in: string[] }; user: { status: string; emailVerified: boolean; role: { in: string[] } } } }) {
        reads++; queries.push(query);
        const where = query.where, counts = new Map<string, number>();
        for (const row of rows.values()) {
          const user = users.get(row.userId);
          if (row.projectId !== where.projectId || row.binding !== where.binding || !where.choice.in.includes(row.choice ?? "")
            || !user || user.status !== where.user.status || user.emailVerified !== where.user.emailVerified || !where.user.role.in.includes(user.role)) continue;
          counts.set(row.choice!, (counts.get(row.choice!) ?? 0) + 1);
        }
        return [...counts].map(([choice, count]) => ({ choice, _count: { _all: count } }));
      },
    },
  };
  // Serialize transactions in this repository double. Real DB uniqueness and
  // advisory-lock concurrency still require the independent PostgreSQL recipe.
  const database = { ...db, $transaction<T>(callback: (tx: typeof db) => Promise<T>) {
    const pending = tail.then(() => callback(db)); tail = pending.catch(() => undefined); return pending;
  } } as unknown as PrismaClient;
  return { actor, reviewer, users, project, master, rows, key, publish, database, binding: () => memberPremiereBinding(project), tx: db as unknown as Prisma.TransactionClient,
    unpublish: () => { publication = null; }, clearArtistic: () => { artistic = null; }, counts: () => ({ creates, updates, reads, locks }), queries };
}
function httpFixture() {
  const actor = { id: randomUUID(), role: "MEMBER", status: "ACTIVE", emailVerified: true }, projectId = randomUUID(), binding = "f".repeat(64), calls: unknown[] = [], limits: unknown[] = [];
  const dependencies: PremiereVoteDependencies = { baseUrl, user: async () => actor,
    rateLimit: async (userId, write) => { limits.push({ userId, write }); },
    get: async (user, id, expectedBinding) => { calls.push({ operation: "get", userId: user.id, id, binding: expectedBinding }); return { choice: null, up: 2, down: 1 }; },
    save: async (user, id, choice, expectedBinding) => { calls.push({ operation: "save", userId: user.id, id, choice, binding: expectedBinding }); return { choice, up: 2, down: 1 }; } };
  const request = (body: unknown = { projectId, binding, choice: "UP" }, origin: string | null = baseUrl) => new Request(`${baseUrl}/api/account/premiere-votes`, {
    method: "PATCH", headers: { ...(origin ? { origin } : {}), "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return { actor, projectId, binding, calls, limits, dependencies, request };
}

test("premiere votes: exact verified membership receives only own choice and anonymous aggregate counts", async () => {
  const f = fixture(), result = await getPremiereVote(f.actor, f.project.id, f.binding(), f.database, now);
  assert.deepEqual(result, { choice: null, up: 0, down: 0 }); assert.deepEqual(Object.keys(result).sort(), ["choice", "down", "up"]);
  assert.deepEqual(f.counts().creates, 0); assert.deepEqual(f.counts().updates, 0);
});
test("premiere votes: one choice per user/project/version, repeated choice is write-idempotent", async () => {
  const f = fixture();
  assert.deepEqual(await savePremiereVote(f.actor, f.project.id, "UP", f.binding(), f.database, now), { choice: "UP", up: 1, down: 0 });
  await savePremiereVote(f.actor, f.project.id, "UP", f.binding(), f.database, now);
  assert.equal(f.rows.size, 1); assert.equal(f.counts().creates, 1); assert.equal(f.counts().updates, 0); assert.equal(f.counts().locks, 2);
});
test("premiere votes: a change replaces the same row, withdrawal preserves a null historical row", async () => {
  const f = fixture(); await savePremiereVote(f.actor, f.project.id, "UP", f.binding(), f.database, now);
  assert.deepEqual(await savePremiereVote(f.actor, f.project.id, "DOWN", f.binding(), f.database, now), { choice: "DOWN", up: 0, down: 1 });
  assert.deepEqual(await savePremiereVote(f.actor, f.project.id, null, f.binding(), f.database, now), { choice: null, up: 0, down: 0 });
  await savePremiereVote(f.actor, f.project.id, null, f.binding(), f.database, now);
  assert.equal(f.rows.size, 1); assert.equal(f.counts().creates, 1); assert.equal(f.counts().updates, 2);
});
test("premiere votes: withdrawing with no previous choice creates no row", async () => {
  const f = fixture(); assert.deepEqual(await savePremiereVote(f.actor, f.project.id, null, f.binding(), f.database, now), { choice: null, up: 0, down: 0 });
  assert.equal(f.rows.size, 0); assert.equal(f.counts().creates + f.counts().updates, 0);
});
test("premiere votes: distinct members have independent rows, and concurrent retry calls remain one per binding", async () => {
  const f = fixture(), second = { ...f.actor, id: randomUUID(), role: "CUSTOMER" }; f.users.set(second.id, second);
  await Promise.all(Array.from({ length: 5 }, () => savePremiereVote(f.actor, f.project.id, "UP", f.binding(), f.database, now)));
  assert.deepEqual(await savePremiereVote(second, f.project.id, "DOWN", f.binding(), f.database, now), { choice: "DOWN", up: 1, down: 1 });
  assert.equal(f.rows.size, 2); assert.equal(f.counts().creates, 2); assert.equal(f.counts().updates, 0);
});
test("premiere votes: suspended, unverified, removed or role-changed persisted users cannot reuse an old session", async () => {
  for (const change of ["suspended", "unverified", "removed", "role"]) {
    const f = fixture(), user = f.users.get(f.actor.id)!;
    if (change === "suspended") user.status = "SUSPENDED"; if (change === "unverified") user.emailVerified = false;
    if (change === "removed") f.users.delete(f.actor.id); if (change === "role") user.role = "VISITOR";
    for (const action of [() => getPremiereVote(f.actor, f.project.id, f.binding(), f.database, now), () => savePremiereVote(f.actor, f.project.id, "UP", f.binding(), f.database, now)])
      await assert.rejects(action(), (error: unknown) => error instanceof DigitalError && error.status === 401, change);
    assert.equal(f.counts().creates + f.counts().updates, 0);
  }
});
test("premiere votes: ineligible session roles and invalid IDs/choices never write", async () => {
  const f = fixture();
  for (const actor of [{ ...f.actor, emailVerified: false }, { ...f.actor, status: "SUSPENDED" }, { ...f.actor, role: "VISITOR" }])
    await assert.rejects(savePremiereVote(actor, f.project.id, "UP", f.binding(), f.database, now), (error: unknown) => error instanceof DigitalError && error.status === 401);
  await assert.rejects(savePremiereVote(f.actor, "../invalid", "UP", f.binding(), f.database, now), { code: "INVALID_ID" });
  await assert.rejects(savePremiereVote(f.actor, f.project.id, "MAYBE" as PremiereVoteChoice, f.binding(), f.database, now), { code: "INVALID_BODY" });
  assert.equal(f.counts().creates + f.counts().updates, 0);
});
test("premiere votes: no publication, expired date or missing artistic approval is not votable", async () => {
  for (const change of ["publication", "date", "artistic", "private"]) {
    const f = fixture();
    if (change === "publication") f.unpublish(); if (change === "date") f.project.releaseDate = new Date("2026-10-22");
    if (change === "artistic") f.clearArtistic(); if (change === "private") f.project.publicVisible = false;
    await assert.rejects(savePremiereVote(f.actor, f.project.id, "UP", f.binding(), f.database, now), (error: unknown) => error instanceof DigitalError && error.status === 404, change);
    assert.equal(f.rows.size, 0);
  }
});
test("premiere votes: a separately authorized active sale does not remove verified members' exact-preview votes", async () => {
  const f = fixture(); f.project.digitalOffers[0].active = true;
  const before = structuredClone(f.project);
  assert.deepEqual(await savePremiereVote(f.actor, f.project.id, "UP", f.binding(), f.database, now), { choice: "UP", up: 1, down: 0 });
  assert.deepEqual(f.project, before); assert.equal(f.rows.size, 1);
});
test("premiere votes: changed metadata invalidates old publication, republished exact version starts separate counts", async () => {
  const f = fixture(), originalBinding = f.binding(); await savePremiereVote(f.actor, f.project.id, "UP", originalBinding, f.database, now);
  f.project.title += " — nouvelle version";
  await assert.rejects(getPremiereVote(f.actor, f.project.id, originalBinding, f.database, now), { code: "NOT_FOUND" });
  f.publish();
  await assert.rejects(savePremiereVote(f.actor, f.project.id, "DOWN", originalBinding, f.database, now), { code: "STALE_PREMIERE", status: 409 });
  assert.equal(f.rows.size, 1);
  assert.deepEqual(await getPremiereVote(f.actor, f.project.id, f.binding(), f.database, now), { choice: null, up: 0, down: 0 });
  assert.deepEqual(await savePremiereVote(f.actor, f.project.id, "DOWN", f.binding(), f.database, now), { choice: "DOWN", up: 0, down: 1 });
  assert.equal(f.rows.size, 2); assert.deepEqual([...f.rows.values()].map(row => row.choice), ["UP", "DOWN"]);
});
test("premiere votes: summary excludes withdrawn, suspended and unverified voters, never projecting identity", async () => {
  const f = fixture(); await savePremiereVote(f.actor, f.project.id, "UP", f.binding(), f.database, now);
  const binding = memberPremiereBinding(f.project), invalid = [
    { ...f.actor, id: randomUUID(), status: "SUSPENDED" }, { ...f.actor, id: randomUUID(), emailVerified: false }, { ...f.actor, id: randomUUID(), role: "VISITOR" },
  ];
  for (const user of invalid) { f.users.set(user.id, user); const row = { projectId: f.project.id, userId: user.id, binding, choice: "DOWN" as const }; f.rows.set(f.key(row), row); }
  const withdrawn = { projectId: f.project.id, userId: f.reviewer.id, binding, choice: null };
  f.rows.set(f.key(withdrawn), withdrawn);
  assert.deepEqual(await premiereVoteSummary(f.tx, f.project.id, binding), { up: 1, down: 0 });
  const query = f.queries.at(-1) as { by: string[]; where: unknown }; assert.deepEqual(query.by, ["choice"]);
  const result = JSON.stringify(await getPremiereVote(f.actor, f.project.id, f.binding(), f.database, now));
  for (const privateValue of [f.actor.id, f.reviewer.id, f.project.id, binding, "email", "userId", "actorId", "storageKey"]) assert.equal(result.includes(privateValue), false);
});
test("premiere votes: voting never mutates source, project, tracks, offer or approval facts", async () => {
  const f = fixture(), before = structuredClone({ project: f.project, master: f.master });
  await savePremiereVote(f.actor, f.project.id, "UP", f.binding(), f.database, now); await savePremiereVote(f.actor, f.project.id, "DOWN", f.binding(), f.database, now);
  assert.deepEqual({ project: f.project, master: f.master }, before); assert.equal(f.project.digitalOffers[0].active, false);
});
test("premiere vote HTTP: missing/foreign origins are rejected before session or storage access", async () => {
  for (const origin of [null, "https://attacker.invalid", "http://127.0.0.1:9999", "not-a-url"]) {
    const f = httpFixture(); f.dependencies.user = async () => { throw Error("MUST_NOT_CHECK_SESSION"); };
    assert.equal((await handlePremiereVotePatch(f.request(undefined, origin), f.dependencies)).status, 403); assert.equal(f.calls.length, 0); assert.equal(f.limits.length, 0);
  }
});
test("premiere vote HTTP: anonymous, inactive, unverified and unknown-role actors cannot read or vote", async () => {
  for (const actor of [null, { ...httpFixture().actor, emailVerified: false }, { ...httpFixture().actor, status: "SUSPENDED" }, { ...httpFixture().actor, role: "VISITOR" }]) {
    const f = httpFixture(); f.dependencies.user = async () => actor;
    assert.equal((await handlePremiereVoteGet(new Request(`${baseUrl}/api/account/premiere-votes?projet=${f.projectId}&version=${f.binding}`), f.dependencies)).status, 401);
    assert.equal((await handlePremiereVotePatch(f.request(), f.dependencies)).status, 401); assert.equal(f.calls.length, 0);
  }
});
test("premiere vote HTTP: GET requires exact project UUID and SHA binding parameters", async () => {
  const f = httpFixture();
  for (const query of ["", "projet=invalid", `projet=${f.projectId}&projet=${f.projectId}`, `projet=${f.projectId}&userId=${f.actor.id}`, `projectId=${f.projectId}`,
    `projet=${f.projectId}&version=invalid`, `projet=${f.projectId}&version=${f.binding}&version=${f.binding}`, `projet=invalid&version=${f.binding}`])
    assert.equal((await handlePremiereVoteGet(new Request(`${baseUrl}/api/account/premiere-votes?${query}`), f.dependencies)).status, 400);
  assert.equal(f.calls.length, 0);
});
test("premiere vote HTTP: only session ownership and exact UP/DOWN/null choices are accepted", async () => {
  const f = httpFixture();
  for (const choice of ["UP", "DOWN", null]) assert.equal((await handlePremiereVotePatch(f.request({ projectId: f.projectId, binding: f.binding, choice }), f.dependencies)).status, 200);
  assert.deepEqual(f.calls, ["UP", "DOWN", null].map(choice => ({ operation: "save", userId: f.actor.id, id: f.projectId, choice, binding: f.binding })));
  for (const body of [{ projectId: f.projectId, binding: f.binding, choice: "UP", userId: randomUUID() }, { projectId: f.projectId, binding: f.binding, choice: true },
    { projectId: "invalid", binding: f.binding, choice: "UP" }, { projectId: f.projectId, binding: f.binding, choice: "up" },
    { projectId: f.projectId, choice: "UP" }, { projectId: f.projectId, binding: "invalid", choice: "UP" }, { binding: f.binding, choice: "UP" }, [], null])
    assert.equal((await handlePremiereVotePatch(f.request(body), f.dependencies)).status, 400);
  assert.equal(f.calls.length, 3);
});
test("premiere vote HTTP: malformed JSON, oversized content-length, streamed oversized body and unsupported type never save", async () => {
  const f = httpFixture();
  for (const request of [new Request(baseUrl, { method: "PATCH", headers: { origin: baseUrl, "Content-Type": "application/json" }, body: "{" }),
    new Request(baseUrl, { method: "PATCH", headers: { origin: baseUrl, "Content-Type": "text/plain" }, body: "{}" }),
    new Request(baseUrl, { method: "PATCH", headers: { origin: baseUrl, "Content-Type": "application/json", "Content-Length": "4096" }, body: "{}" }),
    new Request(baseUrl, { method: "PATCH", headers: { origin: baseUrl, "Content-Type": "application/json" }, body: `{"padding":"${"x".repeat(4096)}"}` })])
    assert.equal((await handlePremiereVotePatch(request, f.dependencies)).status, 400);
  assert.equal(f.calls.length, 0);
});
test("premiere vote HTTP: rate limits distinguish reads/writes and refusal occurs before storage", async () => {
  const f = httpFixture();
  await handlePremiereVoteGet(new Request(`${baseUrl}/api/account/premiere-votes?projet=${f.projectId}&version=${f.binding}`), f.dependencies);
  await handlePremiereVotePatch(f.request(), f.dependencies);
  assert.deepEqual(f.limits, [{ userId: f.actor.id, write: false }, { userId: f.actor.id, write: true }]);
  f.dependencies.rateLimit = async () => { throw new DigitalError("RATE_LIMIT", 429); };
  assert.equal((await handlePremiereVotePatch(f.request(), f.dependencies)).status, 429); assert.equal(f.calls.length, 2);
});
test("premiere vote HTTP: exact availability failure is 404, infrastructure failure is generic retryable 503", async () => {
  const f = httpFixture(); f.dependencies.save = async () => { throw new DigitalError("NOT_FOUND", 404); };
  const absent = await handlePremiereVotePatch(f.request(), f.dependencies); assert.equal(absent.status, 404); assert.deepEqual(await absent.json(), { ok: false });
  f.dependencies.save = async () => { throw new DigitalError("STALE_PREMIERE", 409); };
  const stale = await handlePremiereVotePatch(f.request(), f.dependencies); assert.equal(stale.status, 409); assert.deepEqual(await stale.json(), { ok: false });
  f.dependencies.save = async () => { throw Error("DATABASE_URL=secret-pii-do-not-leak"); };
  const error = await handlePremiereVotePatch(f.request(), f.dependencies); assert.equal(error.status, 503); assert.deepEqual(await error.json(), { ok: false });
});
test("premiere vote HTTP: successful reads are private/no-store and contain only totals plus own choice", async () => {
  const f = httpFixture(), response = await handlePremiereVoteGet(new Request(`${baseUrl}/api/account/premiere-votes?projet=${f.projectId}&version=${f.binding}`), f.dependencies);
  assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal(response.headers.get("vary"), "Cookie");
  assert.equal(response.headers.get("x-robots-tag"), "noindex"); assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.deepEqual(await response.json(), { ok: true, choice: null, up: 2, down: 1 });
});
