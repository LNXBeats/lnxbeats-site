import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import type { OrderDeliveryUpload } from "@/lib/orders/audio-request";
import { validateDeliveryFileSelection } from "@/lib/orders/delivery-file-selection";
import {
  canDownloadOrderDelivery,
  orderAcceptsDeliveryUpload,
  OrderDeliveryError,
  putOrderDelivery,
  removeOrderDelivery,
  type OrderDeliveryDependencies,
  type OrderDeliveryRemovalDependencies,
} from "@/lib/orders/delivery";
import {
  handleAdminDeliveryDelete,
  handleAdminDeliveryUpload,
  handleOrderDeliveryDownload,
} from "@/lib/orders/delivery-route-handler";
import type { OrderActor } from "@/lib/orders/domain";

const admin: OrderActor = {
  id: "00000000-0000-4000-8000-000000000001",
  email: "admin@example.invalid",
  name: "Admin",
  role: "ADMIN",
  status: "ACTIVE",
  emailVerified: true,
};
const member: OrderActor = { ...admin, id: "00000000-0000-4000-8000-000000000002", role: "MEMBER" };
const source: OrderDeliveryUpload = {
  path: "/private/tmp/not-read-by-unit-test",
  originalFilename: "master-final.wav",
  assetType: "AUDIO",
  mimeType: "audio/wav",
  extension: "wav",
  sizeBytes: 1_024,
  durationMs: 12_000,
  width: null,
  height: null,
  checksumSha256: "a".repeat(64),
  cleanup: async () => undefined,
};
const orderId = "00000000-0000-4000-8000-000000000010";

test("la sélection UI accepte tous les formats de livraison et refuse type ou taille invalides", () => {
  assert.deepEqual(
    validateDeliveryFileSelection({ name: "master.mp3", type: "audio/mpeg", size: 1_024 }),
    { ok: true, format: "MP3" },
  );
  assert.deepEqual(
    validateDeliveryFileSelection({ name: "master.wav", type: "audio/wav", size: 2_048 }),
    { ok: true, format: "WAV" },
  );
  assert.deepEqual(
    validateDeliveryFileSelection({ name: "master.wav", type: "", size: 2_048 }),
    { ok: true, format: "WAV" },
    "Safari peut laisser File.type vide; le serveur reste l’autorité sur le contenu réel.",
  );
  for (const [name, type] of [["master.flac", "audio/flac"], ["sources.zip", "application/zip"], ["notes.pdf", "application/pdf"], ["cover.jpg", "image/jpeg"], ["cover.png", "image/png"]]) {
    assert.equal(validateDeliveryFileSelection({ name, type, size: 2_048 }).ok, true);
  }
  assert.equal(validateDeliveryFileSelection({ name: "script.js", type: "text/javascript", size: 2_048 }).ok, false);
  assert.equal(validateDeliveryFileSelection({ name: "master.mp3", type: "audio/wav", size: 2_048 }).ok, false);
  assert.equal(validateDeliveryFileSelection({ name: "master.wav", type: "audio/wav", size: 200 * 1024 * 1024 + 1 }).ok, false);
});

function dependencies(overrides: Partial<OrderDeliveryDependencies> = {}) {
  const deleted: string[] = [];
  const value: OrderDeliveryDependencies = {
    validateStorage: () => ({ backend: "OBJECT", provider: "r2" }),
    prepareOrder: async () => ({ id: orderId }),
    write: async ({ storageKey }) => ({
      storageKey,
      storageBackend: "OBJECT",
      storageProvider: "r2",
      visibility: "PRIVATE",
      checksumSha256: source.checksumSha256,
    }),
    persist: async () => ({
      delivery: {
        id: "00000000-0000-4000-8000-000000000020",
        type: source.assetType,
        filename: source.originalFilename,
        mimeType: source.mimeType,
        sizeBytes: BigInt(source.sizeBytes),
        durationMs: source.durationMs,
        width: source.width,
        height: source.height,
        createdAt: new Date("2026-08-14T00:00:00Z"),
      },
    }),
    delete: async (reference) => { deleted.push(reference.storageKey); },
    ...overrides,
  };
  return { value, deleted };
}

test("seul l’ADMIN peut orchestrer une livraison sur une commande payée", async () => {
  assert.equal(orderAcceptsDeliveryUpload("PAYMENT_CONFIRMED", true), true);
  assert.equal(orderAcceptsDeliveryUpload("PAYMENT_CONFIRMED", false), false);
  assert.equal(orderAcceptsDeliveryUpload("AWAITING_PAYMENT", true), false);
  let prepared = false;
  const deps = dependencies({ prepareOrder: async () => { prepared = true; return { id: orderId }; } });
  await assert.rejects(
    putOrderDelivery(member, "LNX-2026-000001", source, deps.value),
    (error: unknown) => error instanceof OrderDeliveryError && error.code === "ADMIN_REQUIRED" && error.status === 403,
  );
  assert.equal(prepared, false);
});

test("l’upload ADMIN exige R2 PRIVATE et une clé opaque de livraison", async () => {
  let observedKey = "";
  const deps = dependencies({
    write: async ({ storageKey }) => {
      observedKey = storageKey;
      return {
        storageKey,
        storageBackend: "OBJECT",
        storageProvider: "r2",
        visibility: "PRIVATE",
        checksumSha256: source.checksumSha256,
      };
    },
  });
  const delivery = await putOrderDelivery(admin, "LNX-2026-000001", source, deps.value);
  assert.equal(delivery.filename, "master-final.wav");
  assert.match(observedKey, new RegExp(`^orders/${orderId}/deliveries/[0-9a-f-]{36}\\.wav$`, "i"));
  assert.doesNotMatch(observedKey, /master|admin|email/i);
  assert.deepEqual(deps.deleted, []);
});

test("un backend non R2 ou un objet non privé est refusé et compensé", async () => {
  const wrongConfiguration = dependencies({ validateStorage: () => ({ backend: "LOCAL", provider: "local" }) });
  await assert.rejects(
    putOrderDelivery(admin, "LNX-2026-000001", source, wrongConfiguration.value),
    (error: unknown) => error instanceof OrderDeliveryError && error.code === "DELIVERY_STORAGE_UNAVAILABLE",
  );

  const wrongVisibility = dependencies({
    write: async ({ storageKey }) => ({
      storageKey,
      storageBackend: "OBJECT",
      storageProvider: "r2",
      visibility: "PUBLIC",
      checksumSha256: source.checksumSha256,
    }),
  });
  await assert.rejects(putOrderDelivery(admin, "LNX-2026-000001", source, wrongVisibility.value));
  assert.equal(wrongVisibility.deleted.length, 1);
});

test("un nouvel upload s’ajoute sans retirer les précédents et compense un échec DB", async () => {
  const appended = dependencies({
    persist: async () => ({
      delivery: {
        id: "00000000-0000-4000-8000-000000000040",
        type: source.assetType,
        filename: source.originalFilename,
        mimeType: source.mimeType,
        sizeBytes: BigInt(source.sizeBytes),
        durationMs: source.durationMs,
        width: source.width,
        height: source.height,
        createdAt: new Date(0),
      },
    }),
  });
  await putOrderDelivery(admin, "LNX-2026-000001", source, appended.value);
  assert.deepEqual(appended.deleted, []);

  const failed = dependencies({ persist: async () => { throw new Error("database failure"); } });
  await assert.rejects(putOrderDelivery(admin, "LNX-2026-000001", source, failed.value), /database failure/);
  assert.equal(failed.deleted.length, 1);
  assert.match(failed.deleted[0]!, /\/deliveries\/[0-9a-f-]{36}\.wav$/i);
});

test("un ADMIN peut retirer un livrable avant publication, jamais via un profil MEMBER", async () => {
  const deleted: string[] = [];
  const removal: OrderDeliveryRemovalDependencies = {
    detach: async () => ({ storageKey: `orders/${orderId}/deliveries/00000000-0000-4000-8000-000000000020.wav`, storageBackend: "OBJECT", storageProvider: "r2", visibility: "PRIVATE" }),
    delete: async (reference) => { deleted.push(reference.storageKey); },
  };
  await assert.rejects(removeOrderDelivery(member, "LNX-2026-000001", "00000000-0000-4000-8000-000000000020", removal), (error: unknown) => error instanceof OrderDeliveryError && error.code === "ADMIN_REQUIRED");
  await removeOrderDelivery(admin, "LNX-2026-000001", "00000000-0000-4000-8000-000000000020", removal);
  assert.equal(deleted.length, 1);
});

test("propriétaire et ADMIN lisent une livraison publiée; autre membre et expiration sont refusés", () => {
  const now = new Date("2026-08-14T12:00:00Z");
  const order = { userId: member.id, status: "DELIVERED", downloadExpiresAt: new Date("2027-02-14T00:00:00Z") };
  assert.equal(canDownloadOrderDelivery(member, order, now), true);
  assert.equal(canDownloadOrderDelivery(admin, { ...order, userId: "another", status: "FINALIZING", downloadExpiresAt: null }, now), true);
  assert.equal(canDownloadOrderDelivery({ ...member, id: "another" }, order, now), false);
  assert.equal(canDownloadOrderDelivery(member, { ...order, downloadExpiresAt: new Date("2026-08-14T11:59:59Z") }, now), false);
  assert.equal(canDownloadOrderDelivery(member, { ...order, status: "FINALIZING" }, now), false);
});

test("les handlers refusent anonyme/MEMBER à l’upload et masquent l’IDOR au téléchargement", async () => {
  const uploadRequest = new Request("http://localhost/upload", { method: "POST" });
  let readCalls = 0;
  const memberUpload = await handleAdminDeliveryUpload(uploadRequest, "LNX-2026-000001", {
    isAllowed: () => true,
    actor: async () => member,
    rateLimit: async () => undefined,
    read: async () => { readCalls += 1; return source; },
    put: async () => { throw new Error("must not run"); },
  });
  assert.equal(memberUpload.status, 403);
  assert.equal(readCalls, 0);

  const assetId = "00000000-0000-4000-8000-000000000020";
  const anonymous = await handleOrderDeliveryDownload(new Request("http://localhost/file"), { orderNumber: "LNX-2026-000001", assetId }, {
    actor: async () => null,
    get: async () => null,
    respond: async () => new Response(),
  });
  assert.equal(anonymous.status, 401);
  const idor = await handleOrderDeliveryDownload(new Request("http://localhost/file"), { orderNumber: "LNX-2026-000001", assetId }, {
    actor: async () => ({ ...member, id: "another" }),
    get: async () => null,
    respond: async () => new Response(),
  });
  assert.equal(idor.status, 404);

  let removeCalls = 0;
  const deniedDelete = await handleAdminDeliveryDelete(new Request("http://localhost/delete", { method: "DELETE" }), { orderNumber: "LNX-2026-000001", assetId }, {
    isAllowed: () => true,
    actor: async () => member,
    rateLimit: async () => undefined,
    remove: async () => { removeCalls += 1; },
  });
  assert.equal(deniedDelete.status, 403);
  assert.equal(removeCalls, 0);
});

test("la migration multi-livrables ne supprime aucune donnée et protège les positions", async () => {
  const sql = await readFile("prisma/migrations/20260822120000_multiple_order_deliveries/migration.sql", "utf8");
  assert.match(sql, /DROP INDEX IF EXISTS "order_assets_one_delivery_per_order"/);
  assert.match(sql, /CREATE UNIQUE INDEX "order_assets_delivery_position_unique"[\s\S]*\("orderId", "position"\)[\s\S]*WHERE "role" = 'DELIVERY'/);
  assert.doesNotMatch(sql, /\b(?:DROP\s+(?:TABLE|COLUMN)|TRUNCATE|DELETE\s+FROM|UPDATE\s+"orders")\b/i);
});

test("Compte et Admin exposent le workflow livraison sans réintroduire un upload audio client", async () => {
  const [account, adminPage, adminPanel, adminActions, adminCss, commander] = await Promise.all([
    readFile("app/compte/commandes/[orderNumber]/page.tsx", "utf8"),
    readFile("app/admin/commandes/[orderNumber]/page.tsx", "utf8"),
    readFile("components/admin-order-delivery-panel.tsx", "utf8"),
    readFile("components/admin-order-actions.tsx", "utf8"),
    readFile("app/admin/admin.css", "utf8"),
    readFile("components/music-order-form.tsx", "utf8"),
  ]);
  assert.match(account, /Votre création est en cours/);
  assert.match(account, /Votre création est prête/);
  assert.match(account, /order\.deliveries\.map/);
  assert.match(adminPage, /AdminOrderDeliveryPanel/);
  assert.match(adminPanel, /MP3, WAV, FLAC, ZIP, PDF, JPEG ou PNG/);
  assert.match(adminPanel, /\?lecture=1/);
  assert.match(adminPanel, /<label className="admin-delivery-picker" htmlFor=\{inputId\}/);
  assert.match(adminPanel, /className="admin-delivery-picker__input"[\s\S]*type="file"[\s\S]*aria-describedby=\{helpId\}/);
  assert.match(adminPanel, /disabled=\{!file \|\| selection\?\.ok !== true \|\| busy \|\| removingId !== null\}/);
  assert.match(adminPanel, /Nom[\s\S]*Format[\s\S]*Taille/);
  const fileInputRule = adminCss.match(/\.admin-delivery-picker__input\s*\{([\s\S]*?)\}/)?.[1] ?? "";
  assert.match(fileInputRule, /position:\s*absolute/);
  assert.match(fileInputRule, /inset:\s*0/);
  assert.match(fileInputRule, /pointer-events:\s*auto/);
  assert.doesNotMatch(fileInputRule, /display:\s*none|visibility:\s*hidden|pointer-events:\s*none/);
  assert.match(adminCss, /\.admin-delivery-picker:focus-within/);
  assert.match(adminPage, /to !== "DELIVERED" \|\| deliveries\.length > 0/);
  assert.match(adminActions, /emptyReason/);
  assert.doesNotMatch(commander, /accept=[^>]*(?:audio|\.mp3|\.wav)|references\/audio/i);
});
