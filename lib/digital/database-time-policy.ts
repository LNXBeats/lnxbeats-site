import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { DigitalError } from "./domain";

/** The installed pg adapter serialises Date as a UTC wall time without an
 * offset. A non-UTC PostgreSQL session can therefore silently shift a durable
 * timestamp. Check the actual session before new DCN proofs or decisions; do
 * not silently SET the timezone, rewrite history or change the shared adapter.
 * Writes must call this inside the same interactive transaction as their DML.
 */
export async function assertDigitalDatabaseUtc(db: Pick<Prisma.TransactionClient, "$queryRaw">) {
  let rows: Array<{ timezone: unknown }>;
  try {
    rows = await db.$queryRaw<Array<{ timezone: unknown }>>`SELECT current_setting('TimeZone')::text AS timezone`;
  } catch {
    throw new DigitalError("DIGITAL_DATABASE_TIMEZONE_UNSAFE", 503);
  }
  // A currently zero offset is insufficient: a named civil zone may use DST.
  if (!Array.isArray(rows) || rows.length !== 1 || typeof rows[0]?.timezone !== "string" || !["UTC", "Etc/UTC"].includes(rows[0].timezone)) {
    throw new DigitalError("DIGITAL_DATABASE_TIMEZONE_UNSAFE", 503);
  }
}
