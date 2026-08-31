import "server-only";

import { createHash } from "node:crypto";
import path from "node:path";

import { LocalMediaStorage } from "@/lib/media/storage/local";
import { S3MediaStorage, type S3MediaStorageOptions } from "@/lib/media/storage/s3";
import { MediaStorageError, type MediaStorage, type MediaStorageBackend, type MediaStorageReference } from "@/lib/media/storage/types";

type DriverName = "local" | "s3";
type DeploymentEnvironment = "local-preview" | "test" | "staging" | "production";

type ObjectStorageConfiguration = {
  provider: string;
  endpoint: string;
  region: string;
  publicBucket: string;
  privateBucket: string;
  forcePathStyle: boolean;
  accessKeyId: string;
  secretAccessKey: string;
};

const objectStorageCacheSymbol = Symbol.for("lnx-studio.media.object-storage-cache.v1");
type ObjectStorageGlobal = typeof globalThis & {
  [objectStorageCacheSymbol]?: Map<string, MediaStorage>;
};

function objectStorageCache() {
  // Next can package server entrypoints as distinct module graphs inside the
  // same Node process. A versioned global symbol makes the cache genuinely
  // process-scoped instead of relying on one specific bundle's module cache.
  const processGlobal = globalThis as ObjectStorageGlobal;
  processGlobal[objectStorageCacheSymbol] ??= new Map<string, MediaStorage>();
  return processGlobal[objectStorageCacheSymbol];
}

function configuredDeploymentEnvironment(): DeploymentEnvironment {
  const value = process.env.MEDIA_DEPLOYMENT_ENV?.trim() || "local-preview";
  if (!(["local-preview", "test", "staging", "production"] as string[]).includes(value)) {
    throw new MediaStorageError("CONFIGURATION", "MEDIA_DEPLOYMENT_ENV is invalid.");
  }
  return value as DeploymentEnvironment;
}

function configuredDriver(deploymentEnvironment = configuredDeploymentEnvironment()): DriverName {
  const value = process.env.MEDIA_STORAGE_DRIVER ?? "local";
  if (value !== "local" && value !== "s3") {
    throw new MediaStorageError("CONFIGURATION", "MEDIA_STORAGE_DRIVER must be local or s3.");
  }
  if (
    value === "local"
    && (
      deploymentEnvironment === "staging"
      || deploymentEnvironment === "production"
      || process.env.RAILWAY_ENVIRONMENT
    )
  ) {
    throw new MediaStorageError("CONFIGURATION", "Staging and production media storage must use an object driver.");
  }
  return value;
}

function localStorage() {
  const configuredPublicRoot = process.env.MEDIA_LOCAL_PUBLIC_ROOT ?? process.env.MEDIA_STORAGE_ROOT ?? path.join(process.cwd(), ".local-media/public");
  const configuredPrivateRoot = process.env.MEDIA_LOCAL_PRIVATE_ROOT ?? process.env.ORDER_UPLOAD_DIR ?? path.join(process.cwd(), ".private/order-uploads");
  const publicRoot = path.resolve(configuredPublicRoot);
  const privateRoot = path.resolve(configuredPrivateRoot);
  if (process.env.ORDER_UPLOAD_MODE === "local-qa") {
    if (!process.env.LNX_DATABASE_TARGET?.endsWith("-test") || !path.resolve(privateRoot).startsWith("/private/tmp/")) {
      throw new MediaStorageError("CONFIGURATION", "QA private media storage must use an isolated test database and /private/tmp.");
    }
  }
  return new LocalMediaStorage({ publicRoot, privateRoot });
}

function required(name: string) {
  const value = process.env[name]?.trim();
  if (!value) throw new MediaStorageError("CONFIGURATION", `${name} is required for object media storage.`);
  return value;
}

function configuredBoolean(name: string, fallback = false) {
  const value = process.env[name]?.trim();
  if (!value) return fallback;
  if (value !== "true" && value !== "false") {
    throw new MediaStorageError("CONFIGURATION", `${name} must be true or false.`);
  }
  return value === "true";
}

function assertEnvironmentBucket(scope: "public" | "private", bucket: string, deploymentEnvironment: "staging" | "production") {
  if (deploymentEnvironment === "staging") {
    const expectedBucket = `lnx-studio-staging-${scope}`;
    if (bucket !== expectedBucket) {
      throw new MediaStorageError(
        "CONFIGURATION",
        `MEDIA_${scope.toUpperCase()}_BUCKET must be exactly ${expectedBucket} in staging.`,
      );
    }
    return;
  }

  const normalized = bucket.toLowerCase();
  if (
    !normalized.split("-").includes(scope)
    || !normalized.split("-").includes(deploymentEnvironment)
    || normalized.split("-").includes("staging")
  ) {
    throw new MediaStorageError(
      "CONFIGURATION",
      `MEDIA_${scope.toUpperCase()}_BUCKET must identify the ${scope} ${deploymentEnvironment} bucket.`,
    );
  }
}

function validateR2Configuration(configuration: ObjectStorageConfiguration, deploymentEnvironment: DeploymentEnvironment) {
  if (deploymentEnvironment === "staging" && configuration.provider !== "r2") {
    throw new MediaStorageError("CONFIGURATION", "Staging object storage is restricted to Cloudflare R2.");
  }
  if (configuration.provider.toLowerCase() !== "r2") return;
  if (configuration.provider !== "r2") {
    throw new MediaStorageError("CONFIGURATION", "MEDIA_STORAGE_PROVIDER must be r2 for Cloudflare R2.");
  }

  let endpoint: URL;
  try {
    endpoint = new URL(configuration.endpoint);
  } catch {
    throw new MediaStorageError("CONFIGURATION", "MEDIA_S3_ENDPOINT must be a valid Cloudflare R2 HTTPS endpoint.");
  }
  if (
    endpoint.protocol !== "https:"
    || endpoint.username
    || endpoint.password
    || endpoint.port
    || endpoint.pathname !== "/"
    || endpoint.search
    || endpoint.hash
    || !/^[0-9a-f]{32}\.r2\.cloudflarestorage\.com$/i.test(endpoint.hostname)
  ) {
    throw new MediaStorageError("CONFIGURATION", "MEDIA_S3_ENDPOINT must be the account-scoped Cloudflare R2 HTTPS endpoint.");
  }
  if (configuration.region !== "auto") {
    throw new MediaStorageError("CONFIGURATION", "MEDIA_S3_REGION must be auto for Cloudflare R2.");
  }
  if (configuration.forcePathStyle) {
    throw new MediaStorageError("CONFIGURATION", "MEDIA_S3_FORCE_PATH_STYLE must be false for Cloudflare R2.");
  }

  if (deploymentEnvironment !== "staging" && deploymentEnvironment !== "production") {
    throw new MediaStorageError("CONFIGURATION", "Cloudflare R2 requires MEDIA_DEPLOYMENT_ENV=staging or production.");
  }
  assertEnvironmentBucket("public", configuration.publicBucket, deploymentEnvironment);
  assertEnvironmentBucket("private", configuration.privateBucket, deploymentEnvironment);
}

function objectStorageConfiguration(
  deploymentEnvironment = configuredDeploymentEnvironment(),
): ObjectStorageConfiguration {
  const configuration: ObjectStorageConfiguration = {
    provider: process.env.MEDIA_STORAGE_PROVIDER?.trim() || "r2",
    endpoint: required("MEDIA_S3_ENDPOINT"),
    region: process.env.MEDIA_S3_REGION?.trim() || "auto",
    publicBucket: required("MEDIA_PUBLIC_BUCKET"),
    privateBucket: required("MEDIA_PRIVATE_BUCKET"),
    forcePathStyle: configuredBoolean("MEDIA_S3_FORCE_PATH_STYLE"),
    accessKeyId: required("MEDIA_S3_ACCESS_KEY_ID"),
    secretAccessKey: required("MEDIA_S3_SECRET_ACCESS_KEY"),
  };
  if (configuration.publicBucket === configuration.privateBucket) {
    throw new MediaStorageError(
      "CONFIGURATION",
      "Public and private object storage buckets must be distinct.",
    );
  }
  validateR2Configuration(configuration, deploymentEnvironment);
  return configuration;
}

function objectStorageCacheKey(configuration: ObjectStorageConfiguration) {
  return createHash("sha256")
    .update(JSON.stringify([
      configuration.provider,
      configuration.endpoint,
      configuration.region,
      configuration.publicBucket,
      configuration.privateBucket,
      configuration.forcePathStyle,
      configuration.accessKeyId,
      configuration.secretAccessKey,
    ]))
    .digest("hex");
}

function objectStorage(
  configuration: ObjectStorageConfiguration = objectStorageConfiguration(),
) {
  const cache = objectStorageCache();
  const cacheKey = objectStorageCacheKey(configuration);
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  // Environment-backed object-storage configuration is immutable for the
  // lifetime of a deployed process. Cache only after construction succeeds so
  // an initialization failure never poisons subsequent attempts.
  const storage = new S3MediaStorage(configuration satisfies S3MediaStorageOptions);
  cache.set(cacheKey, storage);
  return storage;
}

export function activeMediaStorage(): MediaStorage {
  const deploymentEnvironment = configuredDeploymentEnvironment();
  return configuredDriver(deploymentEnvironment) === "s3" ? objectStorage() : localStorage();
}

export function validateMediaStorageConfiguration() {
  const deploymentEnvironment = configuredDeploymentEnvironment();
  if (configuredDriver(deploymentEnvironment) === "s3") {
    const configuration = objectStorageConfiguration(deploymentEnvironment);
    return { backend: "OBJECT", provider: configuration.provider } as const;
  }
  const storage = localStorage();
  return { backend: storage.backend, provider: storage.provider } as const;
}

export function mediaStorageForReference(reference: Pick<MediaStorageReference, "storageBackend" | "storageProvider">): MediaStorage {
  const backend: MediaStorageBackend = reference.storageBackend ?? "LOCAL";
  if (backend === "LOCAL") return localStorage();
  const storage = objectStorage();
  if (reference.storageProvider && reference.storageProvider !== storage.provider) {
    throw new MediaStorageError("CONFIGURATION", "The configured object provider does not match the asset metadata.");
  }
  return storage;
}

export function activeStorageMetadata() {
  const configuration = validateMediaStorageConfiguration();
  return { storageBackend: configuration.backend, storageProvider: configuration.provider } as const;
}

/** @internal Clears only the process-local storage cache for deterministic tests. */
export function resetMediaStorageCacheForTests() {
  if (process.env.NODE_ENV !== "test") {
    throw new MediaStorageError("CONFIGURATION", "The media storage cache can only be reset in tests.");
  }
  objectStorageCache().clear();
}
