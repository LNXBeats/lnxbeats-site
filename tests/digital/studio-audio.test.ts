import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { catalogFfmpegPath } from "@/lib/catalog/ffmpeg";
import { processStudioAudio } from "@/lib/digital/studio-audio";

const exec = promisify(execFile), digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
async function fixture(root: string, type: "wav16" | "wav24" | "mp3" | "mono" | "hot" | "antiphase" | "silence") {
  const output = path.join(root, `source.${type === "mp3" ? "mp3" : "wav"}`), args = ["-v", "error", "-f", "lavfi", "-i", type === "silence" ? "anullsrc=sample_rate=48000:channel_layout=stereo:d=4" : "sine=frequency=440:sample_rate=48000:duration=4"];
  if (type === "mono") args.push("-ac", "1");
  else args.push("-af", type === "hot" ? "volume=8,pan=stereo|c0=c0|c1=c0" : type === "antiphase" ? "pan=stereo|c0=c0|c1=-1*c0" : "pan=stereo|c0=c0|c1=c0", "-ac", "2");
  args.push(...(type === "mp3" ? ["-c:a", "libmp3lame", "-b:a", "192k"] : ["-c:a", type === "wav16" ? "pcm_s16le" : "pcm_s24le"]), "-metadata", "composer=Une personne réelle", "-metadata", "producer=Producteur réel", "-metadata", "copyright=Droits réellement renseignés", "-metadata", "ISRC=FR0000000001", "-n", output);
  await exec(catalogFfmpegPath(), args, { timeout: 30000 });
  return output;
}
for (const kind of ["wav16", "wav24", "mp3", "mono", "hot", "antiphase", "silence"] as const) {
  test(`synthetic ${kind}: complete analysis, three private validated formats, tags, immutable source and no auto approval`, { timeout: 90000 }, async () => {
    const root = await mkdtemp("/private/tmp/lnx-studio-audio-test-"), source = await fixture(root, kind), before = digest(await readFile(source));
    try {
      const progress: string[] = [], result = await processStudioAudio({ source, outputDirectory: path.join(root, "attempt"), title: "Ça l'fait — 東京, 你好 !", album: "Album réel", metadata: { composer: "Compositeur documenté", producer: "Producteur réel", collaborator: "Collaboration documentée", engineer: "Ingénieur documenté" }, signal: new AbortController().signal, onProgress: stage => { progress.push(stage); } });
      assert.deepEqual(progress, ["ANALYZING", "MASTERING", "CONVERTING", "VERIFYING", "READY_TO_LISTEN"]);
      assert.equal(result.source.sha256, before); assert.equal(digest(await readFile(source)), before);
      assert.equal(result.formats.WAV_CD.sampleRate, 44100); assert.equal(result.formats.WAV_CD.bitsPerSample, 16);
      assert.equal(result.formats.WAV_24.sampleRate, 48000); assert.equal(result.formats.WAV_24.bitsPerSample, 24);
      assert.equal(result.report.humanAudioApproval, false); assert.equal(result.report.rightsApproval, false); assert.equal(result.report.published, false);
      assert.match(result.report.tools.ffmpeg, /^ffmpeg version /);
      assert.equal(result.formats.MP3.audioReencoded, kind !== "mp3");
      if (kind === "mp3") { assert.equal(result.formats.MP3.bitrateKbps, 192); assert.equal(result.sourceLossy, true); assert.ok(result.report.warnings.some(value => value.startsWith("LOSSY_SOURCE"))); }
      if (kind === "hot") assert.ok(result.plan.gainDb < 0); else assert.equal(result.plan.gainDb, 0);
      if (kind === "antiphase") assert.ok(result.source.measurements.phaseCorrelation! < -.99);
      if (kind === "silence") { assert.equal(result.source.measurements.integratedLufs, null); assert.equal(result.plan.measurable, false); assert.ok(result.report.warnings.some(value => value.startsWith("LOUDNESS_NOT_MEASURABLE"))); }
      for (const output of Object.values(result.formats)) {
        assert.equal(output.filename, `Ça l'fait — 東京, 你好 !.${output.format === "MP3" ? "mp3" : "wav"}`);
        assert.equal(output.tags.title, "Ça l'fait — 東京, 你好 !"); assert.equal(output.tags.artist, "LNX Beats Studio"); assert.equal(output.tags.album_artist, "LNX Beats Studio");
        assert.equal(output.tags.studio, "LNX Beats Studio"); assert.equal(output.tags.production_studio, "LNX Beats Studio");
        assert.equal(output.tags.producer, "Producteur réel"); assert.equal(output.tags.composer, "Compositeur documenté"); assert.equal(output.tags.collaborator, "Collaboration documentée");
        assert.equal(output.tags.engineer, "Ingénieur documenté"); assert.notEqual(output.tags.ieng, "LNX Beats Studio");
        assert.equal(output.tags.comment, "Création LNX Beats Studio"); assert.equal(output.tags.album, "Album réel");
        assert.equal(output.tags.isrc, "FR0000000001"); assert.equal(output.tags.copyright, "Droits réellement renseignés");
        assert.equal(output.integrityVerified, true); assert.equal(output.sha256, digest(await readFile(output.path)));
        assert.equal(output.measurements.channels.length, 2);
        assert.ok(output.measurements.truePeakDbtp === null || output.measurements.truePeakDbtp <= ((output.measurements.integratedLufs ?? -Infinity) > -14 ? -1.99 : -.99));
      }
      assert.ok(result.preview.durationMs <= 60000); assert.equal(result.audition24.basedOnSha256, result.formats.WAV_24.sha256);
      assert.ok(result.report.ffmpegRssSamples > 0); assert.equal(result.plan.ditherApplications.WAV_CD, 1);
      assert.equal((await stat(path.join(root, "attempt"))).mode & 0o077, 0);
      console.log(JSON.stringify({ fixture: kind, ffmpegRssPeak: result.report.ffmpegRssPeakBytes, samples: result.report.ffmpegRssSamples, sourceLufs: result.source.measurements.integratedLufs, gainDb: result.plan.gainDb,
        formats: Object.fromEntries(Object.entries(result.formats).map(([key, value]) => [key, { bytes: value.sizeBytes, tp: value.measurements.truePeakDbtp, lufs: value.measurements.integratedLufs, sha256: value.sha256 }])) }));
    } finally { await rm(root, { recursive: true, force: true }); }
  });
}
test("empty/corrupt/wrong/truncated sources fail closed and existing attempt files are never overwritten", { timeout: 30000 }, async () => {
  const root = await mkdtemp("/private/tmp/lnx-studio-audio-invalid-");
  try {
    const good = await fixture(root, "wav24"), bytes = await readFile(good);
    for (const [index, content] of [Buffer.alloc(0), Buffer.from("this is not audio"), bytes.subarray(0, bytes.length - 10)].entries()) {
      const source = path.join(root, `invalid${index}.wav`); await writeFile(source, content, { flag: "wx" });
      await assert.rejects(processStudioAudio({ source, outputDirectory: path.join(root, `attempt${index}`), title: "Test", signal: new AbortController().signal }));
      assert.deepEqual(await readFile(source), content);
    }
    const abort = new AbortController(); abort.abort();
    await assert.rejects(processStudioAudio({ source: good, outputDirectory: path.join(root, "cancelled"), title: "Test", signal: abort.signal }), { code: "LEASE_LOST" });
    await assert.rejects(processStudioAudio({ source: good, outputDirectory: root, title: "Test", signal: new AbortController().signal }), { code: "STUDIO_ATTEMPT_DIRECTORY_EXISTS" });
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("export collision and cancellation preserve original and fail without overwriting another file", { timeout: 30000 }, async () => {
  const root = await mkdtemp("/private/tmp/lnx-studio-audio-cancel-");
  try {
    const source = await fixture(root, "wav24"), before = digest(await readFile(source)), collision = Buffer.from("Synthetic file that must not be overwritten");
    const outputDirectory = path.join(root, "collision");
    await assert.rejects(processStudioAudio({ source, outputDirectory, title: "Test", signal: new AbortController().signal, onProgress: async stage => {
      if (stage === "CONVERTING") await writeFile(path.join(outputDirectory, "mp3.mp3"), collision, { flag: "wx" });
    } }), { code: "INVALID_AUDIO" });
    assert.deepEqual(await readFile(path.join(outputDirectory, "mp3.mp3")), collision);
    const abort = new AbortController();
    await assert.rejects(processStudioAudio({ source, outputDirectory: path.join(root, "cancelled"), title: "Test", signal: abort.signal, onProgress: stage => { if (stage === "CONVERTING") abort.abort(); } }), { code: "LEASE_LOST" });
    assert.equal(digest(await readFile(source)), before);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("a synthetic phase inversion introduced during export is rejected rather than approved", { timeout: 30000 }, async () => {
  const root = await mkdtemp("/private/tmp/lnx-studio-audio-phase-");
  try {
    const source = await fixture(root, "wav24"), before = digest(await readFile(source)), outputDirectory = path.join(root, "attempt");
    await assert.rejects(processStudioAudio({ source, outputDirectory, title: "Test", signal: new AbortController().signal, onProgress: async stage => {
      if (stage !== "VERIFYING") return;
      const generated = path.join(outputDirectory, "cd.wav"), bytes = await readFile(generated);
      let offset = 12;
      while (offset + 8 <= bytes.length) {
        const id = bytes.toString("ascii", offset, offset + 4), size = bytes.readUInt32LE(offset + 4);
        if (id === "data") { for (let sample = offset + 10; sample < offset + 8 + size; sample += 4) bytes.writeInt16LE(-bytes.readInt16LE(sample), sample); break; }
        offset += 8 + size + size % 2;
      }
      await writeFile(generated, bytes);
    } }), { code: "STUDIO_PHASE_DEGRADATION" });
    assert.equal(digest(await readFile(source)), before);
  } finally { await rm(root, { recursive: true, force: true }); }
});
for (const defect of ["tail-cut", "peak-over-ceiling"] as const) test(`a structurally valid export with ${defect} is rejected`, { timeout: 30000 }, async () => {
  const root = await mkdtemp("/private/tmp/lnx-studio-audio-defect-");
  try {
    const source = await fixture(root, "wav24"), before = digest(await readFile(source)), outputDirectory = path.join(root, "attempt");
    await assert.rejects(processStudioAudio({ source, outputDirectory, title: "Test", signal: new AbortController().signal, onProgress: async stage => {
      if (stage !== "VERIFYING") return;
      const generated = path.join(outputDirectory, "cd.wav"), bytes = await readFile(generated);
      let offset = 12;
      while (offset + 8 <= bytes.length) {
        const size = bytes.readUInt32LE(offset + 4);
        if (bytes.toString("ascii", offset, offset + 4) === "data") {
          if (defect === "peak-over-ceiling") {
            for (let sample = offset + 8; sample < offset + 8 + size; sample += 2) bytes.writeInt16LE(Math.max(-32768, Math.min(32767, bytes.readInt16LE(sample) * 8)), sample);
            await writeFile(generated, bytes);
          } else {
            const removed = 44100 * 4, cut = Buffer.concat([bytes.subarray(0, offset + 8 + size - removed), bytes.subarray(offset + 8 + size)]);
            cut.writeUInt32LE(cut.length - 8, 4); cut.writeUInt32LE(size - removed, offset + 4);
            await writeFile(generated, cut);
          }
          break;
        }
        offset += 8 + size + size % 2;
      }
    } }), { code: defect === "tail-cut" ? "STUDIO_END_TRUNCATED" : "STUDIO_TRUE_PEAK_CEILING" });
    assert.equal(digest(await readFile(source)), before);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("a floating-point source containing NaN samples cannot become a validated rendition", { timeout: 30000 }, async () => {
  const root = await mkdtemp("/private/tmp/lnx-studio-audio-nan-");
  try {
    const source = path.join(root, "source.wav");
    await exec(catalogFfmpegPath(), ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=4", "-ac", "2", "-c:a", "pcm_f64le", "-n", source]);
    const bytes = await readFile(source); let offset = 12;
    while (offset + 8 <= bytes.length) {
      const size = bytes.readUInt32LE(offset + 4);
      if (bytes.toString("ascii", offset, offset + 4) === "data") { bytes.writeDoubleLE(NaN, offset + 8 + 16 * 128); break; }
      offset += 8 + size + size % 2;
    }
    await writeFile(source, bytes); const before = digest(bytes);
    await assert.rejects(processStudioAudio({ source, outputDirectory: path.join(root, "attempt"), title: "Test", signal: new AbortController().signal }));
    assert.equal(digest(await readFile(source)), before);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("the existing Admin excerpt offset is honored without trimming masters and stays below sixty seconds", { timeout: 90000 }, async () => {
  const root = await mkdtemp("/private/tmp/lnx-studio-audio-offset-");
  try {
    const source = path.join(root, "source.wav");
    await exec(catalogFfmpegPath(), ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=65", "-ac", "2", "-c:a", "pcm_s24le", "-n", source]);
    const before = digest(await readFile(source));
    const result = await processStudioAudio({ source, outputDirectory: path.join(root, "offset"), title: "Test", previewStartMs: 2000, signal: new AbortController().signal });
    assert.equal(result.preview.startMs, 2000); assert.ok(result.preview.durationMs >= 59900 && result.preview.durationMs <= 60000);
    for (const output of Object.values(result.formats)) assert.equal(output.durationMs, 65000);
    assert.equal(digest(await readFile(source)), before);
    await assert.rejects(processStudioAudio({ source, outputDirectory: path.join(root, "invalid-offset"), title: "Test", previewStartMs: 65000, signal: new AbortController().signal }), { code: "INVALID_EXCERPT" });
  } finally { await rm(root, { recursive: true, force: true }); }
});
test("a compliant MP3 near the ceiling is remuxed with identical encoded packets and decoded PCM", { timeout: 30000 }, async () => {
  const root = await mkdtemp("/private/tmp/lnx-studio-audio-safe-mp3-");
  try {
    const source = path.join(root, "source.mp3");
    await exec(catalogFfmpegPath(), ["-v", "error", "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=4", "-af", "volume=6.3,pan=stereo|c0=c0|c1=c0", "-c:a", "libmp3lame", "-b:a", "320k", "-n", source]);
    const before = digest(await readFile(source));
    const result = await processStudioAudio({ source, outputDirectory: path.join(root, "attempt"), title: "Test", signal: new AbortController().signal });
    assert.ok(result.source.measurements.integratedLufs! > -14);
    assert.ok(result.source.measurements.truePeakDbtp! > -2.2 && result.source.measurements.truePeakDbtp! <= -2);
    assert.equal(result.plan.gainDb, 0); assert.equal(result.plan.processing, "NONE"); assert.equal(result.formats.MP3.audioReencoded, false);
    assert.equal(result.formats.MP3.measurements.truePeakDbtp, result.source.measurements.truePeakDbtp);
    const audioHash = async (target: string, decoded: boolean) => (await exec(catalogFfmpegPath(), ["-v", "error", "-i", target, "-map", "0:a:0", "-c:a", decoded ? "pcm_f64le" : "copy", "-f", "hash", "-hash", "sha256", "-"])).stdout.trim();
    assert.equal(await audioHash(source, false), await audioHash(result.formats.MP3.path, false));
    assert.equal(await audioHash(source, true), await audioHash(result.formats.MP3.path, true));
    assert.equal(digest(await readFile(source)), before);
    console.log(JSON.stringify({ syntheticSafeMp3: { sourceLufs: result.source.measurements.integratedLufs, sourceTruePeak: result.source.measurements.truePeakDbtp, gainDb: result.plan.gainDb, audioReencoded: result.formats.MP3.audioReencoded, encodedPacketsAndDecodedPcmIdentical: true } }));
  } finally { await rm(root, { recursive: true, force: true }); }
});
