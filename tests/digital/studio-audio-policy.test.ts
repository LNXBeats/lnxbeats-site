import assert from "node:assert/strict";
import test from "node:test";
import { parseStudioFfmetadata, parseStudioMeasurements } from "@/lib/digital/studio-audio";
import { STUDIO_DISABLED_MODULES, studioDownloadName, studioGainPlan, studioOfficialTags } from "@/lib/digital/studio-audio-policy";

test("Studio only attenuates peaks and never forces a -14 LUFS preset", () => {
  assert.equal(studioGainPlan(-24, -6).gainDb, 0);
  assert.deepEqual(studioGainPlan(-20, -.2), { gainDb: -1, targetDbtp: -1.2, ceilingDbtp: -1, measurable: true });
  assert.equal(studioGainPlan(-8, -.1).gainDb, -2.1);
  assert.equal(studioGainPlan(null, null).measurable, false);
  assert.equal(STUDIO_DISABLED_MODULES.includes("limiter"), true);
  assert.throws(() => studioGainPlan(NaN, -1));
});
test("a stereo MP3 under the hard ceiling is preserved even if just above the indicative target", () => {
  assert.equal(studioGainPlan(-12.93, -2.12, { preserveCompliantMp3: true }).gainDb, 0);
  assert.equal(studioGainPlan(-12.93, -2, { preserveCompliantMp3: true }).gainDb, 0);
  assert.ok(studioGainPlan(-12.93, -1.99, { preserveCompliantMp3: true }).gainDb < 0);
  assert.equal(studioGainPlan(-20, -1.1, { preserveCompliantMp3: true }).gainDb, 0);
  assert.ok(studioGainPlan(-20, -.99, { preserveCompliantMp3: true }).gainDb < 0);
  assert.ok(studioGainPlan(-12.93, -2.12).gainDb < 0, "PCM/mono retain their conservative target policy");
});
test("download names and official tags preserve exact Unicode titles and real supplementary credits", () => {
  const title = "Ça l'fait — 東京, 你好 !";
  assert.equal(studioDownloadName(title, "MP3"), `${title}.mp3`);
  assert.equal(studioDownloadName(title, "WAV_CD"), `${title}.wav`);
  assert.equal(studioDownloadName(title, "WAV_24"), `${title}.wav`);
  const tags = studioOfficialTags(title, undefined, { album: "unrelated old album", composer: "Compositeur réel", producer: "Producteur réel", isrc: "FR0000000001" });
  assert.equal(tags.album, undefined); assert.equal(tags.composer, "Compositeur réel");
  assert.equal(tags.artist, "LNX Beats"); assert.equal(tags.studio, "LNX Beats Studio"); assert.equal(tags.isrc, "FR0000000001");
  assert.equal(tags.producer, "Producteur réel"); assert.equal(tags.production_studio, "LNX Beats Studio");
  assert.throws(() => studioDownloadName("../title", "MP3"));
});
test("metadata rereading is lossless and incomplete measurement logs cannot pass", () => {
  assert.deepEqual(parseStudioFfmetadata(";FFMETADATA1\ntitle=Ça l'fait — 東京\\=a\\;b\nartist=LNX Beats\n"), { title: "Ça l'fait — 東京=a;b", artist: "LNX Beats" });
  assert.throws(() => parseStudioFfmetadata("not metadata"));
  assert.throws(() => parseStudioMeasurements("progress=end\n", 2, 1000), { code: "STUDIO_MEASUREMENT_INCOMPLETE" });
});
