import assert from "node:assert/strict";
import { inspect } from "node:util";
import test from "node:test";

import { rightsErrorResponse, rightsFailureDiagnostic } from "@/lib/rights/http";

test("unexpected rights failures log only a bounded technical diagnostic", async () => {
  const sentinel = "PRIVATE_KEY_AND_DATABASE_DETAIL_MUST_NOT_LEAK";
  const error = Object.assign(new Error(sentinel), { name: "PrismaClientKnownRequestError", code: "P2028", meta: { secret: sentinel } });
  assert.deepEqual(rightsFailureDiagnostic(error), { category: "database", code: "P2028", exception: "PrismaClientKnownRequestError" });
  const calls: unknown[][] = [];
  const original = console.error;
  console.error = (...values: unknown[]) => { calls.push(values); };
  try {
    const response = rightsErrorResponse(error);
    assert.equal(response.status, 500);
    assert.deepEqual(await response.json(), { error: "La demande de droits ne peut pas être traitée.", code: "RIGHTS_REQUEST_FAILED" });
  } finally {
    console.error = original;
  }
  assert.equal(calls.length, 1);
  assert.doesNotMatch(inspect(calls), new RegExp(sentinel));
  assert.match(inspect(calls), /rights\.request\.failed/);
  assert.match(inspect(calls), /P2028/);
});

test("private storage diagnostics expose no object key or provider payload", () => {
  const sentinel = "orders/private/object-key.pdf";
  const error = Object.assign(new Error(sentinel), { name: "MediaStorageError", code: "PROVIDER", providerPayload: sentinel });
  const diagnostic = rightsFailureDiagnostic(error);
  assert.deepEqual(diagnostic, { category: "private-storage", code: "PROVIDER", exception: "MediaStorageError" });
  assert.doesNotMatch(inspect(diagnostic), /orders\/private/);
});

test("PDF diagnostics distinguish a malformed section without logging its content", () => {
  const sentinel = "PRIVATE_CONTRACT_TEXT_MUST_NOT_LEAK";
  const error = new TypeError("PDF paragraphs are invalid.");
  Object.assign(error, { privateContent: sentinel });
  const diagnostic = rightsFailureDiagnostic(error);
  assert.deepEqual(diagnostic, { category: "document-generation", code: "PDF_PARAGRAPHS_INVALID", exception: "TypeError", phase: "PDF_INPUT" });
  assert.doesNotMatch(inspect(diagnostic), new RegExp(sentinel));
});

test("PDFKit missing AFM diagnostics expose a stable phase without logging a local path", () => {
  const sentinel = "/PRIVATE/USER/PATH/node_modules/pdfkit/js/data/Helvetica.afm";
  const error = Object.assign(new Error(`ENOENT: no such file or directory, open '${sentinel}'`), { code: "ENOENT" });
  const diagnostic = rightsFailureDiagnostic(error);
  assert.deepEqual(diagnostic, {
    category: "document-generation",
    code: "PDFKIT_STANDARD_FONT_MISSING",
    exception: "Error",
    phase: "PDF_RENDER",
    message: "PDFKit standard font resource is unavailable.",
  });
  assert.doesNotMatch(inspect(diagnostic), /PRIVATE|Helvetica\.afm/);
});
