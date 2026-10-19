import "server-only";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, mkdir, open, readFile, realpath, stat, statfs } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { catalogFfmpegPath } from "@/lib/catalog/ffmpeg";
import { validateDigitalMp3 } from "./audio";
import { DigitalError } from "./domain";
import { runMonitoredFfmpeg } from "./ffmpeg-monitor";
import { inspectDigitalMp3 } from "./mp3-validation";
import { inspectDigitalWav } from "./wav-validation";
import { DIGITAL_WORK_LIMITS } from "./work-slots";
import { STUDIO_AUDIO_VERSION, STUDIO_DISABLED_MODULES, STUDIO_FORMATS, studioDownloadName, studioGainPlan, studioOfficialTags, type StudioFormat, type StudioProgress } from "./studio-audio-policy";

type ChannelMeasurement = { dcOffset: number; rmsDbfs: number | null; samplePeakDbfs: number | null; maximumDifference: number; peakCount: number; observedBitDepth: string | null };
export type StudioMeasurements = {
  integratedLufs: number | null; lraLu: number | null; truePeakDbtp: number | null;
  channels: ChannelMeasurement[]; sampleCount: number; durationMs: number;
  monoRmsDbfs: number | null; phaseCorrelation: number | null; monoCancellationDb: number | null;
  silence: "SILENT" | "MEASURABLE"; diagnostics: Record<string, string>;
};
type SourceDescription = { format: "WAV" | "MP3"; codec: string; durationMs: number; sampleRate: number; channels: number; bitsPerSample: number | null; bitrateKbps: number | null; sizeBytes: number; sha256: string };
export type StudioAudioFile = {
  format: StudioFormat; path: string; filename: string; sizeBytes: number; sha256: string; sampleRate: number; channels: number;
  bitsPerSample: number | null; bitrateKbps: number | null; durationMs: number; codec: string;
  sourceLossy: boolean; audioReencoded: boolean; encodedPacketsSha256: string | null;
  measurements: StudioMeasurements; tags: Record<string, string>; metadataVerified: true; integrityVerified: true;
};
export type StudioAudioResult = {
  version: string; sourceLossy: boolean; source: SourceDescription & { path: string; tags: Record<string, string>; measurements: StudioMeasurements };
  formats: Record<StudioFormat, StudioAudioFile>;
  artifacts: Array<{ role: StudioFormat | "PREVIEW" | "AUDITION_24"; path: string; mimeType: "audio/mpeg" | "audio/wav"; sizeBytes: number; durationMs: number; sampleRate: number; bitDepth: number | null; bitrateKbps: number | null; integratedLufs: number | null; truePeakDbtp: number | null; sha256: string; metadataVerified: boolean }>;
  preview: { path: string; sha256: string; sizeBytes: number; startMs: number; durationMs: number; basedOnFormat: "WAV_24" };
  audition24: { path: string; sha256: string; sizeBytes: number; durationMs: number; encodedListeningCopy: true; basedOnSha256: string };
  plan: ReturnType<typeof studioGainPlan> & { processing: "FIXED_ATTENUATION" | "NONE"; disabledModules: readonly string[]; filters: Record<string, string>; workingPrecision: "PCM_FLOAT64"; workingSampleRate: number; ditherApplications: { WAV_CD: 1; WAV_24: 0; MP3: 0 } };
  report: { status: "READY_TO_LISTEN"; humanAudioApproval: false; rightsApproval: false; published: false; originalUnchanged: true; tools: { ffmpeg: string; ffprobe: "NOT_REQUIRED_FFMPEG_AND_CONTAINER_READER" }; limitations: string[]; warnings: string[]; ffmpegRssPeakBytes: number | "NOT_MEASURED"; ffmpegRssSamples: number };
};

const TIMEOUT = 180_000, MAX_TAG_BYTES = 1024 * 1024;
const HIGH_QUALITY_CD = "aresample=44100:resampler=swr:filter_size=64:phase_shift=10:exact_rational=1:filter_type=kaiser:kaiser_beta=9:cutoff=0.97:osf=s16:dither_method=triangular:output_sample_bits=16";
const measurementsUnavailable = {
  spectralBalance: "NOT_MEASURABLE: no validated musical reference; no automatic EQ",
  hum50or60Hz: "NOT_MEASURABLE: tonal musical energy cannot establish mains hum",
  noise: "NOT_MEASURABLE: no independently identified noise-only segment; no denoising",
  clicks: "REVIEW: sample differences are measured, not a diagnosis of an audible click",
  clipping: "REVIEW: sample peaks and repeated peak counts do not prove clipping",
  discontinuities: "REVIEW: no repair or trimming without reliable diagnosis",
  startEnd: "REVIEW: complete decode and sample-count duration checked; no fade or trim applied",
  criticalListening: "NOT_PERFORMED: requires the administrator",
};
const assertNotAborted = (signal: AbortSignal) => { if (signal.aborted) throw new DigitalError("LEASE_LOST"); };
async function checksum(file: string, signal: AbortSignal) {
  const hash = createHash("sha256");
  for await (const bytes of createReadStream(file)) { assertNotAborted(signal); hash.update(bytes); }
  return hash.digest("hex");
}
function finite(value: unknown, allowSilence = false): number | null {
  if (allowSilence && (value === "-inf" || value === "-Infinity")) return null;
  const number = Number(value);
  if (!Number.isFinite(number) || value === undefined || value === "") throw new DigitalError("STUDIO_MEASUREMENT_INCOMPLETE");
  return number;
}
/** Parses final summaries only. Missing or truncated FFmpeg diagnostics fail closed. */
export function parseStudioMeasurements(stderr: string, expectedChannels: number, durationMs: number): StudioMeasurements {
  if (Array.from(stderr.matchAll(/Number of (?:NaNs|Infs): ([^\r\n]+)/g)).some(match => Number(match[1]) !== 0)) throw new DigitalError("STUDIO_NONFINITE_AUDIO");
  const json = Array.from(stderr.matchAll(/\{\s*"input_i"\s*:[\s\S]*?\n\}/g)).at(-1)?.[0];
  if (!json) throw new DigitalError("STUDIO_MEASUREMENT_INCOMPLETE");
  const loudness = JSON.parse(json) as Record<string, unknown>, channels: ChannelMeasurement[] = [];
  const summaries = stderr.split(/\[Parsed_astats_\d+[^\]]*\] Channel: /).slice(1);
  const metric = (block: string, name: string) => block.match(new RegExp(`${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}: ([^\\r\\n]+)`))?.[1]?.trim();
  for (const block of summaries) {
    const channel = Number(block.match(/^([0-9]+)/)?.[1]);
    if (!Number.isInteger(channel) || channel !== channels.length + 1 || channel > expectedChannels) continue;
    const section = block.split(/\[Parsed_astats_\d+[^\]]*\] (?:Overall|Channel:)/)[0];
    channels.push({ dcOffset: finite(metric(section, "DC offset"))!, rmsDbfs: finite(metric(section, "RMS level dB"), true), samplePeakDbfs: finite(metric(section, "Peak level dB"), true), maximumDifference: finite(metric(section, "Max difference"))!, peakCount: finite(metric(section, "Peak count"))!, observedBitDepth: metric(section, "Bit depth") ?? null });
  }
  const count = Number(Array.from(stderr.matchAll(/Number of samples: ([0-9]+)/g)).at(-1)?.[1]);
  if (channels.length !== expectedChannels || !Number.isSafeInteger(count) || count < 1 || !/^progress=end$/m.test(stderr)) throw new DigitalError("STUDIO_MEASUREMENT_INCOMPLETE");
  const integratedLufs = finite(loudness.input_i, true), truePeakDbtp = finite(loudness.input_tp, true), lraLu = finite(loudness.input_lra, true);
  return { integratedLufs, lraLu, truePeakDbtp, channels, sampleCount: count, durationMs, monoRmsDbfs: null, phaseCorrelation: null, monoCancellationDb: null,
    silence: integratedLufs === null ? "SILENT" : "MEASURABLE", diagnostics: { ...measurementsUnavailable } };
}
/** FFmetadata unescaping is lossless for Unicode, punctuation, '=' and '\\'. */
export function parseStudioFfmetadata(text: string) {
  if (!text.startsWith(";FFMETADATA1") || Buffer.byteLength(text) > MAX_TAG_BYTES) throw new DigitalError("STUDIO_METADATA_INVALID");
  const tags: Record<string, string> = {};
  let line = "", escaped = false;
  for (const char of `${text}\n`) {
    if (escaped) { line += `\\${char}`; escaped = false; continue; }
    if (char === "\\") { escaped = true; continue; }
    if (char !== "\n") { line += char; continue; }
    const entry = line.match(/^([^=]+)=([\s\S]*)$/); line = "";
    if (!entry) continue;
    const decode = (value: string) => value.replace(/\\([\s\S])/g, "$1");
    const key = decode(entry[1]).toLowerCase();
    tags[key === "tsrc" ? "isrc" : key] = decode(entry[2]);
  }
  return tags;
}
const synchSafe = (value: number) => Buffer.from([(value >>> 21) & 127, (value >>> 14) & 127, (value >>> 7) & 127, value & 127]);
/** WAV RIFF INFO lacks album artist/composer/studio. Append an ID3 v2.4 chunk to our new rendition, not the original. */
async function appendWavId3(output: string, tags: Record<string, string>) {
  const frames: Buffer[] = [], names: Record<string, string> = { title: "TIT2", artist: "TPE1", album_artist: "TPE2", album: "TALB", composer: "TCOM", lyricist: "TEXT", copyright: "TCOP", date: "TDRC", isrc: "TSRC", track: "TRCK", genre: "TCON" };
  for (const [key, value] of Object.entries(tags)) {
    if (key === "encoder") continue;
    let id = names[key], payload: Buffer;
    if (key === "comment") { id = "COMM"; payload = Buffer.from(`\u0003fra\u0000${value}`, "utf8"); }
    else if (id) payload = Buffer.from(`\u0003${value}`, "utf8");
    else { id = "TXXX"; payload = Buffer.from(`\u0003${key}\u0000${value}`, "utf8"); }
    frames.push(Buffer.concat([Buffer.from(id, "ascii"), synchSafe(payload.length), Buffer.alloc(2), payload]));
  }
  const payload = Buffer.concat(frames);
  if (payload.length > MAX_TAG_BYTES) throw new DigitalError("STUDIO_METADATA_LIMIT");
  const tag = Buffer.concat([Buffer.from([73, 68, 51, 4, 0, 0]), synchSafe(payload.length), payload]), chunk = Buffer.alloc(8);
  chunk.write("id3 "); chunk.writeUInt32LE(tag.length, 4);
  const file = await open(output, "r+");
  try {
    const original = await file.stat();
    if (original.size + 8 + tag.length + tag.length % 2 > 0xffffffff) throw new DigitalError("MASTER_SIZE_LIMIT");
    await file.write(Buffer.concat([chunk, tag, Buffer.alloc(tag.length % 2)]), 0, 8 + tag.length + tag.length % 2, original.size);
    const size = Buffer.alloc(4); size.writeUInt32LE(original.size + 8 + tag.length + tag.length % 2 - 8);
    await file.write(size, 0, 4, 4);
  } finally { await file.close(); }
}
function metadataArgs(tags: Record<string, string>) { return Object.entries(tags).flatMap(([key, value]) => ["-metadata", `${key}=${value}`]); }
function safeTags(tags: Record<string, string>) {
  const allowed: Record<string, string> = {};
  for (const [rawKey, value] of Object.entries(tags)) {
    const key = rawKey.toLowerCase();
    if (!["encoder", "major_brand", "minor_version", "compatible_brands"].includes(key) && /^[a-z][a-z0-9_ .-]{0,79}$/.test(key) && typeof value === "string" && value.length <= 8192 && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) allowed[key] = value;
  }
  return allowed;
}
export async function processStudioAudio(input: {
  source: string; outputDirectory: string; title: string; album?: string; metadata?: Record<string, string>;
  signal: AbortSignal; previewStartMs?: number; onProgress?: (stage: StudioProgress) => void | Promise<void>;
}): Promise<StudioAudioResult> {
  const { signal } = input;
  assertNotAborted(signal); studioDownloadName(input.title, "MP3");
  const sourcePath = await realpath(input.source), sourceStat = await stat(sourcePath);
  if (!sourceStat.isFile() || sourceStat.size < 4 || sourceStat.size > DIGITAL_WORK_LIMITS.masterBytes || (await lstat(input.source)).isSymbolicLink()) throw new DigitalError("INVALID_AUDIO");
  const output = path.resolve(input.outputDirectory);
  // Caller must allocate a distinct, private, empty attempt directory. Never overwrite or clean another attempt.
  try { await mkdir(output, { mode: 0o700 }); } catch { throw new DigitalError("STUDIO_ATTEMPT_DIRECTORY_EXISTS"); }
  if ((await realpath(output)) !== output || (await lstat(output)).isSymbolicLink() || sourcePath.startsWith(`${output}${path.sep}`)) throw new DigitalError("STUDIO_INVALID_WORK_DIRECTORY");
  const capacity = await statfs(output, { bigint: true });
  if (capacity.bavail * capacity.bsize < BigInt(DIGITAL_WORK_LIMITS.tempReserveBytes + 64 * 1024 * 1024)) throw new DigitalError("INSUFFICIENT_TEMP_DISK");
  const memory = { rssPeak: 0, samples: 0 }, ffmpeg = catalogFfmpegPath();
  const run = (args: string[], parseOnly = false) => runMonitoredFfmpeg(ffmpeg, args, signal, TIMEOUT, DIGITAL_WORK_LIMITS, parseOnly, memory);
  const file = (name: string) => path.join(output, name);
  const probe = (source: string) => run(["-i", source], true);
  const decode = async (source: string) => {
    const result = await run(["-v", "error", "-xerror", "-err_detect", "explode", "-i", source, "-map", "0:a:0", "-vn", "-sn", "-dn", "-stats_period", "60", "-progress", "pipe:2", "-nostats", "-f", "null", "-"]);
    if (!/^progress=end$/m.test(result) || result.split(/\r?\n/).some(line => line.trim() && !/^[a-zA-Z0-9_]+=/.test(line))) throw new DigitalError("INVALID_AUDIO");
    const durationMs = Math.round(Number(Array.from(result.matchAll(/^out_time_us=(\d+)$/gm)).at(-1)?.[1]) / 1000);
    if (!Number.isSafeInteger(durationMs) || durationMs < 1 || durationMs > DIGITAL_WORK_LIMITS.durationMs) throw new DigitalError("AUDIO_DURATION_LIMIT");
    return durationMs;
  };
  const tagsFor = async (source: string, name: string) => {
    const destination = file(`${name}.ffmetadata`);
    await run(["-v", "error", "-i", source, "-f", "ffmetadata", "-n", destination]);
    if ((await stat(destination)).size > MAX_TAG_BYTES) throw new DigitalError("STUDIO_METADATA_LIMIT");
    return parseStudioFfmetadata(await readFile(destination, "utf8"));
  };
  const analyze = async (source: string, channels: number, durationMs: number, sampleRate: number) => {
    const raw = await run(["-v", "info", "-xerror", "-err_detect", "explode", "-i", source, "-map", "0:a:0", "-vn", "-sn", "-dn", "-af", `aformat=sample_fmts=dbl:sample_rates=${sampleRate},astats=metadata=0:reset=0,loudnorm=I=-14:TP=-1:LRA=11:print_format=json`, "-stats_period", "60", "-progress", "pipe:2", "-nostats", "-f", "null", "-"]);
    const measured = parseStudioMeasurements(raw, channels, durationMs);
    if (channels === 1) { measured.monoRmsDbfs = measured.channels[0].rmsDbfs; measured.phaseCorrelation = null; measured.monoCancellationDb = 0; measured.diagnostics.phase = "MONO_SOURCE: no stereo correlation exists"; return measured; }
    // Whole-file L+R statistics derive a global Pearson coefficient without buffering PCM in Node.
    const monoRaw = await run(["-v", "info", "-i", source, "-map", "0:a:0", "-vn", "-sn", "-dn", "-af", "aformat=sample_fmts=dbl,pan=mono|c0=0.5*c0+0.5*c1,astats=metadata=0:reset=0:measure_perchannel=RMS_level:measure_overall=none", "-f", "null", "-"]);
    const mono = finite(monoRaw.match(/RMS level dB: ([^\r\n]+)/)?.[1], true), [left, right] = measured.channels;
    measured.monoRmsDbfs = mono;
    const power = (db: number | null) => db === null ? 0 : 10 ** (db / 10), pl = power(left.rmsDbfs), pr = power(right.rmsDbfs), pm = power(mono);
    const denominator = 2 * Math.sqrt(Math.max(0, pl - left.dcOffset ** 2) * Math.max(0, pr - right.dcOffset ** 2));
    measured.phaseCorrelation = denominator > 1e-16 ? Math.max(-1, Math.min(1, (4 * pm - pl - pr - 2 * left.dcOffset * right.dcOffset) / denominator)) : null;
    measured.monoCancellationDb = pl + pr > 0 ? mono === null ? null : mono - 10 * Math.log10((pl + pr) / 2) : null;
    measured.diagnostics.phase = "FULL_FILE_GLOBAL_PEARSON: not a time-local musical stereo diagnosis";
    return measured;
  };
  const audioHash = async (source: string, name: string, decoded = false) => {
    const destination = file(`${name}.${decoded ? "decoded" : "packets"}.sha256`);
    await run(["-v", "error", "-i", source, "-map", "0:a:0", "-vn", "-sn", "-dn", "-c:a", decoded ? "pcm_f64le" : "copy", "-f", "hash", "-hash", "sha256", "-n", destination]);
    const match = (await readFile(destination, "utf8")).match(/^SHA256=([a-f0-9]{64})\s*$/);
    if (!match) throw new DigitalError("STUDIO_PACKET_HASH_FAILED");
    return match[1];
  };
  await input.onProgress?.("ANALYZING");
  const headerFile = await open(sourcePath, "r"), signature = Buffer.alloc(12);
  try { await headerFile.read(signature, 0, signature.length, 0); } finally { await headerFile.close(); }
  const sourceFormat = signature.toString("ascii", 0, 4) === "RIFF" && signature.toString("ascii", 8, 12) === "WAVE" ? "WAV" : "MP3";
  const sourceSha = await checksum(sourcePath, signal), sourceProbe = await probe(sourcePath);
  let description: SourceDescription;
  if (sourceFormat === "WAV") {
    const wav = await inspectDigitalWav(sourcePath);
    if (wav.channels > 2 || wav.sampleRate < 8000 || wav.sampleRate > 192000) throw new DigitalError("STUDIO_UNSUPPORTED_SOURCE_LAYOUT");
    description = { format: "WAV", codec: sourceProbe.match(/Audio:\s*(pcm_[a-z0-9]+)/)?.[1] ?? "UNKNOWN_PCM", sampleRate: wav.sampleRate, channels: wav.channels, bitsPerSample: wav.bitsPerSample, bitrateKbps: null, durationMs: wav.durationMs, sizeBytes: sourceStat.size, sha256: sourceSha };
  } else {
    const validated = await validateDigitalMp3(sourcePath, signal), mp3 = await inspectDigitalMp3(sourcePath, signal);
    description = { format: "MP3", codec: "mp3", sampleRate: mp3.sampleRate, channels: mp3.channels, bitsPerSample: null, bitrateKbps: validated.bitrateKbps, durationMs: validated.durationMs, sizeBytes: sourceStat.size, sha256: sourceSha };
  }
  if ((sourceProbe.match(/Stream #0:\d+[^\r\n]*Audio:/g) ?? []).length !== 1) throw new DigitalError("STUDIO_UNSUPPORTED_SOURCE_LAYOUT");
  const progressDuration = await decode(sourcePath);
  // FFmpeg's output timestamp can omit a final frame interval. Exact duration is
  // independently derived from the complete astats decoded sample count below.
  if (Math.abs(progressDuration - description.durationMs) > 100) throw new DigitalError("AUDIO_DURATION_MISMATCH");
  const sourceTags = await tagsFor(sourcePath, "original"), tags = studioOfficialTags(input.title, input.album, safeTags({ ...sourceTags, ...input.metadata }));
  const before = await analyze(sourcePath, description.channels, description.durationMs, description.sampleRate), decodedDuration = Math.round(before.sampleCount * 1000 / description.sampleRate);
  if (Math.abs(decodedDuration - description.durationMs) > (sourceFormat === "WAV" ? 1 : 100)) throw new DigitalError("AUDIO_DURATION_MISMATCH");
  before.durationMs = decodedDuration;
  const previewStartMs = input.previewStartMs ?? 0;
  if (!Number.isSafeInteger(previewStartMs) || previewStartMs < 0 || previewStartMs >= decodedDuration) throw new DigitalError("INVALID_EXCERPT");
  // Duplicating mono into two identical channels raises integrated loudness by
  // about 3 LU. Choose the peak policy for the actual stereo deliverable, not a
  // deceptively quieter mono input measurement.
  const stereoLufs = before.integratedLufs === null ? null : before.integratedLufs + (description.channels === 1 ? 10 * Math.log10(2) : 0);
  const plan = studioGainPlan(stereoLufs, before.truePeakDbtp, { preserveCompliantMp3: description.format === "MP3" && description.channels === 2 });
  const workingBytes = Math.ceil(decodedDuration * description.sampleRate * 16 / 1000) + 65536;
  const native24Bytes = Math.ceil(decodedDuration * description.sampleRate * 6 / 1000) + 2 * MAX_TAG_BYTES;
  const cdBytes = Math.ceil(decodedDuration * 44100 * 4 / 1000) + 2 * MAX_TAG_BYTES;
  const encodedBytes = Math.ceil(decodedDuration * (40000 + 24000) / 1000) + 3 * MAX_TAG_BYTES;
  if (workingBytes > 2 * 1024 * 1024 * 1024 || native24Bytes > DIGITAL_WORK_LIMITS.masterBytes || cdBytes > DIGITAL_WORK_LIMITS.masterBytes) throw new DigitalError("STUDIO_WORKING_RESOURCE_LIMIT");
  const temporaryBudget = workingBytes + native24Bytes + cdBytes + encodedBytes + 4 * 1024 * 1024 + DIGITAL_WORK_LIMITS.tempReserveBytes;
  const available = await statfs(output, { bigint: true });
  if (available.bavail * available.bsize < BigInt(temporaryBudget)) throw new DigitalError("INSUFFICIENT_TEMP_DISK");
  const mono = description.channels === 1 ? ",pan=stereo|c0=c0|c1=c0" : "";
  const gain = plan.gainDb < 0 ? `,volume=${plan.gainDb.toFixed(3)}dB:precision=double` : "";
  const workingFilter = `aformat=sample_fmts=dbl${mono}${gain}`;
  await input.onProgress?.("MASTERING");
  const working = file("working.f64.wav");
  await run(["-v", "error", "-xerror", "-err_detect", "explode", "-i", sourcePath, "-map", "0:a:0", "-vn", "-sn", "-dn", "-af", workingFilter, "-ar", String(description.sampleRate), "-c:a", "pcm_f64le", "-map_metadata", "-1", "-fs", "2147483648", "-n", working]);
  // The float64 intermediate may exceed the 512 MiB commercial-file ceiling.
  // Complete decode + measured sample count verifies it without weakening that
  // ceiling for any original or downloadable asset.
  const workingDuration = await decode(working);
  if (Math.abs(workingDuration - decodedDuration) > 100 || (await stat(working)).size > workingBytes) throw new DigitalError("STUDIO_END_TRUNCATED");
  await input.onProgress?.("CONVERTING");
  const paths: Record<StudioFormat, string> = { MP3: file("mp3.mp3"), WAV_CD: file("cd.wav"), WAV_24: file("native24.wav") };
  const preserveMp3 = sourceFormat === "MP3" && plan.gainDb === 0 && description.channels === 2;
  await run(["-v", "error", "-i", preserveMp3 ? sourcePath : working, "-map", "0:a:0", "-vn", "-sn", "-dn", "-map_metadata", "-1", ...metadataArgs(tags),
    ...(preserveMp3 ? ["-c:a", "copy"] : ["-c:a", "libmp3lame", "-b:a", "320k", "-ar", String([32000, 44100, 48000].includes(description.sampleRate) ? description.sampleRate : 44100), "-ac", "2"]),
    "-id3v2_version", "4", "-write_id3v1", "0", "-write_xing", "1", "-fs", String(96 * 1024 * 1024), "-n", paths.MP3]);
  for (const format of ["WAV_CD", "WAV_24"] as const) {
    const filter = format === "WAV_CD" ? HIGH_QUALITY_CD : "aresample=resampler=swr:osf=s32:dither_method=none:output_sample_bits=24";
    await run(["-v", "error", "-i", working, "-map", "0:a:0", "-vn", "-sn", "-dn", "-map_metadata", "-1", ...metadataArgs(tags), "-af", filter,
      "-ar", String(format === "WAV_CD" ? 44100 : description.sampleRate), "-c:a", format === "WAV_CD" ? "pcm_s16le" : "pcm_s24le", "-fs", String(DIGITAL_WORK_LIMITS.masterBytes), "-n", paths[format]]);
    await appendWavId3(paths[format], tags);
  }
  await input.onProgress?.("VERIFYING");
  const files = {} as Record<StudioFormat, StudioAudioFile>, sourcePackets = preserveMp3 ? await audioHash(sourcePath, "source") : null;
  const sourcePcm = preserveMp3 ? await audioHash(sourcePath, "source", true) : null;
  for (const format of STUDIO_FORMATS) {
    assertNotAborted(signal);
    const destination = paths[format], metadata = await stat(destination), finalTags = await tagsFor(destination, format), progressFinalDuration = await decode(destination);
    for (const [key, value] of Object.entries(tags)) if (finalTags[key] !== value) throw Object.assign(new DigitalError("STUDIO_METADATA_MISMATCH"), { format, field: key });
    if (Math.abs(progressFinalDuration - decodedDuration) > 100) throw new DigitalError("STUDIO_END_TRUNCATED");
    const parsed = format === "MP3" ? await inspectDigitalMp3(destination, signal) : await inspectDigitalWav(destination);
    if (format === "MP3") await validateDigitalMp3(destination, signal, preserveMp3 ? undefined : { durationMs: decodedDuration, bitrateKbps: 320 });
    else if (!("bitsPerSample" in parsed) || parsed.bitsPerSample !== (format === "WAV_CD" ? 16 : 24) || parsed.sampleRate !== (format === "WAV_CD" ? 44100 : description.sampleRate)) throw new DigitalError("STUDIO_FORMAT_MISMATCH");
    if (parsed.channels !== 2) throw new DigitalError("STUDIO_FORMAT_MISMATCH");
    const after = await analyze(destination, 2, decodedDuration, parsed.sampleRate), finalDuration = Math.round(after.sampleCount * 1000 / parsed.sampleRate), finalCeiling = (after.integratedLufs ?? -Infinity) > -14 ? -2 : -1;
    if (Math.abs(finalDuration - decodedDuration) > (format === "MP3" ? 100 : 1)) throw new DigitalError("STUDIO_END_TRUNCATED");
    after.durationMs = finalDuration;
    if (after.truePeakDbtp !== null && after.truePeakDbtp > finalCeiling + 0.01) throw new DigitalError("STUDIO_TRUE_PEAK_CEILING");
    if (before.phaseCorrelation !== null && after.phaseCorrelation !== null && after.phaseCorrelation < before.phaseCorrelation - 0.02) throw new DigitalError("STUDIO_PHASE_DEGRADATION");
    const packets = format === "MP3" ? await audioHash(destination, "final") : null;
    if (preserveMp3 && format === "MP3" && packets !== sourcePackets) throw new DigitalError("STUDIO_MP3_REENCODED");
    if (preserveMp3 && format === "MP3" && await audioHash(destination, "final", true) !== sourcePcm) throw new DigitalError("STUDIO_MP3_DECODE_CHANGED");
    files[format] = { format, path: destination, filename: studioDownloadName(input.title, format), sizeBytes: metadata.size, sha256: await checksum(destination, signal), sampleRate: parsed.sampleRate, channels: parsed.channels,
      bitsPerSample: "bitsPerSample" in parsed ? parsed.bitsPerSample : null, bitrateKbps: format === "MP3" ? (await validateDigitalMp3(destination, signal)).bitrateKbps : null,
      durationMs: finalDuration, codec: format === "MP3" ? "mp3" : format === "WAV_CD" ? "pcm_s16le" : "pcm_s24le", sourceLossy: sourceFormat === "MP3", audioReencoded: format !== "MP3" || !preserveMp3,
      encodedPacketsSha256: packets, measurements: after, tags: finalTags, metadataVerified: true, integrityVerified: true };
  }
  const previewPath = file("excerpt.mp3"), previewDuration = Math.min(59950, decodedDuration - previewStartMs);
  await run(["-v", "error", "-i", paths.WAV_24, "-map", "0:a:0", "-vn", "-sn", "-dn", "-ss", (previewStartMs / 1000).toFixed(3), "-t", (previewDuration / 1000).toFixed(3), "-map_metadata", "-1", "-ac", "2", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "192k", "-write_xing", "1", "-id3v2_version", "0", "-n", previewPath]);
  const excerpt = await validateDigitalMp3(previewPath, signal, { durationMs: previewDuration, bitrateKbps: 192 });
  if (excerpt.durationMs > 60000) throw new DigitalError("INVALID_PREVIEW_DURATION");
  const auditionPath = file("native24-listening.mp3");
  await run(["-v", "error", "-i", paths.WAV_24, "-map", "0:a:0", "-vn", "-sn", "-dn", "-map_metadata", "-1", "-ac", "2", "-ar", "44100", "-c:a", "libmp3lame", "-b:a", "192k", "-write_xing", "1", "-id3v2_version", "0", "-n", auditionPath]);
  const audition = await validateDigitalMp3(auditionPath, signal, { durationMs: decodedDuration, bitrateKbps: 192 });
  if (await checksum(sourcePath, signal) !== sourceSha) throw new DigitalError("STUDIO_ORIGINAL_CHANGED");
  // Version diagnostic has no input or audio workload. The existing monitored
  // processing runner deliberately discards stdout, where -version is printed.
  const tools = await promisify(execFile)(ffmpeg, ["-version"], { timeout: 5000, maxBuffer: 65536, signal, shell: false,
    env: { PATH: process.env.PATH, NODE_ENV: process.env.NODE_ENV ?? "development", AV_LOG_FORCE_NOCOLOR: "1" } });
  const toolVersion = tools.stdout.split(/\r?\n/)[0];
  if (!/^ffmpeg version \S+/.test(toolVersion)) throw new DigitalError("FFMPEG_UNAVAILABLE");
  const warnings: string[] = [];
  if (sourceFormat === "MP3") warnings.push("LOSSY_SOURCE: WAV exports do not recover information lost in the MP3 source");
  if (description.channels === 1) warnings.push("MONO_SOURCE: duplicated identically into L/R; no artificial stereo effect");
  if (sourceFormat === "WAV" && description.bitsPerSample !== null && description.bitsPerSample < 24) warnings.push("SOURCE_PRECISION: a 24-bit container does not restore detail absent from the lower-bit-depth original");
  if (!plan.measurable) warnings.push("LOUDNESS_NOT_MEASURABLE: silent/ungated source; no gain applied, human listening required");
  if (before.phaseCorrelation !== null && before.phaseCorrelation < 0) warnings.push("NEGATIVE_PHASE_CORRELATION: source requires human mono-compatibility review; not repaired automatically");
  const result: StudioAudioResult = { version: STUDIO_AUDIO_VERSION, sourceLossy: sourceFormat === "MP3", source: { ...description, path: sourcePath, tags: sourceTags, measurements: before }, formats: files,
    artifacts: STUDIO_FORMATS.map(role => ({ role, path: files[role].path, mimeType: role === "MP3" ? "audio/mpeg" : "audio/wav", sizeBytes: files[role].sizeBytes, durationMs: files[role].durationMs,
      sampleRate: files[role].sampleRate, bitDepth: files[role].bitsPerSample, bitrateKbps: files[role].bitrateKbps, integratedLufs: files[role].measurements.integratedLufs,
      truePeakDbtp: files[role].measurements.truePeakDbtp, sha256: files[role].sha256, metadataVerified: files[role].metadataVerified })),
    preview: { path: previewPath, sha256: await checksum(previewPath, signal), sizeBytes: (await stat(previewPath)).size, startMs: previewStartMs, durationMs: excerpt.durationMs, basedOnFormat: "WAV_24" },
    audition24: { path: auditionPath, sha256: await checksum(auditionPath, signal), sizeBytes: (await stat(auditionPath)).size, durationMs: audition.durationMs, encodedListeningCopy: true, basedOnSha256: files.WAV_24.sha256 },
    plan: { ...plan, processing: plan.gainDb < 0 ? "FIXED_ATTENUATION" : "NONE", disabledModules: STUDIO_DISABLED_MODULES, filters: { working: workingFilter, WAV_CD: HIGH_QUALITY_CD, WAV_24: "aresample=resampler=swr:osf=s32:dither_method=none:output_sample_bits=24" }, workingPrecision: "PCM_FLOAT64", workingSampleRate: description.sampleRate, ditherApplications: { WAV_CD: 1, WAV_24: 0, MP3: 0 } },
    report: { status: "READY_TO_LISTEN", humanAudioApproval: false, rightsApproval: false, published: false, originalUnchanged: true,
      tools: { ffmpeg: toolVersion, ffprobe: "NOT_REQUIRED_FFMPEG_AND_CONTAINER_READER" },
      limitations: ["No critical human listening has been performed", "No spectral repair, denoising, de-essing, compression or limiting is automatically established", "Native SWR Kaiser high-quality resampling; this build does not require libsoxr", "WAV ID3/RIFF INFO tags reread successfully here; external players may not display every field", "Global stereo statistics cannot establish every time-local phase issue", "Safari macOS and Safari iPhone: NOT_TESTED"], warnings,
      ffmpegRssPeakBytes: memory.samples ? memory.rssPeak : "NOT_MEASURED", ffmpegRssSamples: memory.samples } };
  result.artifacts.push({ role: "PREVIEW", path: result.preview.path, mimeType: "audio/mpeg", sizeBytes: result.preview.sizeBytes, durationMs: result.preview.durationMs, sampleRate: 44100, bitDepth: null, bitrateKbps: 192,
    integratedLufs: null, truePeakDbtp: null, sha256: result.preview.sha256, metadataVerified: false },
  { role: "AUDITION_24", path: result.audition24.path, mimeType: "audio/mpeg", sizeBytes: result.audition24.sizeBytes, durationMs: result.audition24.durationMs, sampleRate: 44100, bitDepth: null, bitrateKbps: 192,
    integratedLufs: null, truePeakDbtp: null, sha256: result.audition24.sha256, metadataVerified: false });
  await input.onProgress?.("READY_TO_LISTEN");
  return result;
}
