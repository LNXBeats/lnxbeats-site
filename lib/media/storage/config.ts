import path from "node:path";

import { LocalMediaStorage } from "@/lib/media/storage/local";
import { S3MediaStorage } from "@/lib/media/storage/s3";
import { MediaStorageError, type MediaStorage, type MediaStorageBackend, type MediaStorageReference } from "@/lib/media/storage/types";

type DriverName = "local" | "s3";

function configuredDriver(): DriverName {
  const value = process.env.MEDIA_STORAGE_DRIVER ?? "local";
  if (value !== "local" && value !== "s3") {
    throw new MediaStorageError("CONFIGURATION", "MEDIA_STORAGE_DRIVER must be local or s3.");
  }
  if (value === "local" && (process.env.MEDIA_DEPLOYMENT_ENV === "production" || process.env.RAILWAY_ENVIRONMENT)) {
    throw new MediaStorageError("CONFIGURATION", "Production media storage must use an object driver.");
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

function objectStorage() {
  return new S3MediaStorage({
    provider: process.env.MEDIA_STORAGE_PROVIDER?.trim() || "r2",
    endpoint: required("MEDIA_S3_ENDPOINT"),
    region: process.env.MEDIA_S3_REGION?.trim() || "auto",
    accessKeyId: required("MEDIA_S3_ACCESS_KEY_ID"),
    secretAccessKey: required("MEDIA_S3_SECRET_ACCESS_KEY"),
    publicBucket: required("MEDIA_PUBLIC_BUCKET"),
    privateBucket: required("MEDIA_PRIVATE_BUCKET"),
    forcePathStyle: process.env.MEDIA_S3_FORCE_PATH_STYLE === "true",
  });
}

export function activeMediaStorage(): MediaStorage {
  return configuredDriver() === "s3" ? objectStorage() : localStorage();
}

export function validateMediaStorageConfiguration() {
  const storage = activeMediaStorage();
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
  const storage = activeMediaStorage();
  return { storageBackend: storage.backend, storageProvider: storage.provider } as const;
}
