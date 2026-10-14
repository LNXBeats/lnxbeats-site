import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { acquiredAlbumFormats, acquiredDigitalFormats, acquiredDigitalAssetId, digitalAudioFormat, type DigitalAcquiredTrack } from "@/lib/digital/formats";
import { assertMediaStorageKey } from "@/lib/media/storage/policy";

const master = { masterAssetId: randomUUID(), mp3AssetId: randomUUID() };
const track: DigitalAcquiredTrack = { trackId: randomUUID(), masterId: randomUUID(), title: "QA", position: 1,
  formats: ["WAV", "MP3"], wavAssetId: master.masterAssetId, mp3AssetId: master.mp3AssetId };

test("new purchases pin two distinct asset identities and both formats", () => {
  assert.deepEqual(acquiredDigitalFormats(track), ["WAV", "MP3"]);
  assert.equal(acquiredDigitalAssetId(track, "WAV", master), master.masterAssetId);
  assert.equal(acquiredDigitalAssetId(track, "MP3", master), master.mp3AssetId);
  assert.deepEqual(acquiredAlbumFormats([track, { ...track, masterId: randomUUID() }]), ["WAV", "MP3"]);
});
test("historical purchases retain original format only without snapshot rewrite or MP3 backfill", () => {
  const historical = { trackId: track.trackId, masterId: track.masterId, title: "QA ancienne", position: 1 };
  assert.deepEqual(acquiredDigitalFormats(historical), ["WAV"]);
  assert.equal(acquiredDigitalAssetId(historical, "WAV", master), master.masterAssetId);
  assert.throws(() => acquiredDigitalAssetId(historical, "MP3", master), { code: "FORMAT_NOT_ACQUIRED" });
  assert.deepEqual(acquiredAlbumFormats([track, historical]), ["WAV"]);
});
test("format snapshots fail closed if missing IDs, reordered, duplicated or changed master rendition", () => {
  for (const invalid of [
    { ...track, formats: [] }, { ...track, formats: ["MP3", "WAV"] }, { ...track, formats: ["WAV", "WAV"] },
    { ...track, wavAssetId: undefined }, { ...track, mp3AssetId: undefined }, { ...track, mp3AssetId: track.wavAssetId },
  ]) assert.throws(() => acquiredDigitalFormats(invalid as DigitalAcquiredTrack), { code: "ACQUIRED_FORMAT_INTEGRITY" });
  assert.throws(() => acquiredDigitalAssetId(track, "MP3", { ...master, mp3AssetId: randomUUID() }), { code: "ACQUIRED_FORMAT_INTEGRITY" });
  assert.throws(() => acquiredDigitalAssetId(track, "WAV", { ...master, masterAssetId: randomUUID() }), { code: "ACQUIRED_FORMAT_INTEGRITY" });
});
test("download format rejects path, MIME, prototype and unsupported values", () => {
  assert.equal(digitalAudioFormat("WAV"), "WAV"); assert.equal(digitalAudioFormat("MP3"), "MP3");
  for (const value of [null, undefined, "wav", "FLAC", "audio/mpeg", "../master", { format: "MP3" }, "__proto__"])
    assert.throws(() => digitalAudioFormat(value), { code: "INVALID_DOWNLOAD_FORMAT" });
  assert.throws(() => acquiredAlbumFormats([]), { code: "ARCHIVE_INTEGRITY" });
});
test("derived files and both format archives remain strictly private keys; old keys preserved", () => {
  const id=randomUUID(),asset=randomUUID();
  for(const key of [`digital/derived/${id}/${asset}.mp3`,`digital/archives/${id}/wav/${asset}.zip`,`digital/archives/${id}/mp3/${asset}.zip`,`digital/archives/${id}/${asset}.zip`]){
    assert.doesNotThrow(()=>assertMediaStorageKey("private",key));assert.throws(()=>assertMediaStorageKey("public",key),{code:"INVALID_KEY"});
  }
  for(const key of [`digital/derived/${id}/${asset}.wav`,`digital/archives/${id}/../../${asset}.zip`,`digital/archives/${id}/flac/${asset}.zip`,`digital/derived/${id}/whole-master.mp3`])assert.throws(()=>assertMediaStorageKey("private",key),{code:"INVALID_KEY"});
});
