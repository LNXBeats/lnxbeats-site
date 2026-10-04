// Child of the local-only runtime harness. Exits between provider success and
// persistence to reproduce an actual process loss; never runs on a cloud host.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";
import { createSupportCheckout } from "@/lib/support/service";
assert.equal(assertSafeLocalPostgresUrl(process.env.DATABASE_URL ?? "").pathname, "/lnx_vfinal_support_test");
assert.equal(process.env.SUPPORT_CRASH_QA, "local-only");
await createSupportCheckout(JSON.parse(process.env.SUPPORT_CRASH_INPUT!), {
  async createCheckout(value) {
    writeFileSync(process.env.SUPPORT_CRASH_RESULT!, JSON.stringify({ id: value.id, checkout: { id: `qa_crash_${value.id}`, url: `https://checkout.stripe.com/c/test_${value.id}` } }), { mode: 0o600 });
    process.kill(process.pid, "SIGKILL");
    throw new Error("unreachable");
  }, async capture() { throw new Error("forbidden"); },
});
