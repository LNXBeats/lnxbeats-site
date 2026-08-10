import "server-only";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

const globalForPrisma = globalThis as typeof globalThis & {
  prisma?: PrismaClient;
};

const databaseUrl = process.env.DATABASE_URL;

export function assertDatabaseConfigured() {
  if (!databaseUrl) {
    throw new Error("Database configuration is unavailable.");
  }
}

function createPrismaClient() {
  // Prisma must be instantiable during a public build, where DATABASE_URL is
  // intentionally absent. This loopback-only fallback cannot reach a real
  // database; runtime callers still fail closed through the assertion above.
  const connectionString = databaseUrl ?? "postgresql://invalid:invalid@127.0.0.1:1/invalid";

  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
