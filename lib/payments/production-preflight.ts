import "server-only";

import { readdir } from "node:fs/promises";
import { join } from "node:path";

import type { PrismaClient } from "@/generated/prisma/client";

import {
  PAYMENT_PRODUCTION_CONFIRMATION,
  parsePaymentsConfiguration,
} from "@/lib/payments/config";
import type { PaymentsConfiguration } from "@/lib/payments/types";
import { prisma } from "@/lib/prisma";

type Environment = Readonly<Record<string, string | undefined>>;

export type PaymentPreflightRule = Readonly<{
  name: string;
  passed: boolean;
  detail?: string;
}>;

export type PaymentPreflightStatus =
  | "SAFE_DISABLED"
  | "READY_FOR_STRIPE_LIVE_QA"
  | "READY_FOR_PAYPAL_LIVE_QA"
  | "READY_FOR_DUAL_LIVE_QA"
  | "BLOCKED";

export type PaymentProductionPreflightResult = Readonly<{
  passed: boolean;
  status: PaymentPreflightStatus;
  rules: readonly PaymentPreflightRule[];
}>;

const winningStatuses = ["SUCCEEDED", "REFUND_PENDING", "PARTIALLY_REFUNDED", "REFUNDED"] as const;

function rule(name: string, passed: boolean, detail?: string): PaymentPreflightRule {
  return { name, passed, ...(detail ? { detail } : {}) };
}

function canonicalProductionOrigin(environment: Environment) {
  const raw = environment.APP_CANONICAL_URL ?? environment.AUTH_URL ?? environment.SITE_URL;
  if (!raw) return false;
  try {
    const value = new URL(raw);
    const valid = (candidate: string) => {
      const url = new URL(candidate);
      return url.protocol === "https:"
        && url.origin === value.origin
        && url.pathname === "/"
        && !url.username
        && !url.password
        && !url.search
        && !url.hash;
    };
    return value.protocol === "https:"
      && ["lnxbeats.fr", "www.lnxbeats.fr"].includes(value.hostname)
      && value.pathname === "/"
      && !value.username
      && !value.password
      && !value.search
      && !value.hash
      && (!environment.AUTH_URL || valid(environment.AUTH_URL))
      && (!environment.SITE_URL || valid(environment.SITE_URL));
  } catch {
    return false;
  }
}

function configuredStatus(configuration: PaymentsConfiguration): Exclude<PaymentPreflightStatus, "BLOCKED"> {
  if (!configuration.enabled) return "SAFE_DISABLED";
  if (configuration.stripe.enabled && configuration.paypal.enabled) return "READY_FOR_DUAL_LIVE_QA";
  if (configuration.stripe.enabled) return "READY_FOR_STRIPE_LIVE_QA";
  return "READY_FOR_PAYPAL_LIVE_QA";
}

async function migrationDirectoryCount() {
  const entries = await readdir(join(process.cwd(), "prisma", "migrations"), { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).length;
}

async function databaseRules(client: PrismaClient): Promise<PaymentPreflightRule[]> {
  const [
    migrationDirectories,
    appliedMigrations,
    failedMigrations,
    columns,
    orderWinners,
    shopOrderWinners,
    invalidParents,
    nonEuro,
  ] = await Promise.all([
    migrationDirectoryCount(),
    client.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`,
    client.$queryRaw<Array<{ count: bigint }>>`SELECT COUNT(*)::bigint AS count FROM "_prisma_migrations" WHERE finished_at IS NULL AND rolled_back_at IS NULL`,
    client.$queryRaw<Array<{ table_name: string; column_name: string }>>`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND ((table_name = 'payments' AND column_name = 'mode')
          OR (table_name = 'provider_events' AND column_name = 'livemode'))
    `,
    client.payment.groupBy({
      by: ["orderId"],
      where: {
        orderId: { not: null },
        shopOrderId: null,
        status: { in: [...winningStatuses] },
      },
      _count: { _all: true },
      having: { orderId: { _count: { gt: 1 } } },
      orderBy: { orderId: "asc" },
      take: 1,
    }),
    client.payment.groupBy({
      by: ["shopOrderId"],
      where: {
        orderId: null,
        shopOrderId: { not: null },
        status: { in: [...winningStatuses] },
      },
      _count: { _all: true },
      having: { shopOrderId: { _count: { gt: 1 } } },
      orderBy: { shopOrderId: "asc" },
      take: 1,
    }),
    client.payment.count({
      where: {
        OR: [
          { orderId: null, shopOrderId: null },
          { orderId: { not: null }, shopOrderId: { not: null } },
        ],
      },
    }),
    client.payment.count({ where: { currency: { not: "EUR" } } }),
  ]);
  const applied = Number(appliedMigrations[0]?.count ?? -1n);
  const failed = Number(failedMigrations[0]?.count ?? -1n);
  const requiredColumns = new Set(columns.map(({ table_name, column_name }) => `${table_name}.${column_name}`));
  return [
    rule("database.migrations.applied", applied === migrationDirectories, `${applied}/${migrationDirectories}`),
    rule("database.migrations.failed", failed === 0, String(failed)),
    rule(
      "database.mode.columns",
      requiredColumns.has("payments.mode") && requiredColumns.has("provider_events.livemode"),
    ),
    rule("database.parent.xor", invalidParents === 0, String(invalidParents)),
    rule(
      "database.winner.invariant",
      orderWinners.length === 0 && shopOrderWinners.length === 0,
    ),
    rule("database.currency.eur", nonEuro === 0, String(nonEuro)),
  ];
}

export async function runProductionPaymentPreflight(
  environment: Environment = process.env,
  client: PrismaClient = prisma,
): Promise<PaymentProductionPreflightResult> {
  const rules: PaymentPreflightRule[] = [];
  let configuration: PaymentsConfiguration;
  try {
    configuration = parsePaymentsConfiguration(environment);
    rules.push(rule("configuration.valid", true));
  } catch {
    return { passed: false, status: "BLOCKED", rules: [rule("configuration.valid", false)] };
  }

  rules.push(
    rule("deployment.production", configuration.deploymentEnvironment === "production"),
    rule("runtime.node.production", environment.NODE_ENV === "production"),
    rule("runtime.railway.production", environment.RAILWAY_ENVIRONMENT_NAME === "production"),
    rule("canonical.production.https", canonicalProductionOrigin(environment)),
    rule("currency.policy.eur", true),
    rule("refunds.live.disabled", !configuration.liveRefundsEnabled),
  );

  if (configuration.enabled) {
    rules.push(
      rule("arming.production.confirmed", environment.PAYMENT_PRODUCTION_CONFIRM === PAYMENT_PRODUCTION_CONFIRMATION),
      rule("provider.at.least-one", configuration.stripe.enabled || configuration.paypal.enabled),
      rule("stripe.mode.live", !configuration.stripe.enabled || configuration.stripe.mode === "live"),
      rule("stripe.configured", !configuration.stripe.enabled || configuration.stripe.configured),
      rule("paypal.environment.live", !configuration.paypal.enabled || configuration.paypal.environment === "live"),
      rule("paypal.configured", !configuration.paypal.enabled || configuration.paypal.configured),
    );
  } else {
    rules.push(
      rule("payments.disabled", true),
      rule("provider.flags.inert", !configuration.stripe.enabled && !configuration.paypal.enabled),
    );
  }

  try {
    rules.push(...await databaseRules(client));
  } catch {
    rules.push(rule("database.readonly.preflight", false));
  }

  const passed = rules.every(({ passed: rulePassed }) => rulePassed);
  return {
    passed,
    status: passed ? configuredStatus(configuration) : "BLOCKED",
    rules,
  };
}
