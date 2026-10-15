/** Explicitly scoped, repeatable preparation of the prices approved on 15 October 2026. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { assertSafeDigitalLocalPostgresUrl } from "@/lib/digital/local-review-database";

const apply = process.argv.includes("--apply");
const output = process.argv.find(a => a.startsWith("--output="))?.slice(9);
assert.ok(output?.startsWith("/Users/lnxbeats/.codex/visualizations/") && output.endsWith(".json"));
for (const key of Object.keys(process.env)) if (/STRIPE|PAYPAL|RESEND|RAILWAY|S3|R2|AWS|SMTP/i.test(key)) delete process.env[key];
const config = JSON.parse(await readFile(".private/dcn-france-commercial-config.json", "utf8")) as Record<string, string>;
const target = assertSafeDigitalLocalPostgresUrl(config.DATABASE_URL);
assert.equal(target.hostname, "127.0.0.1"); assert.equal(target.port, "55473");
assert.equal(target.pathname, "/lnx_dcn_france_commercial_test_20261015"); assert.equal(target.username, "dcn_runtime_a");
assert.equal(target.searchParams.get("options"), "-c timezone=UTC");
assert.equal(config.MEDIA_STORAGE_DRIVER, "local"); assert.equal(config.EMAIL_PROVIDER, "capture");
assert.equal(config.DCN_MODE, "TEST"); assert.equal(config.DCN_NEW_PAYMENTS_ENABLED, "false");
for (const key of Object.keys(config)) assert.doesNotMatch(key, /STRIPE|PAYPAL|RESEND|R2|AWS|SMTP|RAILWAY/i);
Object.assign(process.env, config, { DCN_ENABLED: "true", DCN_MODE: "TEST", DCN_NEW_PAYMENTS_ENABLED: "false", DCN_EXTERNAL_TEST_AUTHORIZED: "false", DCN_LOCAL_REVIEW_AUTHORIZED: "true" });
globalThis.fetch = async () => { throw Error("External calls are forbidden in this local preparation."); };
const { prisma } = await import("@/lib/prisma");
const { saveOffer } = await import("@/lib/digital/catalog");
const { loadDigitalExcerptSelection } = await import("@/lib/digital/excerpt-service");
const projectId = "e62bfcea-6d0c-4a9c-8de9-eee8961c30d7";
const serialize = (value: unknown) => JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item);
const digest = (value: unknown) => createHash("sha256").update(serialize(value)).digest("hex");
async function canaries() {
  const result: Record<string, unknown> = {};
  for (const table of ["digital_orders", "digital_order_lines", "digital_entitlements", "digital_documents", "digital_masters"] as const) {
    const rows = await prisma.$queryRawUnsafe<Array<{ count: number; checksum: string }>>(`SELECT count(*)::integer AS count, md5(coalesce(string_agg(md5(to_jsonb(t)::text), '' ORDER BY t.id),'')) AS checksum FROM public.${table} t`);
    result[table] = rows[0];
  }
  return result;
}
try {
  const identity = await prisma.$queryRaw<Array<{ db: string; role: string; superuser: boolean; owner: boolean }>>`SELECT current_database() AS db, current_user AS role, r.rolsuper AS superuser, d.datdba=r.oid AS owner FROM pg_roles r JOIN pg_database d ON d.datname=current_database() WHERE r.rolname=current_user`;
  assert.equal(identity[0].db, target.pathname.slice(1)); assert.equal(identity[0].role, "dcn_runtime_a");
  assert.equal(identity[0].superuser, false); assert.equal(identity[0].owner, false);
  const album = await prisma.project.findUniqueOrThrow({ where: { id: projectId }, include: { tracks: { orderBy: { position: "asc" }, include: { digitalMasters: { where: { status: "READY" }, orderBy: { version: "desc" }, take: 1, include: { masterAsset: true, mp3Asset: true, previewAsset: true } } } } } });
  assert.equal(album.slug, "vie-de-chien"); assert.equal(album.tracks.length, 12);
  const masters = album.tracks.map(t => { assert.equal(t.digitalMasters.length, 1); return t.digitalMasters[0]; });
  const media = masters.flatMap(m => [m.masterAsset, m.mp3Asset, m.previewAsset]);
  assert.equal(media.length, 36);
  for (const asset of media) { assert.ok(asset); assert.equal(asset.rightsStatus, "PENDING"); assert.match(asset.checksumSha256 ?? "", /^[a-f0-9]{64}$/); }
  assert.ok(masters.every(m => m.masterAsset.visibility === "PRIVATE" && m.mp3Asset?.visibility === "PRIVATE" && m.previewStartMs === 0 && (m.previewDurationMs ?? 0) <= 60_000));
  const before = await canaries();
  const mediaDigest = digest(media.map(a => ({ id: a!.id, checksum: a!.checksumSha256, key: a!.storageKey, visibility: a!.visibility, rights: a!.rightsStatus, duration: a!.durationMs })));
  const actorRow = await prisma.user.findFirstOrThrow({ where: { role: "ADMIN", status: "ACTIVE", emailVerified: true, displayName: "Admin QA édition privée", email: { endsWith: "@example.invalid" } }, orderBy: { createdAt: "desc" } });
  const actor = { id: actorRow.id, email: actorRow.email, name: actorRow.displayName, role: "ADMIN" as const, status: "ACTIVE" as const, emailVerified: true as const };
  const targets = [{ trackId: null as string | null, priceCents: 990 }, ...album.tracks.map(t => ({ trackId: t.id, priceCents: 129 }))];
  const writes: string[] = [];
  for (const row of targets) {
    const current = await prisma.digitalOffer.findFirst({ where: { projectId, trackId: row.trackId } });
    if (current) { assert.equal(current.active, false); assert.equal(current.rightsConfirmed, false); }
    if (current?.priceCents === row.priceCents) continue;
    if (apply) writes.push(await saveOffer(actor, { projectId, trackId: row.trackId, priceCents: row.priceCents, active: false, rightsConfirmed: false, expectedVersion: current?.version ?? 0, distribution: current?.distribution ?? "DISTRIBUTED" }));
  }
  const offers = await prisma.digitalOffer.findMany({ where: { projectId }, orderBy: [{ scope: "asc" }, { trackId: "asc" }], select: { id: true, scope: true, trackId: true, priceCents: true, currency: true, active: true, rightsConfirmed: true, version: true } });
  if (apply) {
    assert.equal(offers.length, 13);
    assert.equal(offers.filter(o => o.scope === "ALBUM" && o.priceCents === 990).length, 1);
    assert.equal(offers.filter(o => o.scope === "TRACK" && o.priceCents === 129).length, 12);
    assert.ok(offers.every(o => !o.active && !o.rightsConfirmed && o.currency === "EUR"));
  }
  const after = await canaries(); assert.deepEqual(after, before);
  const afterMedia = await prisma.asset.findMany({ where: { id: { in: media.map(a => a!.id) } } });
  const indexed = new Map(afterMedia.map(a => [a.id, a]));
  assert.equal(digest(media.map(a => { const v = indexed.get(a!.id)!; return { id: v.id, checksum: v.checksumSha256, key: v.storageKey, visibility: v.visibility, rights: v.rightsStatus, duration: v.durationMs }; })), mediaDigest);
  const excerptStates = await Promise.all(masters.map(async m => ({ masterId: m.id, trackId: m.trackId, provisionalStartMs: m.previewStartMs, provisionalDurationMs: m.previewDurationMs, rightsStatus: "PENDING", selection: await loadDigitalExcerptSelection(prisma, m) })));
  const proof = { at: new Date().toISOString(), mode: apply ? "APPLY_QA_ONLY" : "READ_ONLY", identity: identity[0], projectId, slug: album.slug, formatsIncluded: ["WAV", "MP3"], formatSurchargeCents: 0, offers, writes, canariesBefore: before, canariesAfter: after, mediaIdentityUnchanged: true, currentMasterCount: masters.length, excerptStates, productionMutation: false };
  await mkdir(output!.slice(0, output!.lastIndexOf("/")), { recursive: true });
  await writeFile(output!, JSON.stringify(proof, null, 2), { mode: 0o600 });
  console.log(JSON.stringify({ result: "PASS", mode: proof.mode, offers: offers.length, writes: writes.length, trackPriceCents: 129, albumPriceCents: 990, historyUnchanged: true, mediaIdentityUnchanged: true, output }));
} finally { await prisma.$disconnect(); }
