import "server-only";

import { readdir } from "node:fs/promises";
import { join } from "node:path";

import type { PrismaClient } from "@/generated/prisma/client";

import {
  PAYMENT_PRODUCTION_CONFIRMATION,
  parsePaymentsConfiguration,
} from "@/lib/payments/config";
import type {
  PaymentDeploymentEnvironment,
  PaymentsConfiguration,
  PersistedPaymentMode,
} from "@/lib/payments/types";
import { prisma } from "@/lib/prisma";

type Environment = Readonly<Record<string, string | undefined>>;

export type PaymentDiagnosticStatus = "SAFE_DISABLED" | "CONFIGURED_DISABLED" | "INVALID";

export type PaymentDatabaseDiagnostic = Readonly<{
  reachable: boolean;
  migrationsKnown: number;
  migrationsApplied: number;
  failedMigrations: number;
  modeAnomalies: number;
  currencyAnomalies: number;
  relationshipAnomalies: number;
  reviewRequired: number;
}>;

export type PaymentDiagnosticRepository = Readonly<{
  inspect(expectedMode: PersistedPaymentMode): Promise<PaymentDatabaseDiagnostic>;
}>;

export type PaymentDiagnosticResult = Readonly<{
  status: PaymentDiagnosticStatus;
  environment: PaymentDeploymentEnvironment | "invalid";
  production: boolean;
  paymentsEnabled: boolean | "invalid";
  liveRefundsEnabled: boolean;
  stripe: Readonly<{
    flag: boolean | "invalid";
    enabled: boolean | "invalid";
    mode: "disabled" | "test" | "live" | "invalid";
    configured: boolean;
    secretConfigured: boolean;
    webhookConfigured: boolean;
  }>;
  paypal: Readonly<{
    flag: boolean | "invalid";
    enabled: boolean | "invalid";
    environment: "disabled" | "sandbox" | "live" | "invalid";
    configured: boolean;
    clientConfigured: boolean;
    secretConfigured: boolean;
    webhookConfigured: boolean;
  }>;
  productionConfirmationPresent: boolean;
  productionConfirmationValid: boolean;
  canonicalOrigin: string;
  originsConsistent: boolean;
  database: PaymentDatabaseDiagnostic;
  checks: readonly Readonly<{ name: string; passed: boolean }>[];
}>;

function present(environment: Environment, name: string) {
  return Boolean(environment[name]?.trim());
}

function knownFlag(environment: Environment, name: string): boolean | "invalid" {
  const value = environment[name]?.trim();
  if (value === undefined || value === "" || value === "false") return false;
  if (value === "true") return true;
  return "invalid";
}

function knownDeploymentEnvironment(environment: Environment): PaymentDeploymentEnvironment | "invalid" {
  const value = environment.PAYMENT_DEPLOYMENT_ENV?.trim() || "development";
  return value === "development" || value === "staging" || value === "production"
    ? value
    : "invalid";
}

function knownStripeMode(environment: Environment): "disabled" | "test" | "live" | "invalid" {
  const value = environment.STRIPE_MODE?.trim();
  if (!value) return "disabled";
  return value === "test" || value === "live" ? value : "invalid";
}

function knownPaypalEnvironment(environment: Environment): "disabled" | "sandbox" | "live" | "invalid" {
  const value = environment.PAYPAL_ENVIRONMENT?.trim();
  if (!value) return "disabled";
  return value === "sandbox" || value === "live" ? value : "invalid";
}

function inspectOrigins(
  environment: Environment,
  deploymentEnvironment: PaymentDeploymentEnvironment | "invalid",
) {
  const values = [environment.APP_CANONICAL_URL, environment.AUTH_URL, environment.SITE_URL];
  if (values.some((value) => !value?.trim())) {
    return { canonicalOrigin: "absent", consistent: false };
  }
  try {
    const urls = values.map((value) => new URL(value!));
    const canonical = urls[0]!;
    const structurallySafe = urls.every((url) => url.protocol === "https:"
      && url.origin === canonical.origin
      && url.pathname === "/"
      && !url.username
      && !url.password
      && !url.search
      && !url.hash);
    const productionHostSafe = deploymentEnvironment !== "production"
      || ["lnxbeats.fr", "www.lnxbeats.fr"].includes(canonical.hostname);
    if (!structurallySafe || !productionHostSafe) {
      return { canonicalOrigin: "invalid", consistent: false };
    }
    return { canonicalOrigin: canonical.origin, consistent: true };
  } catch {
    return { canonicalOrigin: "invalid", consistent: false };
  }
}

function runtimeMatchesDeployment(
  environment: Environment,
  deploymentEnvironment: PaymentDeploymentEnvironment | "invalid",
) {
  if (deploymentEnvironment === "invalid") return false;
  const railwayName = environment.RAILWAY_ENVIRONMENT_NAME?.trim();
  const railwayEnvironment = environment.RAILWAY_ENVIRONMENT?.trim().toLowerCase();
  if (deploymentEnvironment === "production") {
    return environment.NODE_ENV === "production"
      && railwayName === "production"
      && !railwayEnvironment?.includes("staging");
  }
  if (deploymentEnvironment === "staging") {
    return environment.NODE_ENV === "production"
      && railwayName === "staging"
      && !railwayEnvironment?.includes("production");
  }
  return environment.NODE_ENV !== "production" && railwayName === undefined;
}

function count(rows: readonly Readonly<{ count: bigint | number }>[]) {
  return Number(rows[0]?.count ?? -1);
}

async function migrationDirectoryCount() {
  const entries = await readdir(join(process.cwd(), "prisma", "migrations"), { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).length;
}

export function createPrismaPaymentDiagnosticRepository(
  client: PrismaClient = prisma,
): PaymentDiagnosticRepository {
  return {
    async inspect(expectedMode) {
      const expectedLivemode = expectedMode === "LIVE";
      const [
        migrationsKnown,
        appliedMigrations,
        failedMigrations,
        paymentModeAnomalies,
        eventModeAnomalies,
        currencyAnomalies,
        relationshipAnomalies,
        reviewRequired,
      ] = await Promise.all([
        migrationDirectoryCount(),
        client.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*)::bigint AS count
          FROM "_prisma_migrations"
          WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
        `,
        client.$queryRaw<Array<{ count: bigint }>>`
          SELECT COUNT(*)::bigint AS count
          FROM "_prisma_migrations"
          WHERE finished_at IS NULL AND rolled_back_at IS NULL
        `,
        client.payment.count({ where: { mode: { not: expectedMode } } }),
        client.providerEvent.count({ where: { livemode: { not: expectedLivemode } } }),
        client.$queryRaw<Array<{ count: bigint }>>`
          SELECT (
            (SELECT COUNT(*) FROM "orders" WHERE "currency" <> 'EUR')
            + (SELECT COUNT(*) FROM "payments" WHERE "currency" <> 'EUR')
            + (SELECT COUNT(*) FROM "refund_attempts" WHERE "currency" <> 'EUR')
            + (SELECT COUNT(*) FROM "payment_incidents" WHERE "currency" IS NOT NULL AND "currency" <> 'EUR')
          )::bigint AS count
        `,
        client.$queryRaw<Array<{ count: bigint }>>`
          SELECT (
            (SELECT COUNT(*)
              FROM "payments"
              WHERE ("orderId" IS NULL AND "shopOrderId" IS NULL)
                OR ("orderId" IS NOT NULL AND "shopOrderId" IS NOT NULL))
            + (SELECT COUNT(*)
              FROM "payments" payment
              INNER JOIN "shop_orders" shop_order ON shop_order."id" = payment."shopOrderId"
              WHERE payment."amountCents" <> shop_order."totalCents"
                OR payment."currency" <> shop_order."currency")
            + (SELECT COUNT(*)
              FROM "payments" payment
              INNER JOIN "orders" ordered ON ordered."id" = payment."orderId"
              WHERE payment."amountCents" <> ordered."totalCents"
                OR payment."currency" <> ordered."currency")
            + (SELECT COUNT(*)
              FROM "provider_events" event
              INNER JOIN "payments" payment ON payment."id" = event."paymentId"
              WHERE event."provider" <> payment."provider"
                OR event."livemode" <> (payment."mode" = 'LIVE'))
            + (SELECT COUNT(*)
              FROM "payments" payment
              INNER JOIN "orders" ordered ON ordered."id" = payment."orderId"
              WHERE payment."status" IN ('SUCCEEDED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED')
                AND ordered."status" IN ('DRAFT', 'AWAITING_PAYMENT'))
            + (SELECT COUNT(*) FROM (
              SELECT 'ORDER' AS parent_type, "orderId" AS parent_id
              FROM "payments"
              WHERE "orderId" IS NOT NULL
                AND "shopOrderId" IS NULL
                AND "status" IN ('SUCCEEDED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED')
              GROUP BY "orderId"
              HAVING COUNT(*) > 1
              UNION ALL
              SELECT 'SHOP_ORDER' AS parent_type, "shopOrderId" AS parent_id
              FROM "payments"
              WHERE "orderId" IS NULL
                AND "shopOrderId" IS NOT NULL
                AND "status" IN ('SUCCEEDED', 'REFUND_PENDING', 'PARTIALLY_REFUNDED', 'REFUNDED')
              GROUP BY "shopOrderId"
              HAVING COUNT(*) > 1
            ) AS duplicate_winners)
          )::bigint AS count
        `,
        client.$queryRaw<Array<{ count: bigint }>>`
          SELECT (
            (SELECT COUNT(*) FROM "payments" WHERE "status" = 'REQUIRES_REVIEW')
            + (SELECT COUNT(*) FROM "provider_events" WHERE "outcome" = 'REQUIRES_REVIEW')
            + (SELECT COUNT(*) FROM "refund_attempts" WHERE "status" = 'REQUIRES_REVIEW')
            + (SELECT COUNT(*)
              FROM "payment_incidents"
              WHERE "requiresOperatorReview" = true AND "status" <> 'RESOLVED')
          )::bigint AS count
        `,
      ]);

      return {
        reachable: true,
        migrationsKnown,
        migrationsApplied: count(appliedMigrations),
        failedMigrations: count(failedMigrations),
        modeAnomalies: paymentModeAnomalies + eventModeAnomalies,
        currencyAnomalies: count(currencyAnomalies),
        relationshipAnomalies: count(relationshipAnomalies),
        reviewRequired: count(reviewRequired),
      };
    },
  };
}

const unavailableDatabase: PaymentDatabaseDiagnostic = {
  reachable: false,
  migrationsKnown: -1,
  migrationsApplied: -1,
  failedMigrations: -1,
  modeAnomalies: -1,
  currencyAnomalies: -1,
  relationshipAnomalies: -1,
  reviewRequired: -1,
};

function diagnosticConfiguration(
  environment: Environment,
): { configuration?: PaymentsConfiguration; valid: boolean } {
  try {
    return { configuration: parsePaymentsConfiguration(environment), valid: true };
  } catch {
    return { valid: false };
  }
}

export async function runPaymentDiagnostic(
  environment: Environment = process.env,
  repository: PaymentDiagnosticRepository = createPrismaPaymentDiagnosticRepository(),
): Promise<PaymentDiagnosticResult> {
  const deploymentEnvironment = knownDeploymentEnvironment(environment);
  const paymentsEnabled = knownFlag(environment, "PAYMENTS_ENABLED");
  const stripeRequested = knownFlag(environment, "STRIPE_PAYMENTS_ENABLED");
  const paypalRequested = knownFlag(environment, "PAYPAL_PAYMENTS_ENABLED");
  const stripeMode = knownStripeMode(environment);
  const paypalEnvironment = knownPaypalEnvironment(environment);
  const configurationResult = diagnosticConfiguration(environment);
  const configuration = configurationResult.configuration;
  const origins = inspectOrigins(environment, deploymentEnvironment);
  const confirmationPresent = present(environment, "PAYMENT_PRODUCTION_CONFIRM");
  const confirmationValid = environment.PAYMENT_PRODUCTION_CONFIRM?.trim() === PAYMENT_PRODUCTION_CONFIRMATION;
  const expectedMode: PersistedPaymentMode = deploymentEnvironment === "production" ? "LIVE" : "TEST";

  let database = unavailableDatabase;
  try {
    database = await repository.inspect(expectedMode);
  } catch {
    database = unavailableDatabase;
  }

  const checks = [
    { name: "configuration.valid", passed: configurationResult.valid },
    { name: "deployment.known", passed: deploymentEnvironment !== "invalid" },
    { name: "runtime.matchesDeployment", passed: runtimeMatchesDeployment(environment, deploymentEnvironment) },
    { name: "origins.https.consistent", passed: origins.consistent },
    { name: "payments.disabled", passed: configuration?.enabled === false },
    {
      name: configuration?.liveRefundsEnabled === true
        ? "refunds.live.explicitly-enabled"
        : "refunds.live.disabled",
      passed: true,
    },
    {
      name: "stripe.mode.matchesDeployment",
      passed: stripeMode === "disabled"
        || (deploymentEnvironment === "production" ? stripeMode === "live" : stripeMode === "test"),
    },
    {
      name: "paypal.environment.matchesDeployment",
      passed: paypalEnvironment === "disabled"
        || (deploymentEnvironment === "production" ? paypalEnvironment === "live" : paypalEnvironment === "sandbox"),
    },
    {
      name: "production.confirmation.whenArmed",
      passed: configuration?.enabled !== true || deploymentEnvironment !== "production" || confirmationValid,
    },
    {
      name: "stripe.credentials.whenEnabled",
      passed: configuration?.stripe.enabled !== true || configuration.stripe.configured,
    },
    {
      name: "paypal.credentials.whenEnabled",
      passed: configuration?.paypal.enabled !== true || configuration.paypal.configured,
    },
    { name: "database.reachable", passed: database.reachable },
    {
      name: "database.migrations.current",
      passed: database.reachable
        && database.migrationsKnown >= 0
        && database.migrationsApplied === database.migrationsKnown
        && database.failedMigrations === 0,
    },
    { name: "database.modes.consistent", passed: database.modeAnomalies === 0 },
    { name: "database.currency.eur", passed: database.currencyAnomalies === 0 },
    { name: "database.relationships.consistent", passed: database.relationshipAnomalies === 0 },
    { name: "database.review.clear", passed: database.reviewRequired === 0 },
  ] as const;

  const valid = checks.every((check) => check.passed);
  const configuredButDisabled = confirmationPresent
    || stripeRequested === true
    || paypalRequested === true
    || configuration?.liveRefundsEnabled === true;
  const status: PaymentDiagnosticStatus = !valid
    ? "INVALID"
    : configuredButDisabled
      ? "CONFIGURED_DISABLED"
      : "SAFE_DISABLED";

  return {
    status,
    environment: deploymentEnvironment,
    production: deploymentEnvironment === "production",
    paymentsEnabled,
    liveRefundsEnabled: configuration?.liveRefundsEnabled ?? false,
    stripe: {
      flag: stripeRequested,
      enabled: configuration?.stripe.enabled ?? "invalid",
      mode: stripeMode,
      configured: configuration?.stripe.configured ?? false,
      secretConfigured: present(environment, "STRIPE_SECRET_KEY"),
      webhookConfigured: present(environment, "STRIPE_WEBHOOK_SECRET"),
    },
    paypal: {
      flag: paypalRequested,
      enabled: configuration?.paypal.enabled ?? "invalid",
      environment: paypalEnvironment,
      configured: configuration?.paypal.configured ?? false,
      clientConfigured: present(environment, "PAYPAL_CLIENT_ID"),
      secretConfigured: present(environment, "PAYPAL_CLIENT_SECRET"),
      webhookConfigured: present(environment, "PAYPAL_WEBHOOK_ID"),
    },
    productionConfirmationPresent: confirmationPresent,
    productionConfirmationValid: confirmationValid,
    canonicalOrigin: origins.canonicalOrigin,
    originsConsistent: origins.consistent,
    database,
    checks,
  };
}

export function formatPaymentDiagnostic(result: PaymentDiagnosticResult) {
  const lines = [
    "PAYMENTS_DIAGNOSTIC",
    `environment=${result.environment}`,
    `production=${result.production}`,
    `paymentsEnabled=${result.paymentsEnabled}`,
    `liveRefundsEnabled=${result.liveRefundsEnabled}`,
    `stripeFlag=${result.stripe.flag}`,
    `stripe.enabled=${result.stripe.enabled}`,
    `stripe.mode=${result.stripe.mode}`,
    `stripe.configured=${result.stripe.configured}`,
    `stripe.secretConfigured=${result.stripe.secretConfigured}`,
    `stripe.webhookConfigured=${result.stripe.webhookConfigured}`,
    `paypalFlag=${result.paypal.flag}`,
    `paypal.enabled=${result.paypal.enabled}`,
    `paypal.environment=${result.paypal.environment}`,
    `paypal.configured=${result.paypal.configured}`,
    `paypal.clientConfigured=${result.paypal.clientConfigured}`,
    `paypal.secretConfigured=${result.paypal.secretConfigured}`,
    `paypal.webhookConfigured=${result.paypal.webhookConfigured}`,
    `productionConfirmationPresent=${result.productionConfirmationPresent}`,
    `productionConfirmationValid=${result.productionConfirmationValid}`,
    `canonicalOrigin=${result.canonicalOrigin}`,
    `originsConsistent=${result.originsConsistent}`,
    `database=${result.database.reachable ? "reachable" : "unreachable"}`,
    `migrations=${result.database.migrationsApplied}/${result.database.migrationsKnown}`,
    `failedMigrations=${result.database.failedMigrations}`,
    `modeAnomalies=${result.database.modeAnomalies}`,
    `currencyAnomalies=${result.database.currencyAnomalies}`,
    `relationshipAnomalies=${result.database.relationshipAnomalies}`,
    `reviewRequired=${result.database.reviewRequired}`,
  ];
  for (const check of result.checks) {
    lines.push(`${check.passed ? "PASS" : "INVALID"} ${check.name}`);
  }
  lines.push(`status=${result.status}`);
  return lines.join("\n");
}
