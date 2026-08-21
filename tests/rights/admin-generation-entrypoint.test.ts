import assert from "node:assert/strict";
import test from "node:test";

import type { OrderActor } from "@/lib/orders/domain";
import { handleAdminRightsDocumentGeneration } from "@/lib/rights/admin-generation-entrypoint";
import { RightsServiceError } from "@/lib/rights/service";

const requestNumber = "LNX-LIC-2026-000001";
const admin: OrderActor = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "admin@example.invalid",
  name: "Admin QA",
  role: "ADMIN",
  status: "ACTIVE",
  emailVerified: true,
};

class RedirectSignal extends Error {
  constructor(readonly location: string) {
    super(`Redirect: ${location}`);
  }
}

function form(version = "1") {
  const data = new FormData();
  data.set("requestNumber", requestNumber);
  data.set("kind", "CONTRACT");
  data.set("expectedDocumentVersion", version);
  return data;
}

function harness(generate: Parameters<typeof handleAdminRightsDocumentGeneration>[1]["generate"]) {
  const refreshes: string[] = [];
  const diagnostics: unknown[] = [];
  let notificationDispatches = 0;
  const dependencies: Parameters<typeof handleAdminRightsDocumentGeneration>[1] = {
    authenticateAdmin: async () => admin,
    generate,
    refresh(value) { refreshes.push(value); },
    dispatchNotifications() { notificationDispatches += 1; },
    redirect(location): never { throw new RedirectSignal(location); },
    logUnexpectedFailure(diagnostic) { diagnostics.push(diagnostic); },
  };
  return {
    dependencies,
    refreshes,
    diagnostics,
    get notificationDispatches() { return notificationDispatches; },
  };
}

async function redirectFrom(operation: Promise<never>) {
  try {
    await operation;
    assert.fail("The entrypoint must terminate through a redirect.");
  } catch (error) {
    assert.ok(error instanceof RedirectSignal);
    return error;
  }
}

test("the shared Admin entrypoint parses Safari FormData and redirects a DRAFT success", async () => {
  const calls: unknown[][] = [];
  const state = harness(async (...values) => {
    calls.push(values);
    return { requestNumber, documentVersion: 1, documentStatus: "DRAFT", duplicate: false, legalTemplateApproved: false };
  });
  const error = await redirectFrom(handleAdminRightsDocumentGeneration(form(), state.dependencies));
  assert.equal(error.location, `/admin/droits/${requestNumber}?etat=projet-draft-genere`);
  assert.deepEqual(calls, [[admin, requestNumber, "CONTRACT", 1]]);
  assert.deepEqual(state.refreshes, [requestNumber]);
  assert.equal(state.notificationDispatches, 0);
  assert.deepEqual(state.diagnostics, []);
});

test("double submit reaches the same shared entrypoint and preserves service idempotence", async () => {
  let created = false;
  const state = harness(async () => {
    const duplicate = created;
    created = true;
    return { requestNumber, documentVersion: 1, documentStatus: "DRAFT", duplicate, legalTemplateApproved: false };
  });
  const results = await Promise.all([
    redirectFrom(handleAdminRightsDocumentGeneration(form(), state.dependencies)),
    redirectFrom(handleAdminRightsDocumentGeneration(form(), state.dependencies)),
  ]);
  assert.ok(results.every((result) => result.location.endsWith("?etat=projet-draft-genere")));
  assert.deepEqual(state.refreshes, [requestNumber, requestNumber]);
});

test("a stale expectedVersion produces the explicit reload state", async () => {
  const state = harness(async () => {
    throw new RightsServiceError("La page n’est plus à jour.", 409, "CONTRACT_VERSION_CHANGED");
  });
  const error = await redirectFrom(handleAdminRightsDocumentGeneration(form("3"), state.dependencies));
  assert.equal(error.location, `/admin/droits/${requestNumber}?etat=generation-page-obsolete`);
  assert.deepEqual(state.refreshes, []);
  assert.deepEqual(state.diagnostics, []);
});

test("an unexpected PDF error is bounded and a later retry can succeed", async () => {
  let attempt = 0;
  const state = harness(async () => {
    attempt += 1;
    if (attempt === 1) {
      throw Object.assign(new Error("ENOENT: open '/ROOT/node_modules/pdfkit/js/data/Helvetica.afm'"), { code: "ENOENT" });
    }
    return { requestNumber, documentVersion: 1, documentStatus: "DRAFT", duplicate: false, legalTemplateApproved: false };
  });
  const first = await redirectFrom(handleAdminRightsDocumentGeneration(form(), state.dependencies));
  assert.equal(first.location, `/admin/droits/${requestNumber}?etat=generation-indisponible`);
  assert.deepEqual(state.diagnostics, [{
    category: "document-generation",
    code: "PDFKIT_STANDARD_FONT_MISSING",
    exception: "Error",
    phase: "PDF_RENDER",
    message: "PDFKit standard font resource is unavailable.",
  }]);

  const second = await redirectFrom(handleAdminRightsDocumentGeneration(form(), state.dependencies));
  assert.equal(second.location, `/admin/droits/${requestNumber}?etat=projet-draft-genere`);
  assert.deepEqual(state.refreshes, [requestNumber]);
});

test("invalid expectedVersion is rejected before authentication or generation", async () => {
  let generated = false;
  const state = harness(async () => {
    generated = true;
    throw new Error("unreachable");
  });
  const error = await redirectFrom(handleAdminRightsDocumentGeneration(form("0"), state.dependencies));
  assert.equal(error.location, `/admin/droits/${requestNumber}?etat=generation-version-invalide`);
  assert.equal(generated, false);
});
