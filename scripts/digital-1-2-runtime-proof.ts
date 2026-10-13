/** Local acquisition evidence. No catalogue/payment mutation or external API.
 * --baseline: SQL/file reads only. --verify: repeats reads and performs normal
 * local QA auth/ticket/download checks (their own audit/use/session writes). */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";
import { assertMediaStorageKey } from "@/lib/media/storage/policy";
import type { DigitalSelection } from "@/lib/digital/domain";
const mode = process.argv[2]; assert.ok(mode === "--baseline" || mode === "--verify", "Use --baseline or --verify.");
const orderId = "dd422376-e61b-412e-9f33-754d5ca99146";
const cfg = JSON.parse(await readFile(".private/dcn-review-config.json", "utf8")) as Record<string, string>;
const db = assertSafeLocalPostgresUrl(cfg.DATABASE_URL); assert.equal(db.hostname, "127.0.0.1"); assert.equal(db.port, "55473"); assert.equal(db.pathname, "/lnx_dcn_runtime_test"); assert.equal(db.username, "dcn_runtime_a");
assert.equal(cfg.AUTH_URL, "http://127.0.0.1:3140"); assert.equal(cfg.DCN_MODE, "TEST"); assert.equal(cfg.DCN_ENABLED, "true"); assert.equal(cfg.DCN_NEW_PAYMENTS_ENABLED, "false"); assert.equal(cfg.MEDIA_STORAGE_DRIVER, "local"); assert.equal(cfg.EMAIL_PROVIDER, "capture");
for (const [key, value] of Object.entries(cfg)) assert.ok(!value || !/(STRIPE|PAYPAL|RESEND|LIVE)/i.test(key), "No external provider credentials permitted.");
const privateRoot = path.resolve(cfg.MEDIA_LOCAL_PRIVATE_ROOT); assert.ok(privateRoot.startsWith("/private/tmp/"));
Object.assign(process.env, cfg);
const { prisma } = await import("@/lib/prisma");
const { billingSnapshotHash } = await import("@/lib/billing/domain");
const proofRoot = path.resolve("output/dcn-1-2/proofs"); await mkdir(proofRoot, { recursive: true });
const baselinePath = path.join(proofRoot, "acquired-12-baseline.json");
const sha = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim();
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
function crcUpdate(crc: number, bytes: Uint8Array) { for (const b of bytes) crc = crcTable[(crc ^ b) & 255] ^ (crc >>> 8); return crc >>> 0; }
async function digestFile(file: string, start?: number, end?: number) {
  const hash = createHash("sha256"); let bytes = 0, crc = 0xffffffff;
  for await (const chunk of createReadStream(file, { ...(start !== undefined ? { start } : {}), ...(end !== undefined ? { end } : {}) })) { bytes += chunk.length; hash.update(chunk); crc = crcUpdate(crc, chunk); }
  return { bytes, sha256: hash.digest("hex"), crc32: (crc ^ 0xffffffff) >>> 0 };
}
function mediaPath(key: string) { assertMediaStorageKey("private", key); const file = path.resolve(privateRoot, key); assert.ok(file.startsWith(`${privateRoot}${path.sep}`)); return file; }
function safeZipName(raw: string) { let n = raw.normalize("NFC").replace(/[\x00-\x1f\\/<>:"|?*]/g, "-").replace(/^\.+/, "-").slice(0, 180).replace(/[. ]+$/, ""); if (/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(n)) n = `_${n}`; return n; }
async function exact(handle: Awaited<ReturnType<typeof open>>, count: number, offset: number) { const bytes = Buffer.alloc(count); const got = await handle.read(bytes, 0, count, offset); assert.equal(got.bytesRead, count); return bytes; }
const jars: Map<string, string>[] = [];
let credentials: Record<string, string> | null = null;
async function call(jar: Map<string, string>, route: string, options: RequestInit = {}) {
  assert.ok(route.startsWith("/") && !route.startsWith("//"));
  const response = await fetch(`${cfg.AUTH_URL}${route}`, { ...options, redirect: "manual", headers: { Origin: cfg.AUTH_URL, Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join("; "), ...options.headers }, signal: AbortSignal.timeout(120_000) });
  for (const c of response.headers.getSetCookie()) { const first = c.split(";", 1)[0], i = first.indexOf("="); jar.set(first.slice(0, i), first.slice(i + 1)); } return response;
}
async function responseHash(response: Response) { assert.ok(response.body); const h = createHash("sha256"); let bytes = 0; for await (const part of response.body) { bytes += part.byteLength; h.update(part); } return { bytes, sha256: h.digest("hex") }; }
async function signIn(email: string) { assert.ok(email.endsWith("@example.invalid")); const jar = new Map<string, string>(); const r = await call(jar, "/api/auth/sign-in/email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: credentials!.password }) }); assert.equal(r.status, 200, "Synthetic QA sign-in failed."); await r.body?.cancel(); jars.push(jar); return jar; }
try {
  const order = await prisma.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    return tx.digitalOrder.findUniqueOrThrow({ where: { id: orderId }, include: { user: { select: { id: true, email: true } }, fulfillment: true, documents: { select: { id: true, kind: true, status: true, snapshotHash: true, pdfHash: true } }, lines: { include: { archive: true, entitlements: { include: { master: { include: { masterAsset: true } } } } } } } });
  });
  assert.equal(order.mode, "TEST"); assert.equal(order.status, "PAID"); assert.ok(order.user.email === "dcn12-review-member@example.invalid", "Expected synthetic QA owner only."); assert.ok(order.fulfillment?.accessReadyAt); assert.equal(order.lines.length, 1);
  const line = order.lines[0]; assert.equal(line.scope, "ALBUM");
  const snapshot = line.trackSnapshot as unknown as DigitalSelection["tracks"]; assert.equal(snapshot.length, 12); assert.equal(line.entitlements.length, 12); assert.equal(new Set(snapshot.map(t => t.masterId)).size, 12);
  const sourceProof = [] as Array<{ position: number; masterId: string; version: number; bytes: number; sha256: string; zipName: string }>;
  for (const [i, acquired] of snapshot.entries()) {
    const entitlement = line.entitlements.find(e => e.masterId === acquired.masterId); assert.ok(entitlement); assert.equal(entitlement.status, "ACTIVE"); assert.equal(entitlement.userId, order.userId);
    const asset = entitlement.master.masterAsset; assert.equal(asset.visibility, "PRIVATE"); assert.equal(asset.storageBackend, "LOCAL"); assert.equal(asset.storageProvider, "local");
    const actual = await digestFile(mediaPath(asset.storageKey!)); assert.equal(actual.bytes, Number(asset.sizeBytes)); assert.equal(actual.sha256, asset.checksumSha256);
    sourceProof.push({ position: i + 1, masterId: acquired.masterId, version: entitlement.master.version, bytes: actual.bytes, sha256: actual.sha256, zipName: safeZipName(`${String(i + 1).padStart(2, "0")}-${acquired.title}.${asset.filename.split(".").pop()}`) });
  }
  const archive = line.archive; assert.ok(archive); assert.equal(archive.status, "READY"); assert.equal(archive.snapshotHash, billingSnapshotHash(line.trackSnapshot)); assert.equal(archive.storageBackend, "LOCAL"); assert.equal(archive.storageProvider, "local");
  const archiveFile = mediaPath(archive.storageKey!), archiveDigest = await digestFile(archiveFile); assert.equal(archiveDigest.bytes, Number(archive.sizeBytes)); assert.equal(archiveDigest.sha256, archive.checksum);
  const handle = await open(archiveFile, "r"); let offset = 0;
  try {
    const end = await exact(handle, 22, archiveDigest.bytes - 22);
    assert.equal(end.readUInt32LE(0), 0x06054b50); assert.equal(end.readUInt16LE(8), 12); assert.equal(end.readUInt16LE(10), 12); assert.equal(end.readUInt16LE(20), 0);
    for (const source of sourceProof) {
      const h = await exact(handle, 30, offset); assert.equal(h.readUInt32LE(0), 0x04034b50); assert.equal(h.readUInt16LE(8), 0, "Only generated STORE archive expected.");
      const nameLength = h.readUInt16LE(26), extraLength = h.readUInt16LE(28); assert.ok(nameLength > 0 && nameLength <= 4096); assert.equal((await exact(handle, nameLength, offset + 30)).toString("utf8"), source.zipName);
      const bodyOffset = offset + 30 + nameLength + extraLength;
      const entry = await digestFile(archiveFile, bodyOffset, bodyOffset + source.bytes - 1); assert.equal(entry.bytes, source.bytes); assert.equal(entry.sha256, source.sha256);
      const d = await exact(handle, 16, bodyOffset + source.bytes); assert.equal(d.readUInt32LE(0), 0x08074b50); assert.equal(d.readUInt32LE(4), entry.crc32); assert.equal(d.readUInt32LE(8), source.bytes); assert.equal(d.readUInt32LE(12), source.bytes);
      offset = bodyOffset + source.bytes + 16;
    }
    assert.equal((await exact(handle, 4, offset)).readUInt32LE(0), 0x02014b50);
    assert.equal(end.readUInt32LE(16), offset);
  } finally { await handle.close(); }
  execFileSync("unzip", ["-t", archiveFile], { stdio: "pipe", timeout: 30_000, maxBuffer: 1024 * 1024 });
  const browserZip = "/Users/lnxbeats/Downloads/DCN‑1.2 — Album synthétique de 12 pistes — Album.zip", browserTrack = "/Users/lnxbeats/Downloads/QA — Piste 01.wav";
  const browserZipDigest = await digestFile(browserZip), browserTrackDigest = await digestFile(browserTrack);
  assert.equal(browserZipDigest.bytes, archiveDigest.bytes); assert.equal(browserZipDigest.sha256, archiveDigest.sha256); assert.equal(browserTrackDigest.bytes, sourceProof[0].bytes); assert.equal(browserTrackDigest.sha256, sourceProof[0].sha256);
  const immutable = { orderId, lineId: line.id, snapshotHash: billingSnapshotHash(line.trackSnapshot), contractHash: billingSnapshotHash(order.contractSnapshot), totalCents: order.totalCents,
    sources: sourceProof, archive: { bytes: archiveDigest.bytes, sha256: archiveDigest.sha256 }, documents: order.documents.map(d => ({ id: d.id, kind: d.kind, status: d.status, snapshotHash: d.snapshotHash, pdfHash: d.pdfHash })).sort((a, b) => a.id.localeCompare(b.id)) };
  const evidence: Record<string, unknown> = { exportFiltered: true, privacyReviewed: "Only synthetic identifiers, amounts, counts and checksums; no paths, emails, credentials or file bodies", environment: "LOCAL_LOOPBACK_SYNTHETIC_ONLY", codeSha: sha, codeState: "Workingtree DCN-1.2; final code equivalence reviewed separately", capturedAt: new Date().toISOString(), phase: mode.slice(2), immutable,
    sourceChecksums: "PASS", twelveZipEntriesEqualAcquiredMasters: "PASS", zipCrcIntegrity: "PASS", browserSavedZipMatchesSource: "PASS", browserSavedFirstTrackMatchesSource: "PASS", realSafariPhysical: "NOT_RUN", externalProviderCalls: 0,
    catalogueMutation: false, orderFinancialMutation: false, masterMutation: false, dbReadTransaction: "READ_ONLY" };
  if (mode === "--baseline") { await writeFile(baselinePath, `${JSON.stringify(evidence, null, 2)}\n`); }
  else {
    const before = JSON.parse(await readFile(baselinePath, "utf8")); assert.deepEqual(immutable, before.immutable, "An acquisition/source/archive/document changed after catalogue edit."); evidence.immutableAfterMasterAndCompositionChange = "PASS";
    const current = await prisma.$transaction(async tx => {
      await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
      return tx.track.findMany({ where: { id: { in: snapshot.map(t => t.trackId) } }, select: { id: true, status: true, digitalMasters: { where: { status: "READY" }, orderBy: { version: "desc" }, take: 1, include: { masterAsset: true } } } });
    });
    assert.equal(current.filter(t => t.status === "RELEASED").length, 11, "Expected documented browser album-composition edit before restoration.");
    const newest = current.find(t => t.id === snapshot[0].trackId)?.digitalMasters[0]; assert.ok(newest); assert.equal(newest.version, 2); assert.notEqual(newest.id, sourceProof[0].masterId);
    const replacement = await digestFile(mediaPath(newest.masterAsset.storageKey!)); assert.equal(replacement.sha256, newest.masterAsset.checksumSha256); assert.notEqual(replacement.sha256, sourceProof[0].sha256);
    evidence.currentCatalogueContrasts = { releasedTrackCount: 11, acquiredTrackCountStill: 12, newestFirstMasterVersion: 2, acquiredFirstMasterVersion: sourceProof[0].version, replacementBytes: replacement.bytes, replacementSha256: replacement.sha256, distinctFromAcquiredMaster: true };
    credentials = JSON.parse(await readFile(".private/dcn-review-credentials.json", "utf8"));
    const owner = await signIn("dcn12-review-member@example.invalid"), other = await signIn(credentials!.memberEmail); assert.notEqual(credentials!.memberEmail, order.user.email);
    const download = async (masterId: string | null, expected: { bytes: number; sha256: string }) => {
      const creation = await call(owner, "/api/digital/library/download", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lineId: line.id, masterId }) }); assert.equal(creation.status, 200);
      const { url } = await creation.json() as { url: string }; assert.match(url, /^\/api\/digital\/download\/[0-9a-f-]{36}$/); const ticketId = url.split("/").at(-1)!;
      const head = await call(owner, url, { method: "HEAD" }); assert.equal(head.status, 200); assert.equal(Number(head.headers.get("content-length")), expected.bytes); assert.equal(head.headers.get("cache-control"), "private, no-store"); assert.equal((await prisma.digitalDownloadTicket.findUniqueOrThrow({ where: { id: ticketId } })).usesLeft, 32);
      const range = await call(owner, url, { headers: { Range: "bytes=0-99" } }); assert.equal(range.status, 206); assert.equal((await range.arrayBuffer()).byteLength, 100);
      const full = await call(owner, url); assert.equal(full.status, 200); assert.deepEqual(await responseHash(full), expected);
      // A valid ticket cookie alone never substitutes for the owning identity.
      const stolen = new Map(other); for (const [key, value] of owner) if (key === `dcn_download_${ticketId}`) stolen.set(key, value);
      const denial = await call(stolen, url); assert.equal(denial.status, 404); await denial.body?.cancel();
      const anonymous = await fetch(`${cfg.AUTH_URL}${url}`, { redirect: "manual", signal: AbortSignal.timeout(30_000) }); assert.equal(anonymous.status, 404); await anonymous.body?.cancel();
      return { head: 200, range: 206, full: 200, nonownerWithTicket: 404, anonymous: 404, bytes: expected.bytes, checksum: "PASS" };
    };
    evidence.httpGatewayTrack = await download(sourceProof[0].masterId, { bytes: sourceProof[0].bytes, sha256: sourceProof[0].sha256 });
    evidence.httpGatewayAlbum = await download(null, { bytes: archiveDigest.bytes, sha256: archiveDigest.sha256 });
    evidence.expectedLocalQaMutations = ["own temporary auth sessions", "dedicated download tickets", "rate counters", "append-only download audits", "ticket use counts"];
    await writeFile(path.join(proofRoot, "acquired-12-after-edit.json"), `${JSON.stringify(evidence, null, 2)}\n`);
  }
  console.log(JSON.stringify({ phase: mode.slice(2), orderTrackCount: 12, archiveBytes: archiveDigest.bytes, sourcesAndZipChecksum: "PASS", savedBrowserDownloads: "PASS", preservation: mode === "--verify" ? "PASS" : "BASELINE_CAPTURED", gateway: mode === "--verify" ? "PASS" : "NOT_RUN", providerCalls: 0, financialMutation: false }));
} finally {
  for (const jar of jars) { try { const out = await call(jar, "/api/auth/sign-out", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); assert.equal(out.status, 200); await out.body?.cancel(); } finally { jar.clear(); } }
  if (credentials) credentials.password = "";
  await prisma.$disconnect();
}
