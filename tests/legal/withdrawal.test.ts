import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { handleWithdrawalSubmission } from "../../lib/legal/withdrawal-route-handler";
import { parseWithdrawalSubmission, WITHDRAWAL_DECLARATION } from "../../lib/legal/withdrawal";

const valid = {
  contractType: "SHOP_ORDER",
  orderNumber: "LNX-SHOP-2026-000014",
  firstName: "  Marie ",
  lastName: " Client ",
  email: "MEMBER@EXAMPLE.INVALID",
  productDescription: "CD audio",
  quantity: 1,
  reason: null,
  declarationAccepted: true,
} as const;

test("withdrawal payload is closed, normalized, allows no reason and requires explicit declaration", () => {
  assert.deepEqual(parseWithdrawalSubmission(valid), {
    ...valid,
    firstName: "Marie",
    lastName: "Client",
    email: "member@example.invalid",
  });
  assert.throws(() => parseWithdrawalSubmission({ ...valid, userId: "arbitrary" }), /invalide/i);
  assert.throws(() => parseWithdrawalSubmission({ ...valid, declarationAccepted: false }), /confirmée/i);
  assert.throws(() => parseWithdrawalSubmission({ ...valid, quantity: 0 }), /quantité/i);
  assert.throws(() => parseWithdrawalSubmission({ ...valid, orderNumber: "LNX-2026-000014" }), /numéro/i);
  assert.match(WITHDRAWAL_DECLARATION, /décision de me rétracter/);
});

function request(body: object, origin = "http://localhost:3000") {
  return new Request("http://localhost:3000/api/legal/withdrawals", {
    method: "POST",
    headers: { origin, "content-type": "application/json", "x-forwarded-for": "127.0.0.1" },
    body: JSON.stringify(body),
  });
}

test("route checks origin, returns a generic response and stores the receipt token only in HttpOnly cookie", async () => {
  const calls: unknown[] = [];
  const dependencies = {
    sameOrigin: (incoming: Request) => incoming.headers.get("origin") === "http://localhost:3000",
    async submit(input: ReturnType<typeof parseWithdrawalSubmission>) {
      calls.push(input);
      return { requestNumber: "LNX-RET-2026-AABBCCDDEEFF", receivedAt: new Date(), receiptToken: "a".repeat(43) };
    },
  };
  const denied = await handleWithdrawalSubmission(request(valid, "https://evil.example.invalid"), dependencies);
  assert.equal(denied.status, 403);
  assert.deepEqual(await denied.json(), { ok: false, message: "La demande ne peut pas être traitée." });

  const accepted = await handleWithdrawalSubmission(request(valid), dependencies);
  assert.equal(accepted.status, 202);
  assert.deepEqual(await accepted.json(), { ok: true, next: "/retractation/confirmation" });
  const cookie = accepted.headers.get("set-cookie") ?? "";
  assert.match(cookie, /^lnx-withdrawal-receipt=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Path=\/retractation\/confirmation/);
  assert.equal(calls.length, 1);
});

test("database design is anti-enumeration, duplicate safe and never triggers an automatic refund", () => {
  const service = readFileSync("lib/legal/withdrawal.ts", "utf8");
  const migration = readFileSync("prisma/migrations/20260828120000_legal_compliance_foundation/migration.sql", "utf8");
  assert.match(service, /identityMatch: "UNMATCHED"/);
  assert.match(service, /consumerWithdrawalRequest\.findUnique\(\{ where: \{ deduplicationHashSha256 \} \}\)/);
  assert.match(service, /publicReceiptTokenHash/);
  assert.match(service, /withdrawal:address/);
  assert.match(migration, /UNIQUE INDEX "consumer_withdrawal_requests_deduplicationHashSha256_key"/);
  assert.match(migration, /"refundStatus" "ConsumerWithdrawalRefundStatus" NOT NULL DEFAULT 'NOT_EVALUATED'/);
  assert.doesNotMatch(service, /refunds?\.create|stripe\.|paypal/i);
});

test("private receipt is noindex, no-store at API level and cannot be fetched by order number", () => {
  const confirmation = readFileSync("app/retractation/confirmation/page.tsx", "utf8");
  const route = readFileSync("lib/legal/withdrawal-route-handler.ts", "utf8");
  assert.match(confirmation, /robots: \{ index: false, follow: false \}/);
  assert.match(confirmation, /cookies\(\)/);
  assert.match(confirmation, /getWithdrawalReceipt\(token\)/);
  assert.doesNotMatch(confirmation, /searchParams|orderNumber/);
  assert.match(route, /cache-control.*no-store/i);
});

test("the member archive is ownership-scoped and exposes no receipt capability", () => {
  const service = readFileSync("lib/legal/withdrawal.ts", "utf8");
  const account = readFileSync("app/compte/page.tsx", "utf8");
  assert.match(service, /order: \{ userId \}/);
  assert.match(service, /shopOrder: \{ userId \}/);
  assert.match(service, /acknowledgementHashSha256: true/);
  assert.doesNotMatch(service.match(/export async function listMemberWithdrawalRequests[\s\S]*$/)?.[0] ?? "", /publicReceiptTokenHash: true|claimantEmail: true/);
  assert.match(account, /href="\/retractation"/);
  assert.match(account, /Accusé persistant archivé sous empreinte SHA-256/);
});
