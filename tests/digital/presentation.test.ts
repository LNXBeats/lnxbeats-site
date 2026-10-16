import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { digitalArchiveLabel, digitalFileFormat, digitalSizeLabel, digitalTimeLabel, digitalLibraryPagination, parseDigitalLibraryPage, isDigitalIntentionalPlaybackAbort } from "@/lib/digital/presentation";
import { DIGITAL_ACTIVE_RIGHTS_ORDER_STATES, digitalCountsOwnedRights } from "@/lib/digital/library-policy";

test("DCN display keeps exact short preview duration and never invents unknown seconds", () => {
  assert.equal(digitalTimeLabel(59900), "0:59");
  assert.equal(digitalTimeLabel(12345), "0:12");
  assert.equal(digitalTimeLabel(183000), "3:03");
  for (const v of [null, undefined, NaN, Infinity, -1]) assert.equal(digitalTimeLabel(v), null);
});
test("DCN coordinated pause of pending play ignores only the intentional AbortError, not real playback failures", () => {
  const abort = new DOMException("The play request was interrupted by a pause", "AbortError");
  assert.equal(isDigitalIntentionalPlaybackAbort(abort, true, true, false), true);
  assert.equal(isDigitalIntentionalPlaybackAbort(abort, false, true, false), false);
  assert.equal(isDigitalIntentionalPlaybackAbort(abort, true, false, false), false);
  assert.equal(isDigitalIntentionalPlaybackAbort(abort, true, true, true), false);
  assert.equal(isDigitalIntentionalPlaybackAbort(new DOMException("Unsupported audio", "NotSupportedError"), true, true, false), false);
  assert.equal(isDigitalIntentionalPlaybackAbort(new Error("Network failure"), true, true, false), false);
  assert.equal(isDigitalIntentionalPlaybackAbort(null, true, true, false), false);
});
test("DCN file labels describe only an existing source format, not an invented derived bundle", () => {
  assert.equal(digitalFileFormat("audio/wav"), "WAV");
  assert.equal(digitalFileFormat("audio/mpeg"), "MP3");
  assert.equal(digitalFileFormat("audio/flac"), "FLAC");
  for (const v of [null, undefined, "application/octet-stream", "audio/aac"]) assert.equal(digitalFileFormat(v), null);
});
test("DCN size labels do not treat absent or unsafe metadata as a valid zero", () => {
  assert.equal(digitalSizeLabel(1024), "1 Kio");
  assert.equal(digitalSizeLabel(1048576), "1 Mio");
  for (const v of [null, undefined, 0, -1, NaN, Infinity, 1.2, Number.MAX_SAFE_INTEGER + 1]) assert.equal(digitalSizeLabel(v), null);
});
test("DCN archive preparation/review is never announced as a ready download", () => {
  assert.equal(digitalArchiveLabel("READY"), "Album ZIP prêt");
  for (const status of [null, "PENDING", "PROCESSING", "REQUIRES_REVIEW", "UNKNOWN"]) assert.ok(!digitalArchiveLabel(status).includes("prêt"));
});
test("DCN catalog rows reuse the media coordinator with lazy previews and keyboard-labelled controls", async () => {
  const source = await readFile(new URL("../../components/digital-catalog.tsx", import.meta.url), "utf8");
  assert.ok(source.includes("listenForOtherMediaPlayback"));
  assert.ok(source.includes("announceMediaPlayback"));
  assert.ok(source.includes('preload="none"'));
  assert.ok(source.includes("Position dans l’extrait de"));
  assert.ok(source.includes('role="status" aria-live="polite"'));
  assert.ok(!source.includes("/digital/masters/"));
});
test("DCN library still gates files by receipt and active rights; acquired snapshot order is retained", async () => {
  const source = await readFile(new URL("../../components/digital-library.tsx", import.meta.url), "utf8");
  const library = await readFile(new URL("../../lib/digital/library.ts", import.meta.url), "utf8");
  assert.ok(source.includes('canDownload=o.accessReady&&["PAID","PARTIALLY_REFUNDED","REFUNDED","GRANTED"].includes(o.status)&&active.length>0'));
  assert.ok(source.includes('active.length===l.acquiredTrackCount'));
  assert.ok(source.includes('archiveStatus==="REQUIRES_REVIEW"'));
  assert.ok(library.includes("snapshot.findIndex(t=>t.masterId===e.masterId)"));
  assert.ok(library.includes("a.acquiredPosition-b.acquiredPosition"));
});
test("DCN full price-reduction retained rights still prevent a redundant purchase, unlike revoked or suspended rights", async () => {
  assert.ok(DIGITAL_ACTIVE_RIGHTS_ORDER_STATES.includes("REFUNDED"));
  assert.equal(digitalCountsOwnedRights("REFUNDED", "ACTIVE"), true);
  for(const state of ["REVOKED","SUSPENDED"]) assert.equal(digitalCountsOwnedRights("REFUNDED",state),false);
  for(const status of ["PENDING","REQUIRES_REVIEW","DISPUTED","FAILED"]) assert.equal(digitalCountsOwnedRights(status,"ACTIVE"),false);
  const catalog=await readFile(new URL("../../lib/digital/catalog.ts",import.meta.url),"utf8");
  assert.ok(catalog.includes('status: "ACTIVE", line: { order: { mode, status: { in: [...DIGITAL_ACTIVE_RIGHTS_ORDER_STATES] } } }'));
  assert.ok(catalog.includes('const mode = requireDigitalEnvironment()'));
});
test("DCN library pagination reaches older acquisitions without a silent 100-order cap or arbitrary client offset", async () => {
  assert.equal(parseDigitalLibraryPage("6"),6);
  for(const input of [undefined,"0","-1","1.2","1e3","9999999",["2","3"]]) assert.equal(parseDigitalLibraryPage(input),1);
  const p=digitalLibraryPagination(6,121);
  assert.equal(p.page,6);assert.equal(p.totalPages,7);assert.equal(p.pageSize,20);assert.equal(p.hasNext,true);
  assert.equal(digitalLibraryPagination(999999,121).page,7);
  assert.equal(digitalLibraryPagination(1,0).totalPages,1);
  const library=await readFile(new URL("../../lib/digital/library.ts",import.meta.url),"utf8");
  assert.ok(library.includes('digitalOrder.count({where:{userId,mode}})'));
  assert.ok(library.includes('digitalOrder.findMany({where:{userId,mode}'));
  assert.ok(library.includes('orderBy:[{createdAt:"desc"},{id:"desc"}]'));
  assert.ok(!library.includes('take:100'));
});
