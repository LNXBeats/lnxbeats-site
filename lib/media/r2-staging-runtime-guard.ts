import { assertR2StagingEnvironment } from "@/lib/media/r2-staging-guard";
import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";

export const R2_STAGING_RUNTIME_CONFIRMATION = "run-r2-staging-runtime-qa";

type RuntimeEnvironment = Record<string, string | undefined>;

function required(environment: RuntimeEnvironment, name: string) {
  const value = environment[name]?.trim();
  if (!value) throw new Error(`${name} is required for the R2 staging runtime QA.`);
  return value;
}

function loopback(hostname: string) {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

export function assertR2StagingRuntimeEnvironment(environment: RuntimeEnvironment) {
  const r2 = assertR2StagingEnvironment(environment);
  if (environment.MEDIA_R2_STAGING_RUNTIME_CONFIRM !== R2_STAGING_RUNTIME_CONFIRMATION) {
    throw new Error(
      `Set MEDIA_R2_STAGING_RUNTIME_CONFIRM=${R2_STAGING_RUNTIME_CONFIRMATION} to run the destructive R2 staging runtime QA.`,
    );
  }
  if (environment.NODE_ENV !== "test") throw new Error("NODE_ENV must be test for the R2 staging runtime QA.");
  if (environment.EMAIL_PROVIDER !== "capture") {
    throw new Error("EMAIL_PROVIDER must be capture for the R2 staging runtime QA.");
  }

  const databaseTarget = required(environment, "LNX_DATABASE_TARGET");
  if (!databaseTarget.endsWith("-test") || databaseTarget === "lnx-studio-local-preview") {
    throw new Error("LNX_DATABASE_TARGET must identify a disposable *-test database.");
  }

  const databaseUrl = assertSafeLocalPostgresUrl(required(environment, "DATABASE_URL"));

  const authUrl = new URL(required(environment, "AUTH_URL"));
  if (
    authUrl.protocol !== "http:"
    || !loopback(authUrl.hostname)
    || !authUrl.port
    || authUrl.port === "3000"
    || authUrl.pathname !== "/"
    || authUrl.search
    || authUrl.hash
    || authUrl.username
    || authUrl.password
  ) {
    throw new Error("AUTH_URL must be an isolated loopback HTTP origin on an explicit port other than 3000.");
  }

  const authSecret = required(environment, "AUTH_SECRET");
  if (authSecret.length < 32) throw new Error("AUTH_SECRET must contain at least 32 characters for HTTP QA.");
  const password = required(environment, "LNX_AUTH_QA_PASSWORD");
  if (password.length < 12) throw new Error("LNX_AUTH_QA_PASSWORD must contain at least 12 characters.");

  return {
    ...r2,
    databaseTarget,
    databaseUrl: databaseUrl.toString(),
    proofPath: required(environment, "LNX_PRISMA_DEV_SERVER_FILE"),
    baseUrl: authUrl.origin,
    password,
  } as const;
}
