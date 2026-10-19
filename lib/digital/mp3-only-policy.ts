/** Owner-authorized exception for this exact lossy recording, not a catalogue-wide format policy. */
export const MP3_ONLY_SOURCE_POLICY = "DCN_MP3_ONLY_SOURCE_1";
export const MP3_ONLY_SOURCE = Object.freeze({
  projectId: "a204781d-4ec8-40c1-a996-bbcb6fd5f8e7",
  trackId: "cc2c5da5-3e63-45eb-b86a-e89f87a31161",
  sourceSha256: "27a81b1b9f5d2be9900fb02d6ee259d2da83cd65e067fed8c900acc3128b6592",
  sourceBytes: 5310507,
  priceCents: 129,
  title: "Lentement",
  authorization: "OWNER_EXPLICIT_20261019",
  formats: Object.freeze(["MP3"] as const),
});
/** An extension, duration or similar title is never sufficient to select this exception. */
export function isAuthorizedMp3OnlySource(trackId: string | undefined,
  asset: { checksumSha256: string | null; sizeBytes: bigint | number | null }) {
  return trackId === MP3_ONLY_SOURCE.trackId && asset.checksumSha256 === MP3_ONLY_SOURCE.sourceSha256
    && (typeof asset.sizeBytes === "bigint" ? asset.sizeBytes === BigInt(MP3_ONLY_SOURCE.sourceBytes)
      : asset.sizeBytes === MP3_ONLY_SOURCE.sourceBytes);
}
