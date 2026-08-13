import { assertMediaStorageKey } from "@/lib/media/storage/policy";

export const R2_STAGING_CONFIRMATION = "run-r2-staging-canary";
export const R2_STAGING_PUBLIC_BUCKET = "lnx-studio-staging-public";
export const R2_STAGING_PRIVATE_BUCKET = "lnx-studio-staging-private";

type R2StagingEnvironment = Record<string, string | undefined>;

function required(environment: R2StagingEnvironment, name: string) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required for the R2 staging canary.`);
  return value;
}

function credential(environment: R2StagingEnvironment, name: string) {
  const value = required(environment, name);
  if (value.length < 16 || /^(?:replace|example|todo)/i.test(value)) {
    throw new Error(`${name} is not a usable staging credential.`);
  }
  return value;
}

function r2Endpoint(value: string) {
  const endpoint = new URL(value);
  if (
    endpoint.protocol !== "https:"
    || !/^[0-9a-f]{32}\.r2\.cloudflarestorage\.com$/i.test(endpoint.hostname)
    || endpoint.port
    || endpoint.pathname !== "/"
    || endpoint.search
    || endpoint.hash
    || endpoint.username
    || endpoint.password
  ) {
    throw new Error("MEDIA_S3_ENDPOINT must be the exact HTTPS endpoint of a Cloudflare R2 account.");
  }
  return endpoint;
}

export function r2StagingAnonymousPublicObjectUrl(endpointValue: string, key: string) {
  assertMediaStorageKey("public", key);
  const endpoint = r2Endpoint(endpointValue);
  endpoint.hostname = `${R2_STAGING_PUBLIC_BUCKET}.${endpoint.hostname}`;
  endpoint.pathname = `/${key.split("/").map(encodeURIComponent).join("/")}`;
  return endpoint;
}

export function assertR2StagingEnvironment(environment: R2StagingEnvironment) {
  if (environment.MEDIA_R2_STAGING_CONFIRM !== R2_STAGING_CONFIRMATION) {
    throw new Error(`Set MEDIA_R2_STAGING_CONFIRM=${R2_STAGING_CONFIRMATION} to run the R2 staging canary.`);
  }
  if (environment.MEDIA_DEPLOYMENT_ENV !== "staging") throw new Error("MEDIA_DEPLOYMENT_ENV must be staging.");
  if (environment.MEDIA_STORAGE_DRIVER !== "s3") throw new Error("MEDIA_STORAGE_DRIVER must be s3.");
  if (environment.MEDIA_STORAGE_PROVIDER !== "r2") throw new Error("MEDIA_STORAGE_PROVIDER must be r2.");
  if (environment.MEDIA_S3_REGION !== "auto") throw new Error("MEDIA_S3_REGION must be auto for R2 staging.");
  if (environment.MEDIA_S3_FORCE_PATH_STYLE !== "false") throw new Error("MEDIA_S3_FORCE_PATH_STYLE must be false for R2 staging.");
  if (environment.RAILWAY_ENVIRONMENT) throw new Error("The R2 staging canary must not run inside Railway.");

  const publicBucket = required(environment, "MEDIA_PUBLIC_BUCKET");
  const privateBucket = required(environment, "MEDIA_PRIVATE_BUCKET");
  if (publicBucket !== R2_STAGING_PUBLIC_BUCKET || privateBucket !== R2_STAGING_PRIVATE_BUCKET) {
    throw new Error("The R2 staging canary accepts only the dedicated LNX Studio staging buckets.");
  }
  if (/production/i.test(`${publicBucket}:${privateBucket}`)) {
    throw new Error("Public and private R2 staging buckets must be distinct and non-production.");
  }

  const endpoint = r2Endpoint(required(environment, "MEDIA_S3_ENDPOINT"));

  return {
    endpoint: endpoint.origin,
    accessKeyId: credential(environment, "MEDIA_S3_ACCESS_KEY_ID"),
    secretAccessKey: credential(environment, "MEDIA_S3_SECRET_ACCESS_KEY"),
    publicBucket,
    privateBucket,
  } as const;
}
