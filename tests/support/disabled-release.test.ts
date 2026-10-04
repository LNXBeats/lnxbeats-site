import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { POST as checkout } from "@/app/api/support/checkout/route";
import { POST as session } from "@/app/api/support/session/route";
import { POST as capture } from "@/app/api/support/[id]/capture/route";
import { createSupportCheckout } from "@/lib/support/service";

test("closed support routes refuse before DB, rate-limit writes, session cookies or provider calls", async (t) => {
  const previous = process.env.SUPPORT_ENABLED;
  process.env.SUPPORT_ENABLED = "false";
  let dbCalls = 0, providerCalls = 0;
  const originalTransaction = prisma.$transaction;
  prisma.$transaction = (() => { dbCalls++; throw new Error("Unexpected database access"); }) as typeof prisma.$transaction;
  t.mock.method(globalThis, "fetch", () => { providerCalls++; throw new Error("Unexpected provider access"); });
  const request = (path: string) => new NextRequest(`https://preview.example.test${path}`, {
    method: "POST", headers: { origin: "https://preview.example.test", "content-type": "application/json" },
    body: JSON.stringify({ provider: "STRIPE", amountCents: 500, idempotencyKey: "170a3b22-c762-4f48-8739-f94068165ceb" }),
  });
  try {
    for (const response of [await checkout(request("/api/support/checkout")), await session(request("/api/support/session")),
      await capture(request("/api/support/170a3b22-c762-4f48-8739-f94068165ceb/capture"), { params: Promise.resolve({ id: "170a3b22-c762-4f48-8739-f94068165ceb" }) })]) {
      assert.equal(response.status, 503);
      assert.equal(response.headers.get("set-cookie"), null);
      assert.equal(response.headers.get("cache-control"), "private, no-store");
    }
    await assert.rejects(createSupportCheckout({ provider: "STRIPE", amountCents: 500,
      idempotencyKey: "170a3b22-c762-4f48-8739-f94068165ceb", ownerToken: "a".repeat(64) }, {
      createCheckout: async () => { providerCalls++; throw new Error("Unexpected checkout"); },
      capture: async () => { providerCalls++; throw new Error("Unexpected capture"); },
    }), { code: "DISABLED" });
    assert.equal(dbCalls, 0);
    assert.equal(providerCalls, 0);
  } finally {
    prisma.$transaction = originalTransaction;
    if (previous === undefined) delete process.env.SUPPORT_ENABLED; else process.env.SUPPORT_ENABLED = previous;
  }
});
