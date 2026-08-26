import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import sharp from "sharp";

import { createInternalAuthUser } from "@/lib/auth/internal-user";
import { deleteCatalogAudioPreview } from "@/lib/catalog/audio";
import { deleteCatalogCover } from "@/lib/catalog/cover";
import { createCatalogProject, deleteCatalogProject, updateCatalogProject } from "@/lib/catalog/service";
import { assertR2StagingRuntimeEnvironment } from "@/lib/media/r2-staging-runtime-guard";
import { deleteMediaObject, headMediaObject } from "@/lib/media/storage";
import { MediaStorageError, type MediaStorageReference } from "@/lib/media/storage/types";
import type { OrderActor, OrderDraftInput } from "@/lib/orders/domain";
import { createDraftOrder, deleteDraftOrder } from "@/lib/orders/service";
import { prisma } from "@/lib/prisma";
import { createAudioFixture } from "@/tests/audio/fixture";

const QA_EMAILS = {
  admin: "lnx-v0631-r2-admin@example.invalid",
  owner: "lnx-v0631-r2-owner@example.invalid",
  other: "lnx-v0631-r2-other@example.invalid",
} as const;
const QA_SLUG = "qa-r2-staging-runtime";
const QA_ORDER_TITLE_PREFIX = "QA R2 staging runtime";
const HTTP_TIMEOUT_MS = 180_000;

type Reference = Pick<MediaStorageReference, "storageKey" | "storageBackend" | "storageProvider" | "visibility">;
const trackedReferences = new Map<string, Reference>();

function remember(reference: Reference) {
  trackedReferences.set(`${reference.visibility}:${reference.storageKey}`, reference);
  return reference;
}

function actor(user: { id: string; email: string; displayName: string | null; role: "ADMIN" | "MEMBER" | "CUSTOMER" }): OrderActor {
  return {
    id: user.id,
    email: user.email,
    name: user.displayName ?? "R2 QA",
    role: user.role,
    status: "ACTIVE",
    emailVerified: true,
  };
}

const orderInput: OrderDraftInput = {
  title: `${QA_ORDER_TITLE_PREFIX} owner`,
  recipient: "Fixture jetable",
  occasion: "Validation R2 staging",
  brief: "Histoire strictement fictive réservée au contrôle du stockage privé R2 staging.",
  musicalDirection: "QA",
  emotion: "QA",
  importantDetails: "Aucune donnée personnelle.",
  wordsToInclude: "",
  avoid: "",
  pronunciationNotes: "",
  illustrationFormat: null,
  illustrationFormatCustom: "",
  coverIncluded: false,
  priorityProcessing: false,
};

async function validateRuntimeProof(configuration: ReturnType<typeof assertR2StagingRuntimeEnvironment>) {
  const proof = JSON.parse(await readFile(configuration.proofPath, "utf8")) as {
    name?: string;
    pid?: number;
    exports?: { database?: { connectionString?: string } };
  };
  assert.equal(proof.name, configuration.databaseTarget, "The Prisma runtime proof must name the disposable test database.");
  assert.ok(proof.pid && proof.pid > 0, "The isolated Prisma runtime proof must contain a live process identifier.");
  try { process.kill(proof.pid, 0); }
  catch { throw new Error("The isolated Prisma runtime process is not active."); }
  assert.equal(proof.exports?.database?.connectionString, process.env.DATABASE_URL, "The Prisma runtime proof must match DATABASE_URL.");
}

function sessionCookie(response: Response) {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const values = headers.getSetCookie?.() ?? [headers.get("set-cookie") ?? ""];
  const raw = values.find((value) => /^(?:__Secure-)?lnx-studio\.session_token=/.test(value));
  assert.ok(raw, "The real sign-in endpoint must issue its session cookie.");
  return raw.split(";", 1)[0];
}

async function http(input: string, init: RequestInit = {}) {
  return fetch(input, { redirect: "manual", ...init, signal: init.signal ?? AbortSignal.timeout(HTTP_TIMEOUT_MS) });
}

async function login(baseUrl: string, email: string, password: string) {
  const response = await http(`${baseUrl}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: baseUrl },
    body: JSON.stringify({ email, password, rememberMe: true }),
  });
  assert.equal(response.status, 200, "The isolated QA account must authenticate through the real endpoint.");
  return sessionCookie(response);
}

async function assertQaServer(baseUrl: string) {
  const response = await http(`${baseUrl}/api/health`);
  assert.equal(response.status, 200, "The isolated QA server health endpoint must be ready.");
  const payload = await response.json() as { ok?: boolean; mediaStorage?: { backend?: string; provider?: string } };
  assert.equal(payload.ok, true);
  assert.deepEqual(payload.mediaStorage, { backend: "OBJECT", provider: "r2" });
}

function coverForm(project: { id: string; slug: string }, expectedCoverAssetId: string | null, file: File) {
  const body = new FormData();
  body.set("projectId", project.id);
  body.set("slug", project.slug);
  body.set("expectedCoverAssetId", expectedCoverAssetId ?? "");
  body.set("rightsConfirmed", "on");
  body.set("cover", file, file.name);
  return body;
}

async function uploadCover(baseUrl: string, cookie: string, project: { id: string; slug: string }, expectedCoverAssetId: string | null, file: File) {
  return http(`${baseUrl}/api/admin/catalogue/cover`, {
    method: "POST",
    headers: {
      origin: baseUrl,
      referer: `${baseUrl}/admin/catalogue/${project.slug}`,
      cookie,
      accept: "application/json",
      "x-lnx-cover-upload": "browser",
    },
    body: coverForm(project, expectedCoverAssetId, file),
  });
}

function audioForm(project: { id: string; slug: string }, file: File) {
  const body = new FormData();
  body.set("projectId", project.id);
  body.set("slug", project.slug);
  body.set("expectedAudioAssetId", "");
  body.set("rightsConfirmed", "on");
  body.set("offsetMs", "0");
  body.set("requestedDurationMs", "60000");
  body.set("audio", file, file.name);
  return body;
}

async function uploadAudio(baseUrl: string, cookie: string, project: { id: string; slug: string }, file: File) {
  return http(`${baseUrl}/api/admin/catalogue/audio`, {
    method: "POST",
    headers: {
      origin: baseUrl,
      referer: `${baseUrl}/admin/catalogue/${project.slug}`,
      cookie,
      accept: "application/json",
      "x-lnx-audio-upload": "browser",
    },
    body: audioForm(project, file),
  });
}

async function deleteAudio(baseUrl: string, cookie: string, project: { id: string; slug: string }, assetId: string) {
  return http(`${baseUrl}/api/admin/catalogue/audio`, {
    method: "DELETE",
    headers: { origin: baseUrl, cookie, accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ projectId: project.id, slug: project.slug, expectedAudioAssetId: assetId }),
  });
}

function orderPhotoForm(file: File) {
  const body = new FormData();
  body.set("rightsConfirmed", "true");
  body.append("files", file, file.name);
  return body;
}

async function expectObjectMissing(reference: Reference) {
  try {
    await headMediaObject(reference);
  } catch (error) {
    if (error instanceof MediaStorageError && error.code === "NOT_FOUND") return;
    throw error;
  }
  throw new Error("A staging object remains after its cleanup assertion.");
}

async function deleteRememberedObjects() {
  const failures: unknown[] = [];
  const deletable: Array<{ reference: Reference; assetId: string | null }> = [];
  for (const reference of trackedReferences.values()) {
    const asset = await prisma.asset.findFirst({
      where: { storageKey: reference.storageKey },
      select: { id: true, _count: { select: { projects: true, orders: true } } },
    });
    if (!asset || (asset._count.projects === 0 && asset._count.orders === 0)) {
      deletable.push({ reference, assetId: asset?.id ?? null });
    }
  }
  for (const { reference, assetId } of deletable) {
    let removed = false;
    for (let attempt = 0; attempt < 3 && !removed; attempt += 1) {
      try {
        await deleteMediaObject(reference);
        await expectObjectMissing(reference);
        removed = true;
      } catch (error) {
        if (error instanceof MediaStorageError && error.code === "NOT_FOUND") removed = true;
        else if (attempt === 2) failures.push(error);
        else await new Promise((resolve) => setTimeout(resolve, 250));
      }
    }
    if (removed && assetId) {
      await prisma.asset.deleteMany({
        where: { id: assetId, projects: { none: {} }, orders: { none: {} } },
      });
    }
  }
  if (!failures.length) trackedReferences.clear();
  if (failures.length) throw new AggregateError(failures, "One or more R2 staging objects could not be cleaned up.");
}

async function cleanupQaData() {
  const emails = Object.values(QA_EMAILS);
  const project = await prisma.project.findUnique({
    where: { slug: QA_SLUG },
    include: { assets: { include: { asset: true } } },
  });
  project?.assets.forEach(({ asset }) => remember(asset));

  const orders = await prisma.order.findMany({
    where: { OR: [{ title: { startsWith: QA_ORDER_TITLE_PREFIX } }, { account: { email: { in: emails } } }] },
    include: { assets: { include: { asset: true } } },
  });
  orders.flatMap(({ assets }) => assets).forEach(({ asset }) => remember(asset));

  if (project) {
    try {
      const result = await deleteCatalogProject(project.id, project.slug);
      if (result.cleanupFailed) console.error("A catalogue QA asset requires the guarded cleanup retry.");
    }
    catch {
      await prisma.$transaction(async (transaction) => {
        const assetIds = project.assets.map(({ assetId }) => assetId);
        await transaction.projectAsset.deleteMany({ where: { projectId: project.id } });
        await transaction.project.deleteMany({ where: { id: project.id } });
        if (assetIds.length) await transaction.asset.deleteMany({ where: { id: { in: assetIds }, projects: { none: {} }, orders: { none: {} } } });
      });
    }
  }

  for (const order of orders) {
    await prisma.$transaction(async (transaction) => {
      const assetIds = order.assets.map(({ assetId }) => assetId);
      await transaction.orderAsset.deleteMany({ where: { orderId: order.id } });
      await transaction.commercialLicense.deleteMany({ where: { orderId: order.id } });
      await transaction.orderEvent.deleteMany({ where: { orderId: order.id } });
      await transaction.order.deleteMany({ where: { id: order.id } });
      if (assetIds.length) await transaction.asset.deleteMany({ where: { id: { in: assetIds }, projects: { none: {} }, orders: { none: {} } } });
    });
  }

  const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true } });
  await prisma.$transaction(async (transaction) => {
    if (users.length) {
      await transaction.rateLimit.deleteMany({ where: { OR: users.map(({ id }) => ({ key: { endsWith: id } })) } });
    }
    await transaction.session.deleteMany({ where: { user: { email: { in: emails } } } });
    await transaction.account.deleteMany({ where: { user: { email: { in: emails } } } });
    await transaction.customer.deleteMany({ where: { email: { in: emails } } });
    await transaction.verification.deleteMany({ where: { identifier: { in: emails } } });
    await transaction.registrationAttempt.deleteMany({ where: { email: { in: emails } } });
    await transaction.user.deleteMany({ where: { email: { in: emails } } });
  });
  await deleteRememberedObjects();
}

async function activeProjectAsset(projectId: string, role: "COVER" | "AUDIO_PREVIEW") {
  return prisma.asset.findFirstOrThrow({ where: { projects: { some: { projectId, role } } } });
}

function assertR2Asset(asset: Reference & { storageKey: string }, visibility: "PUBLIC" | "PRIVATE") {
  assert.equal(asset.storageBackend, "OBJECT");
  assert.equal(asset.storageProvider, "r2");
  assert.equal(asset.visibility, visibility);
  remember(asset);
}

async function run() {
  const configuration = assertR2StagingRuntimeEnvironment(process.env);
  await validateRuntimeProof(configuration);
  await assertQaServer(configuration.baseUrl);
  await cleanupQaData();

  const users = await Promise.all([
    createInternalAuthUser({ email: QA_EMAILS.admin, password: configuration.password, displayName: "R2 Staging Admin QA", role: "ADMIN" }),
    createInternalAuthUser({ email: QA_EMAILS.owner, password: configuration.password, displayName: "R2 Staging Owner QA", role: "MEMBER" }),
    createInternalAuthUser({ email: QA_EMAILS.other, password: configuration.password, displayName: "R2 Staging Other QA", role: "MEMBER" }),
  ]);
  const owner = actor(users[1]!);
  const other = actor(users[2]!);
  let project: Awaited<ReturnType<typeof createCatalogProject>> | null = null;
  let ownerOrder: Awaited<ReturnType<typeof createDraftOrder>> | null = null;
  let otherOrder: Awaited<ReturnType<typeof createDraftOrder>> | null = null;

  try {
    const [adminCookie, ownerCookie, otherCookie] = await Promise.all([
      login(configuration.baseUrl, QA_EMAILS.admin, configuration.password),
      login(configuration.baseUrl, QA_EMAILS.owner, configuration.password),
      login(configuration.baseUrl, QA_EMAILS.other, configuration.password),
    ]);
    project = await createCatalogProject({
      title: "QA R2 Staging Runtime",
      slug: QA_SLUG,
      type: "project",
      status: "draft",
      publicVisible: false,
      jukeboxPlacement: "none",
    });
    assert.equal(project.status, "DRAFT");
    assert.equal(project.publicVisible, false);

    const firstJpeg = await sharp({ create: { width: 96, height: 96, channels: 3, background: "#34261f" } }).jpeg().toBuffer();
    const firstCoverResponse = await uploadCover(
      configuration.baseUrl,
      adminCookie,
      project,
      null,
      new File([firstJpeg], "r2-cover-a.jpg", { type: "image/jpeg" }),
    );
    assert.equal(firstCoverResponse.status, 200);
    assert.equal((await firstCoverResponse.json() as { state?: string }).state, "cover-enregistree");
    const firstCover = await activeProjectAsset(project.id, "COVER");
    assertR2Asset(firstCover, "PUBLIC");
    assert.equal((await headMediaObject(firstCover)).contentLength, Number(firstCover.sizeBytes));

    const secondJpeg = await sharp({ create: { width: 128, height: 128, channels: 3, background: "#15364a" } }).jpeg().toBuffer();
    const secondCoverResponse = await uploadCover(
      configuration.baseUrl,
      adminCookie,
      project,
      firstCover.id,
      new File([secondJpeg], "r2-cover-b.jpg", { type: "image/jpeg" }),
    );
    assert.equal(secondCoverResponse.status, 200);
    const secondCover = await activeProjectAsset(project.id, "COVER");
    assert.notEqual(secondCover.id, firstCover.id);
    assertR2Asset(secondCover, "PUBLIC");
    await expectObjectMissing(firstCover);

    const published = await updateCatalogProject(project.id, {
      updatedAt: (await prisma.project.findUniqueOrThrow({ where: { id: project.id }, select: { updatedAt: true } })).updatedAt.toISOString(),
      title: project.title,
      subtitle: "",
      type: "project",
      status: "published",
      releaseDate: "",
      trackCount: "",
      publicVisible: true,
      featured: false,
      jukeboxPlacement: "none",
      jukeboxPosition: "",
      shortDescription: "Fixture staging temporaire.",
      description: "",
      seoTitle: "",
      seoDescription: "",
    });
    assert.equal(published.publicVisible, true);
    assert.equal(published.status, "PUBLISHED");
    const publicCoverUrl = `${configuration.baseUrl}/media/catalog/${secondCover.id}`;
    const publicHead = await http(publicCoverUrl, { method: "HEAD" });
    assert.equal(publicHead.status, 200);
    assert.equal(publicHead.headers.get("content-type"), "image/webp");
    assert.equal(publicHead.headers.get("content-length"), String(secondCover.sizeBytes));
    assert.match(publicHead.headers.get("cache-control") ?? "", /immutable/);
    assert.equal((await publicHead.arrayBuffer()).byteLength, 0);
    const publicGet = await http(publicCoverUrl);
    assert.equal(publicGet.status, 200);
    assert.equal((await publicGet.arrayBuffer()).byteLength, Number(secondCover.sizeBytes));

    const privateAgain = await updateCatalogProject(project.id, {
      updatedAt: published.updatedAt.toISOString(),
      title: project.title,
      subtitle: "",
      type: "project",
      status: "draft",
      releaseDate: "",
      trackCount: "",
      publicVisible: false,
      featured: false,
      jukeboxPlacement: "none",
      jukeboxPosition: "",
      shortDescription: "Fixture staging temporaire.",
      description: "",
      seoTitle: "",
      seoDescription: "",
    });
    assert.equal(privateAgain.status, "DRAFT");
    assert.equal(privateAgain.publicVisible, false);

    await deleteCatalogCover(project.id, secondCover.id);
    assert.equal(await prisma.asset.findUnique({ where: { id: secondCover.id } }), null);
    await expectObjectMissing(secondCover);

    const fixture = await createAudioFixture({ seconds: 65, format: "mp3" });
    try {
      const audioResponse = await uploadAudio(
        configuration.baseUrl,
        adminCookie,
        project,
        new File([fixture.bytes!], "r2-complete-source.mp3", { type: "audio/mpeg" }),
      );
      assert.equal(audioResponse.status, 200);
      const audioPayload = await audioResponse.json() as { state?: string; currentAudioAssetId?: string; durationMs?: number };
      assert.equal(audioPayload.state, "audio-enregistre");
      assert.ok(audioPayload.durationMs && audioPayload.durationMs >= 59_000 && audioPayload.durationMs <= 61_000);
      const audio = await activeProjectAsset(project.id, "AUDIO_PREVIEW");
      assert.equal(audio.id, audioPayload.currentAudioAssetId);
      assertR2Asset(audio, "PUBLIC");
      assert.equal(audio.mimeType, "audio/mpeg");

      const adminAudioUrl = `${configuration.baseUrl}/api/admin/catalogue/audio/${audio.id}`;
      const head = await http(adminAudioUrl, { method: "HEAD", headers: { cookie: adminCookie } });
      assert.equal(head.status, 200);
      assert.equal(head.headers.get("content-length"), String(audio.sizeBytes));
      assert.match(head.headers.get("cache-control") ?? "", /private/i);
      assert.match(head.headers.get("cache-control") ?? "", /no-store/i);
      const full = await http(adminAudioUrl, { headers: { cookie: adminCookie } });
      assert.equal(full.status, 200);
      assert.equal((await full.arrayBuffer()).byteLength, Number(audio.sizeBytes));
      const range = await http(adminAudioUrl, { headers: { cookie: adminCookie, range: "bytes=0-1023" } });
      assert.equal(range.status, 206);
      assert.equal(range.headers.get("content-range"), `bytes 0-1023/${audio.sizeBytes}`);
      assert.equal((await range.arrayBuffer()).byteLength, 1_024);
      const invalid = await http(adminAudioUrl, { headers: { cookie: adminCookie, range: "bytes=999999999-" } });
      assert.equal(invalid.status, 416);
      assert.equal(invalid.headers.get("content-range"), `bytes */${audio.sizeBytes}`);
      assert.equal((await http(`${configuration.baseUrl}/media/catalog/audio/${audio.id}`)).status, 404, "A private DRAFT project must not expose its audio publicly.");

      await deleteMediaObject(audio);
      await expectObjectMissing(audio);
      assert.equal(
        (await http(adminAudioUrl, { headers: { cookie: adminCookie } })).status,
        404,
        "A missing R2 object must fail closed instead of falling back to a local copy.",
      );
      const deleted = await deleteAudio(configuration.baseUrl, adminCookie, project, audio.id);
      assert.equal(deleted.status, 200);
      assert.equal((await deleted.json() as { state?: string }).state, "audio-supprime");
      await expectObjectMissing(audio);
    } finally {
      await fixture.cleanup();
    }

    ownerOrder = await createDraftOrder(owner, orderInput);
    otherOrder = await createDraftOrder(other, { ...orderInput, title: `${QA_ORDER_TITLE_PREFIX} other` });
    const sourcePhoto = await sharp({ create: { width: 80, height: 60, channels: 3, background: "#4b3f32" } }).png().toBuffer();
    const photoBody = orderPhotoForm(new File([sourcePhoto], "private-reference.png", { type: "image/png" }));
    const uploadedPhoto = await http(`${configuration.baseUrl}/api/orders/${ownerOrder.orderNumber}/photos`, {
      method: "POST",
      headers: { origin: configuration.baseUrl, cookie: ownerCookie },
      body: photoBody,
    });
    assert.equal(uploadedPhoto.status, 201);
    const uploadedPayload = await uploadedPhoto.json() as { order?: { photos?: Array<{ id: string }> } };
    const assetId = uploadedPayload.order?.photos?.[0]?.id;
    assert.ok(assetId);
    const privateAsset = await prisma.asset.findUniqueOrThrow({ where: { id: assetId } });
    assertR2Asset(privateAsset, "PRIVATE");
    assert.equal(privateAsset.mimeType, "image/webp");
    assert.equal((await headMediaObject(privateAsset)).contentLength, Number(privateAsset.sizeBytes));

    const mediaUrl = `${configuration.baseUrl}/api/orders/${ownerOrder.orderNumber}/photos/${privateAsset.id}`;
    assert.equal((await http(mediaUrl)).status, 401);
    assert.equal((await http(mediaUrl, { headers: { cookie: otherCookie } })).status, 404);
    assert.equal((await http(`${configuration.baseUrl}/api/orders/${otherOrder.orderNumber}/photos/${privateAsset.id}`, { headers: { cookie: otherCookie } })).status, 404);
    for (const cookie of [ownerCookie, adminCookie]) {
      const response = await http(mediaUrl, { headers: { cookie } });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get("content-type"), "image/webp");
      assert.match(response.headers.get("cache-control") ?? "", /private/i);
      assert.match(response.headers.get("cache-control") ?? "", /no-store/i);
      assert.equal(response.headers.get("x-content-type-options"), "nosniff");
      assert.equal((await response.arrayBuffer()).byteLength, Number(privateAsset.sizeBytes));
    }
    assert.equal((await http(mediaUrl, { method: "DELETE", headers: { origin: "https://attacker.invalid", cookie: ownerCookie } })).status, 403);
    assert.equal((await http(mediaUrl, { method: "DELETE", headers: { origin: configuration.baseUrl, cookie: ownerCookie } })).status, 204);
    await expectObjectMissing(privateAsset);

    await deleteDraftOrder(owner, ownerOrder.orderNumber);
    ownerOrder = null;
    await deleteDraftOrder(other, otherOrder.orderNumber);
    otherOrder = null;
    const deletion = await deleteCatalogProject(project.id, project.slug);
    assert.equal(deletion.cleanupFailed, false);
    project = null;
    console.info("R2 staging runtime QA passed: catalogue cover lifecycle, private DRAFT audio HTTP ranges, and private order-media authorization matrix.");
  } finally {
    if (project) {
      const audio = await prisma.asset.findFirst({ where: { projects: { some: { projectId: project.id, role: "AUDIO_PREVIEW" } } } });
      if (audio) {
        remember(audio);
        await deleteCatalogAudioPreview(project.id, audio.id).catch(() => undefined);
      }
    }
    await cleanupQaData();
  }
}

run()
  .finally(() => prisma.$disconnect())
  .catch(() => {
    // Deliberately avoid echoing provider errors: they may contain an endpoint,
    // request identifier or other staging configuration detail.
    console.error("R2 staging runtime QA failed; no provider detail was logged.");
    process.exitCode = 1;
  });
