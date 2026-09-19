const R2_HOST = /^[0-9a-f]{32}\.r2\.cloudflarestorage\.com$/i;
const R2_BUCKET = /^[a-z0-9](?:[a-z0-9.-]{1,61}[a-z0-9])?$/;

function r2BucketOrigin(bucketVariable: "MEDIA_PRIVATE_BUCKET" | "MEDIA_PUBLIC_BUCKET", environment: Record<string, string | undefined>) {
  if (environment.MEDIA_STORAGE_DRIVER !== "s3" || environment.MEDIA_STORAGE_PROVIDER !== "r2") return null;
  const raw = environment.MEDIA_S3_ENDPOINT?.trim();
  if (!raw) throw new Error("MEDIA_S3_ENDPOINT is required for direct R2 uploads.");
  const endpoint = new URL(raw);
  if (
    endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.port
    || endpoint.pathname !== "/" || endpoint.search || endpoint.hash || !R2_HOST.test(endpoint.hostname)
  ) throw new Error("MEDIA_S3_ENDPOINT is not an account-scoped Cloudflare R2 endpoint.");
  const bucket = environment[bucketVariable]?.trim();
  if (!bucket || !R2_BUCKET.test(bucket)) throw new Error(`${bucketVariable} is not a valid R2 bucket name.`);
  return `https://${bucket}.${endpoint.hostname}`;
}

export function directUploadConnectOrigin(environment: Record<string, string | undefined> = process.env) {
  return r2BucketOrigin("MEDIA_PRIVATE_BUCKET", environment);
}

export function publicMediaOrigin(environment: Record<string, string | undefined> = process.env) {
  return r2BucketOrigin("MEDIA_PUBLIC_BUCKET", environment);
}
