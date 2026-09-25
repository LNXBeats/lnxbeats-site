import assert from "node:assert/strict";
import test from "node:test";

import type { OrderActor } from "@/lib/orders/domain";
import { adminOrderPhotoDownloadResponse, storedReferenceFilename } from "@/lib/orders/photo-download";
import { getOrderPhotoForActor } from "@/lib/orders/service";

const orderNumber = "LNX-2026-000001";
const otherOrderNumber = "LNX-2026-000002";
const assetId = "00000000-0000-4000-8000-000000000001";
const admin: OrderActor = {
  id: assetId, email: "admin@example.invalid", name: "Admin", role: "ADMIN", status: "ACTIVE", emailVerified: true,
};
const member: OrderActor = { ...admin, role: "MEMBER" };
const bytes = Buffer.from("synthetic private webp bytes");
const photo = {
  asset: { id: assetId, filename: "portrait original.jpg", type: "IMAGE", visibility: "PRIVATE", mimeType: "image/webp" },
  buffer: bytes,
} as unknown as NonNullable<Awaited<ReturnType<typeof getOrderPhotoForActor>>>;

test("Admin downloads the stored private WebP, not an optimized preview URL", async () => {
  let calls = 0;
  const response = await adminOrderPhotoDownloadResponse(admin, orderNumber, assetId, async (actor, number, id) => {
    calls += 1;
    assert.equal(actor.role, "ADMIN");
    assert.equal(number, orderNumber);
    assert.equal(id, assetId);
    return photo;
  });
  assert.equal(calls, 1);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/webp");
  assert.equal(response.headers.get("content-disposition"), 'attachment; filename="portrait original.webp"');
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
  assert.equal(response.headers.get("location"), null);
  assert.equal(await response.text(), bytes.toString());
  assert.doesNotMatch(JSON.stringify([...response.headers]), /secret|credential|access.key|signature/i);
});

test("anonymous, members and invalid identifiers cannot reach storage", async () => {
  let calls = 0;
  const load = async () => { calls += 1; return photo; };
  assert.equal((await adminOrderPhotoDownloadResponse(null, orderNumber, assetId, load)).status, 401);
  assert.equal((await adminOrderPhotoDownloadResponse(member, orderNumber, assetId, load)).status, 403);
  for (const [number, id] of [
    [orderNumber, "bad"],
    [orderNumber, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    [orderNumber, "../../secret"],
    ["../../secret", assetId],
  ]) {
    assert.equal((await adminOrderPhotoDownloadResponse(admin, number, id, load)).status, 404);
  }
  assert.equal(calls, 0);
});

test("unknown or cross-order media fail closed", async () => {
  const load = async (_actor: OrderActor, number: string, id: string) => number === orderNumber && id === assetId ? photo : null;
  assert.equal((await adminOrderPhotoDownloadResponse(admin, otherOrderNumber, assetId, load)).status, 404);
  assert.equal((await adminOrderPhotoDownloadResponse(admin, orderNumber, "00000000-0000-4000-8000-000000000002", load)).status, 404);
  assert.equal((await adminOrderPhotoDownloadResponse(admin, orderNumber, assetId, async () => ({
    ...photo, asset: { ...photo.asset, visibility: "PUBLIC" },
  } as typeof photo))).status, 404);
});

test("download filename is safe and reflects the stored WebP format", () => {
  assert.equal(storedReferenceFilename("../../photo.jpg", assetId), "photo.webp");
  assert.equal(storedReferenceFilename("..\\..\\photo.png", assetId), "photo.webp");
  const name = storedReferenceFilename('evil\r\nX-Test: yes".jpg', assetId);
  assert.doesNotMatch(name, /[\r\n]/);
  assert.match(name, /\.webp$/);
  assert.equal(storedReferenceFilename("...", assetId), `reference-${assetId}.webp`);
});
