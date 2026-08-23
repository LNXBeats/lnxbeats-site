import "server-only";

export const PRODUCTION_DATABASE_TARGET = "lnx-studio-production";
export const PRODUCTION_ORIGIN = "https://www.lnxbeats.fr";

export const ADMIN_PRODUCTION_CONFIRMATION = "bootstrap-first-production-admin";
export const CATALOG_PRODUCTION_CONFIRMATION = "import-canonical-production-catalog";
export const MEDIA_PRODUCTION_CONFIRMATION = "import-canonical-production-media";

export class ProductionBootstrapError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProductionBootstrapError";
  }
}

export function safeProductionBootstrapErrorMessage(error: unknown, fallback: string) {
  return error instanceof ProductionBootstrapError ? error.message : fallback;
}

type Environment = Record<string, string | undefined>;

function required(environment: Environment, name: string) {
  const value = environment[name]?.trim();
  if (!value) throw new ProductionBootstrapError(`${name} is required.`);
  return value;
}

function productionUrl(environment: Environment, name: "AUTH_URL" | "APP_CANONICAL_URL") {
  const value = required(environment, name);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ProductionBootstrapError(`${name} must be the canonical production URL.`);
  }
  if (url.origin !== PRODUCTION_ORIGIN || url.pathname !== "/" || url.search || url.hash) {
    throw new ProductionBootstrapError(`${name} must be exactly ${PRODUCTION_ORIGIN}.`);
  }
}

export function assertProductionDatabaseEnvironment(environment: Environment = process.env) {
  if (environment.NODE_ENV !== "production") {
    throw new ProductionBootstrapError("NODE_ENV must be production.");
  }
  if (environment.LNX_DATABASE_TARGET !== PRODUCTION_DATABASE_TARGET) {
    throw new ProductionBootstrapError(`LNX_DATABASE_TARGET must be ${PRODUCTION_DATABASE_TARGET}.`);
  }
  productionUrl(environment, "AUTH_URL");
  productionUrl(environment, "APP_CANONICAL_URL");

  const rawDatabaseUrl = required(environment, "DATABASE_URL");
  let databaseUrl: URL;
  try {
    databaseUrl = new URL(rawDatabaseUrl);
  } catch {
    throw new ProductionBootstrapError("DATABASE_URL must be a valid PostgreSQL URL.");
  }
  if (!(databaseUrl.protocol === "postgres:" || databaseUrl.protocol === "postgresql:")) {
    throw new ProductionBootstrapError("DATABASE_URL must target PostgreSQL.");
  }
  const identity = `${databaseUrl.hostname}/${databaseUrl.pathname}`.toLowerCase();
  if (
    ["127.0.0.1", "localhost", "::1"].includes(databaseUrl.hostname)
    || /(?:^|[._/-])(staging|stage|qa|test)(?:$|[._/-])/.test(identity)
  ) {
    throw new ProductionBootstrapError("DATABASE_URL does not identify an approved production target.");
  }
  return { environment: "production" as const, databaseConfigured: true as const };
}

export function assertProductionApply(
  apply: boolean,
  environmentName: string,
  expectedConfirmation: string,
  environment: Environment = process.env,
) {
  if (!apply) return;
  if (environment[environmentName] !== expectedConfirmation) {
    throw new ProductionBootstrapError(`${environmentName} does not contain the exact apply confirmation.`);
  }
}

export function assertProductionMediaEnvironment(environment: Environment = process.env) {
  assertProductionDatabaseEnvironment(environment);
  if (environment.MEDIA_DEPLOYMENT_ENV !== "production") {
    throw new ProductionBootstrapError("MEDIA_DEPLOYMENT_ENV must be production.");
  }
  if (environment.MEDIA_STORAGE_DRIVER !== "s3" || environment.MEDIA_STORAGE_PROVIDER !== "r2") {
    throw new ProductionBootstrapError("Production media import requires the s3/r2 storage configuration.");
  }
  if (environment.MEDIA_S3_REGION !== "auto" || environment.MEDIA_S3_FORCE_PATH_STYLE !== "false") {
    throw new ProductionBootstrapError("Production R2 requires region=auto and forcePathStyle=false.");
  }
  const publicBucket = required(environment, "MEDIA_PUBLIC_BUCKET");
  const privateBucket = required(environment, "MEDIA_PRIVATE_BUCKET");
  if (publicBucket !== "lnx-studio-production-public" || privateBucket !== "lnx-studio-production-private") {
    throw new ProductionBootstrapError("Production media import requires the two exact production bucket names.");
  }
  if (/staging|qa|test/i.test(`${publicBucket}:${privateBucket}`)) {
    throw new ProductionBootstrapError("A staging, QA or test bucket can never be an apply target.");
  }
  return { publicBucket, privateBucket };
}

export function maskEmail(email: string) {
  const [local, domain] = email.split("@");
  if (!local || !domain) return "configured";
  return `${local.slice(0, 1)}***@${domain}`;
}
