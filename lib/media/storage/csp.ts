const R2_HOST = /^[0-9a-f]{32}\.r2\.cloudflarestorage\.com$/i;

export function directUploadConnectOrigin(environment: Record<string, string | undefined> = process.env) {
  if (environment.MEDIA_STORAGE_DRIVER !== "s3" || environment.MEDIA_STORAGE_PROVIDER !== "r2") return null;
  const raw = environment.MEDIA_S3_ENDPOINT?.trim();
  if (!raw) throw new Error("MEDIA_S3_ENDPOINT is required for direct R2 uploads.");
  const endpoint = new URL(raw);
  if (
    endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.port
    || endpoint.pathname !== "/" || endpoint.search || endpoint.hash || !R2_HOST.test(endpoint.hostname)
  ) throw new Error("MEDIA_S3_ENDPOINT is not an account-scoped Cloudflare R2 endpoint.");
  return endpoint.origin;
}
