import assert from "node:assert/strict";
import { access, readFile, utimes, writeFile } from "node:fs/promises";
import test from "node:test";

import {
  CatalogAudioError,
  catalogAudioIsPublicProjectStatus,
  catalogAudioRightsConfirmed,
  catalogAudioVersionMatches,
  resolvedAudioExcerpt,
} from "@/lib/catalog/audio";
import {
  CATALOG_AUDIO_SOURCE_MAXIMUM_BYTES,
  CATALOG_AUDIO_TRANSPORT_MAXIMUM_BYTES,
} from "@/lib/catalog/audio-request";
import { CatalogAudioRangeError, parseCatalogAudioRange } from "@/lib/catalog/audio-range";
import { analyzeAudioSource, catalogFfmpegPath, generateCatalogMp3Preview } from "@/lib/catalog/ffmpeg";
import { cleanupExpiredAudioSources, createAudioSourceTempPath, removeAudioTempFile } from "@/lib/catalog/audio-temp";
import { createAudioFixture } from "@/tests/audio/fixture";

test("the additive migration declares the dedicated audio asset, role and duration", async () => {
  const migration = await readFile("prisma/migrations/20260812120000_audio_previews/migration.sql", "utf8");
  assert.match(migration, /AssetType.*AUDIO_PREVIEW/s);
  assert.match(migration, /ProjectAssetRole.*AUDIO_PREVIEW/s);
  assert.match(migration, /duration_ms/);
});

test("FFmpeg is reproducibly available and the integration contains no hardcoded user path", async () => {
  const executable = catalogFfmpegPath();
  assert.ok(executable.endsWith("ffmpeg") || executable.includes("ffmpeg"));
  const integration = await readFile("lib/catalog/ffmpeg.ts", "utf8");
  assert.doesNotMatch(integration, /\/Users\/lnxbeats\//);
});

test("a complete 2:30 MP3 generates a decodable 60 second MP3", async () => {
  const source = await createAudioFixture({ seconds: 150, format: "mp3" });
  const output = `${source.path}.preview.mp3`;
  try {
    const sourceAnalysis = await analyzeAudioSource(source.path);
    assert.ok(sourceAnalysis.durationMs >= 149_000);
    await generateCatalogMp3Preview({ sourcePath: source.path, outputPath: output, offsetMs: 45_000, durationMs: 60_000 });
    const generated = await analyzeAudioSource(output);
    assert.ok(generated.durationMs >= 59_000 && generated.durationMs <= 61_000);
  } finally { await source.cleanup(); }
});

test("a complete WAV generates the public MP3 without source metadata", async () => {
  const source = await createAudioFixture({ seconds: 65, format: "wav" });
  const output = `${source.path}.preview.mp3`;
  try {
    const sourceAnalysis = await analyzeAudioSource(source.path);
    assert.ok(sourceAnalysis.durationMs >= 64_000);
    await generateCatalogMp3Preview({ sourcePath: source.path, outputPath: output, offsetMs: 0, durationMs: 60_000 });
    const generated = await analyzeAudioSource(output);
    assert.ok(generated.durationMs >= 59_000 && generated.durationMs <= 61_000);
    assert.equal((await readFile(output)).includes(Buffer.from("QA PRIVATE SOURCE")), false);
  } finally { await source.cleanup(); }
});

test("short sources and offsets near the end adjust to remaining duration", () => {
  assert.deepEqual(resolvedAudioExcerpt(42_000, "0", "60000"), {
    offsetMs: 0, requestedDurationMs: 60_000, durationMs: 42_000, adjustedToSourceEnd: true,
  });
  assert.deepEqual(resolvedAudioExcerpt(150_000, "145000", "60000"), {
    offsetMs: 145_000, requestedDurationMs: 60_000, durationMs: 5_000, adjustedToSourceEnd: true,
  });
  assert.deepEqual(resolvedAudioExcerpt(150_000, "45000", "60000"), {
    offsetMs: 45_000, requestedDurationMs: 60_000, durationMs: 60_000, adjustedToSourceEnd: false,
  });
});

test("invalid offset and duration fail closed", () => {
  for (const offset of ["-1", "150000", "hello"]) assert.throws(() => resolvedAudioExcerpt(150_000, offset, "60000"), CatalogAudioError);
  for (const duration of ["0", "60001", "hello"]) assert.throws(() => resolvedAudioExcerpt(150_000, "0", duration), CatalogAudioError);
});

test("source and multipart limits are scoped to the audio handler", () => {
  assert.equal(CATALOG_AUDIO_SOURCE_MAXIMUM_BYTES, 80 * 1024 * 1024);
  assert.equal(CATALOG_AUDIO_TRANSPORT_MAXIMUM_BYTES, 81 * 1024 * 1024);
});

test("abandoned private sources are removed by the opportunistic TTL cleanup", async () => {
  const source = await createAudioSourceTempPath(".mp3");
  await writeFile(source, Buffer.from("ID3 abandoned QA source"));
  const expired = new Date(Date.now() - 2 * 60 * 60 * 1_000);
  await utimes(source, expired, expired);
  try {
    assert.ok((await cleanupExpiredAudioSources()) >= 1);
    await assert.rejects(access(source));
  } finally {
    await removeAudioTempFile(source).catch(() => undefined);
  }
});

test("rights, concurrency and publication remain strict", () => {
  assert.equal(catalogAudioRightsConfirmed("on"), true);
  assert.equal(catalogAudioRightsConfirmed("true"), false);
  assert.equal(catalogAudioVersionMatches(null, null), true);
  assert.equal(catalogAudioVersionMatches("a", "b"), false);
  assert.equal(catalogAudioIsPublicProjectStatus("PUBLISHED"), true);
  assert.equal(catalogAudioIsPublicProjectStatus("IN_DEVELOPMENT"), false);
  assert.equal(catalogAudioIsPublicProjectStatus("DRAFT"), false);
  assert.equal(catalogAudioIsPublicProjectStatus("ARCHIVED"), false);
});

test("single byte ranges support full, suffix and bounded requests", () => {
  assert.equal(parseCatalogAudioRange(null, 2_000), null);
  assert.deepEqual(parseCatalogAudioRange("bytes=0-1023", 2_000), { start: 0, end: 1_023 });
  assert.deepEqual(parseCatalogAudioRange("bytes=1500-", 2_000), { start: 1_500, end: 1_999 });
  assert.deepEqual(parseCatalogAudioRange("bytes=-200", 2_000), { start: 1_800, end: 1_999 });
});

test("malformed, multiple and unsatisfiable ranges are refused", () => {
  for (const value of ["items=0-1", "bytes=", "bytes=0-1,5-6", "bytes=2000-", "bytes=9-2", "bytes=-0"]) {
    assert.throws(() => parseCatalogAudioRange(value, 2_000), CatalogAudioRangeError);
  }
});
