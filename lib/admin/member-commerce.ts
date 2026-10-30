import "server-only";

import { Prisma } from "@/generated/prisma/client";
import { requireMemberSignInAdmin } from "@/lib/admin/member-sign-in-policy";

export type MemberCommerce = {
  musicPaidOrders: number;
  musicUnpaidRequests: number;
  digitalPaidOrders: number;
  digitalTracks: number;
  digitalAlbums: number;
  digitalRefundedOrders: number;
  digitalReviewOrders: number;
};

export const emptyMemberCommerce: Readonly<MemberCommerce> = {
  musicPaidOrders: 0, musicUnpaidRequests: 0, digitalPaidOrders: 0,
  digitalTracks: 0, digitalAlbums: 0, digitalRefundedOrders: 0, digitalReviewOrders: 0,
};

type Row = MemberCommerce & { userId: string };
type Dependencies = { read(query: Prisma.Sql): Promise<Row[]> };
const dependencies: Dependencies = {
  async read(query) {
    const { prisma, assertDatabaseConfigured } = await import("@/lib/prisma");
    assertDatabaseConfigured();
    return prisma.$queryRaw<Row[]>(query);
  },
};

/** Historical LIVE purchases, not current entitlements or an accounting total.
 * No name/title-based test exclusion: an owner's real LIVE payment remains here.
 * submittedAt is deliberately unused: it is recorded before payment completes.
 */
export async function listAdminMemberCommerce(
  actor: { role?: unknown; status?: unknown } | null | undefined,
  memberIds: readonly string[],
  db: Dependencies = dependencies,
): Promise<Map<string, MemberCommerce>> {
  requireMemberSignInAdmin(actor);
  const ids = [...new Set(memberIds)];
  if (!ids.length) return new Map();
  if (ids.length > 200 || ids.some(id => !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id))) {
    throw new Error("INVALID_MEMBER_SCOPE");
  }

  // One parameterized, read-only statement scoped to the members already shown.
  // Aggregate orders before lines so retries and album tracks never multiply sales.
  const rows = await db.read(Prisma.sql`
    WITH selected_members AS (
      SELECT unnest(ARRAY[${Prisma.join(ids)}]::uuid[]) AS id
    ), music AS (
      SELECT o."userId", o.status,
        EXISTS (SELECT 1 FROM payments p WHERE p."orderId" = o.id
          AND p.mode = 'LIVE' AND p."paidAt" IS NOT NULL
          AND p."amountCents" > 0 AND NULLIF(btrim(p."providerPaymentId"), '') IS NOT NULL) AS paid,
        EXISTS (SELECT 1 FROM payments p WHERE p."orderId" = o.id
          AND p."paidAt" IS NOT NULL AND p."amountCents" > 0
          AND NULLIF(btrim(p."providerPaymentId"), '') IS NOT NULL) AS any_paid
      FROM orders o JOIN selected_members m ON m.id = o."userId"
    ), music_counts AS (
      SELECT "userId", count(*) FILTER (WHERE paid)::int AS "musicPaidOrders",
        count(*) FILTER (WHERE NOT any_paid AND status IN ('DRAFT', 'AWAITING_PAYMENT', 'CANCELLED'))::int AS "musicUnpaidRequests"
      FROM music GROUP BY "userId"
    ), digital AS (
      SELECT o.id, o."userId", o.status, proof.captures
      FROM digital_orders o JOIN selected_members m ON m.id = o."userId"
      CROSS JOIN LATERAL (
        SELECT count(*)::int AS captures FROM digital_payment_attempts a
        WHERE a."orderId" = o.id AND a.status = 'PAID'
          AND a.provider IN ('STRIPE', 'PAYPAL')
          AND NULLIF(btrim(a."paymentReference"), '') IS NOT NULL
      ) proof
      WHERE o.mode = 'LIVE' AND o."totalCents" > 0 AND proof.captures > 0
    ), digital_counts AS (
      SELECT "userId", count(*)::int AS "digitalPaidOrders",
        count(*) FILTER (WHERE status IN ('REFUNDED', 'PARTIALLY_REFUNDED'))::int AS "digitalRefundedOrders",
        count(*) FILTER (WHERE status NOT IN ('PAID', 'REFUNDED', 'PARTIALLY_REFUNDED') OR captures > 1)::int AS "digitalReviewOrders"
      FROM digital GROUP BY "userId"
    ), line_counts AS (
      SELECT d."userId", count(*) FILTER (WHERE l.scope = 'TRACK')::int AS "digitalTracks",
        count(*) FILTER (WHERE l.scope = 'ALBUM')::int AS "digitalAlbums"
      FROM digital d JOIN digital_order_lines l ON l."orderId" = d.id GROUP BY d."userId"
    )
    SELECT m.id AS "userId", COALESCE(c."musicPaidOrders", 0) AS "musicPaidOrders",
      COALESCE(c."musicUnpaidRequests", 0) AS "musicUnpaidRequests",
      COALESCE(d."digitalPaidOrders", 0) AS "digitalPaidOrders",
      COALESCE(l."digitalTracks", 0) AS "digitalTracks", COALESCE(l."digitalAlbums", 0) AS "digitalAlbums",
      COALESCE(d."digitalRefundedOrders", 0) AS "digitalRefundedOrders",
      COALESCE(d."digitalReviewOrders", 0) AS "digitalReviewOrders"
    FROM selected_members m LEFT JOIN music_counts c ON c."userId" = m.id
    LEFT JOIN digital_counts d ON d."userId" = m.id LEFT JOIN line_counts l ON l."userId" = m.id
  `);
  return new Map(rows.map(({ userId, ...counts }) => [userId, counts]));
}
