import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { access, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import sharp from "sharp";

import { orderOffer } from "@/data/order-offer";
import { orderIllustrationFormatOptions } from "@/data/order-illustration";
import { assertSafeLocalPostgresUrl } from "@/lib/database/local-postgres-url";
import type { OrderDraftInput } from "@/lib/orders/domain";
import type { SerializedOrder } from "@/lib/orders/types";

// This harness intentionally leaves its synthetic fixtures available for the
// subsequent browser review. It never clears a database or calls a provider.
const TARGET = "lnx-photos-format-test";
const DATABASE_NAME = "lnx_photos_format_test";
const QA_ROOT = process.env.LNX_PHOTOS_FORMAT_QA_ROOT ?? "";
const PRIVATE_ROOT = `${QA_ROOT}/private`;
const PUBLIC_ROOT = `${QA_ROOT}/public`;
const CONFIRMATION = "photos-format-disposable-local-only";
const MIB = 1024 * 1024;
const EXPECTED_TRANSPORT_BYTES = 10 * MIB + 64 * 1024;
const RUN_ID = randomUUID().slice(0, 8);
const CONSENTS = { personalUseTermsAccepted: true, earlyPerformanceConsentAccepted: true };
const passed: string[] = [];

type Fixture = { filename: string; mimeType: string; bytes: Buffer };
type Session = { id: string; email: string; cookie: string };
type OrderPayload = { order?: SerializedOrder; error?: string; code?: string; field?: string };
type HttpResult = { response: Response; payload: OrderPayload };
type FixtureReference = { label: string; orderNumber: string; customerPath: string; adminPath: string };

const baseDraft: OrderDraftInput = {
  title: "QA photos et format — synthétique",
  recipient: "Personne fictive QA",
  occasion: "Recette locale sans données personnelles",
  brief: "Une histoire entièrement synthétique pour vérifier les photos et le format enregistré, sans paiement ni envoi externe.",
  musicalDirection: "Je laisse LNX Beats choisir",
  emotion: "Lumineuse",
  importantDetails: "Donnée de recette synthétique uniquement.",
  wordsToInclude: "",
  avoid: "",
  pronunciationNotes: "",
  illustrationFormat: "CUSTOM",
  illustrationFormatCustom: "Bannière panoramique QA 21:9 — choix confié au créateur",
  coverIncluded: true,
  priorityProcessing: false,
};

function guard(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(`QA safety guard: ${message}`);
}

async function validateEnvironment() {
  guard(process.env.NODE_ENV === "test", "NODE_ENV must be test for the harness.");
  guard(/^\/private\/tmp\/lnx-photos-format-qa\.[A-Za-z0-9]+$/.test(QA_ROOT), "an isolated mktemp QA root is required.");
  guard(process.env.LNX_DATABASE_TARGET === TARGET, "unexpected database target.");
  guard(process.env.LNX_PHOTOS_FORMAT_QA_CONFIRM === CONFIRMATION, "explicit disposable-local confirmation is missing.");
  const database = assertSafeLocalPostgresUrl(process.env.DATABASE_URL ?? "");
  guard(database.hostname === "127.0.0.1" && database.port === "55483", "only the dedicated local PostgreSQL port is permitted.");
  guard(decodeURIComponent(database.pathname) === `/${DATABASE_NAME}`, "unexpected disposable database name.");
  guard(!database.hash, "database fragments are forbidden.");
  const origin = process.env.AUTH_URL ?? "";
  guard(["http://127.0.0.1:31980", "http://localhost:31980"].includes(origin), "only the dedicated Next HTTP origin is permitted.");
  guard(process.env.SITE_URL === origin && process.env.APP_CANONICAL_URL === origin, "all application origins must be identical and local.");
  guard(process.env.AUTH_SECRET && process.env.AUTH_SECRET.length >= 32, "a local authentication secret is required.");
  guard(process.env.LNX_AUTH_QA_PASSWORD && process.env.LNX_AUTH_QA_PASSWORD.length >= 12, "a local fixture password is required.");
  guard(process.env.AUTH_QA_ACCESS_ENABLED === "false", "staging QA access must remain disabled.");
  guard(!process.env.LNX_PREVIEW_MODE, "the personal preview must not be selected.");
  guard(process.env.ORDER_UPLOAD_MODE === "local-qa", "photo storage must be local QA.");
  guard(process.env.ORDER_UPLOAD_DIR === PRIVATE_ROOT && process.env.MEDIA_LOCAL_PRIVATE_ROOT === PRIVATE_ROOT, "unexpected private fixture root.");
  guard(process.env.MEDIA_LOCAL_PUBLIC_ROOT === PUBLIC_ROOT, "unexpected public fixture root.");
  guard(process.env.MEDIA_STORAGE_DRIVER === "local" && process.env.MEDIA_DEPLOYMENT_ENV === "test", "only the local media driver is permitted.");
  guard(["capture", "disabled"].includes(process.env.EMAIL_PROVIDER ?? ""), "auth email delivery must be captured or disabled.");
  if (process.env.EMAIL_PROVIDER === "capture") {
    guard(process.env.AUTH_EMAIL_CAPTURE_PATH === `${QA_ROOT}/auth-mail.jsonl`, "unexpected auth mail capture path.");
  }
  guard(process.env.NOTIFICATION_DEPLOYMENT_ENV === "development", "notifications must not use a deployed environment.");
  guard(process.env.NOTIFICATION_EMAIL_TRANSPORT === "disabled", "notification delivery must remain disabled.");
  for (const key of [
    "EMAIL_NOTIFICATIONS_ENABLED", "OWNER_EMAIL_NOTIFICATIONS_ENABLED", "CLIENT_EMAIL_NOTIFICATIONS_ENABLED",
    "NOTIFICATION_WORKER_ENABLED", "SMS_NOTIFICATIONS_ENABLED", "PAYMENTS_ENABLED", "STRIPE_PAYMENTS_ENABLED",
    "PAYPAL_PAYMENTS_ENABLED", "SHOP_PAYMENTS_ENABLED", "LIVE_REFUNDS_ENABLED",
  ]) guard(process.env[key] === "false", `${key} must explicitly remain false.`);
  guard(process.env.NOTIFICATION_SCHEDULER_MODE === "disabled" && process.env.SMS_TRANSPORT === "disabled", "schedulers and SMS must remain disabled.");
  guard(process.env.PAYMENT_DEPLOYMENT_ENV === "development", "payments must not use a deployed environment.");
  for (const [key, value] of Object.entries(process.env)) {
    if (/^RAILWAY_|^(?:RESEND_|STRIPE_|PAYPAL_|MEDIA_S3_|AWS_).*(?:SECRET|TOKEN|KEY|ENDPOINT|CLIENT_ID|WEBHOOK)/.test(key)) {
      guard(!value?.trim(), `external deployment/provider variable ${key} must be absent.`);
    }
  }
  for (const key of ["NOTIFICATION_WORKER_SECRET", "SMTP_HOST", "SMTP_PASSWORD", "RESEND_BASE_URL"]) {
    guard(!process.env[key]?.trim(), "external notification credentials or endpoints must be absent.");
  }
  for (const filename of [".env", ".env.local", ".env.production", ".env.production.local", ".env.test", ".env.test.local"]) {
    const exists = await access(path.join(process.cwd(), filename)).then(() => true, () => false);
    guard(!exists, "Next dotenv files must be absent from this isolated checkout.");
  }
  const buildId = (await readFile(path.join(process.cwd(), ".next/BUILD_ID"), "utf8")).trim();
  guard(Boolean(buildId), "build the real Next candidate before running HTTP QA.");
  const built = JSON.parse(await readFile(path.join(process.cwd(), ".next/required-server-files.json"), "utf8")) as {
    config?: { experimental?: { proxyClientMaxBodySize?: number } };
  };
  guard(built.config?.experimental?.proxyClientMaxBodySize === EXPECTED_TRANSPORT_BYTES, "the compiled candidate must use the bounded 10 MiB + 64 KiB proxy allowance.");
  const nextPackage = JSON.parse(await readFile(path.join(process.cwd(), "node_modules/next/package.json"), "utf8")) as { version: string };
  return { origin, buildId, nextVersion: nextPackage.version };
}

function record(label: string) {
  passed.push(label);
  console.info(`PASS ${label}`);
}

function padJpegWithComments(jpeg: Buffer, targetBytes: number) {
  assert.equal(jpeg.readUInt16BE(0), 0xffd8);
  let remaining = targetBytes - jpeg.length;
  assert.ok(remaining >= 4, "The valid JPEG fixture must leave room for bounded COM segments.");
  const chunks = [jpeg.subarray(0, 2)];
  while (remaining > 0) {
    let segmentBytes = Math.min(remaining, 65_537);
    if (remaining - segmentBytes > 0 && remaining - segmentBytes < 4) segmentBytes -= 4;
    assert.ok(segmentBytes >= 4 && segmentBytes <= 65_537);
    const segment = Buffer.alloc(segmentBytes, 0x51);
    segment.writeUInt16BE(0xfffe, 0);
    segment.writeUInt16BE(segmentBytes - 2, 2);
    chunks.push(segment);
    remaining -= segmentBytes;
  }
  chunks.push(jpeg.subarray(2));
  const padded = Buffer.concat(chunks);
  assert.equal(padded.length, targetBytes);
  return padded;
}

async function jpegFixture(seed: number, targetBytes?: number, photographicNoise = false): Promise<Fixture> {
  let jpeg: Buffer;
  if (photographicNoise) {
    const width = 2048;
    const height = 1536;
    const pixels = Buffer.allocUnsafe(width * height * 3);
    let state = seed + 1;
    for (let index = 0; index < pixels.length; index += 1) {
      state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
      pixels[index] = state >>> 24;
    }
    jpeg = await sharp(pixels, { raw: { width, height, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
  } else {
    jpeg = await sharp({ create: {
      width: 80 + seed,
      height: 60,
      channels: 3,
      background: { r: (seed * 41) % 255, g: (seed * 83) % 255, b: (seed * 137) % 255 },
    } }).jpeg({ quality: 95 }).toBuffer();
  }
  const bytes = targetBytes ? padJpegWithComments(jpeg, targetBytes) : jpeg;
  // Full decoding, not just a magic-header or metadata check. COM padding is
  // legal JPEG data and makes byte-boundary cases exact and reproducible.
  const decoded = await sharp(bytes, { failOn: "error" }).raw().toBuffer({ resolveWithObject: true });
  assert.ok(decoded.info.width > 0 && decoded.info.height > 0);
  return { filename: `synthetic-${seed}.jpg`, mimeType: "image/jpeg", bytes };
}

function multipart(files: readonly Fixture[], consent: string | null = "true") {
  const form = new FormData();
  if (consent !== null) form.set("rightsConfirmed", consent);
  for (const file of files) form.append("files", new Blob([new Uint8Array(file.bytes)], { type: file.mimeType }), file.filename);
  return form;
}

async function assertBoundaryEnvelope(origin: string, file: Fixture) {
  const encoded = new Request(`${origin}/api/orders/fixture/photos`, { method: "POST", body: multipart([file]) });
  const bytes = (await encoded.arrayBuffer()).byteLength;
  assert.ok(bytes > file.bytes.length, "The transport case must include real multipart overhead.");
  assert.ok(bytes <= EXPECTED_TRANSPORT_BYTES, "The valid boundary envelope must fit the small transport allowance.");
  return bytes;
}

function assertNoPrivateStorageLeak(payload: unknown) {
  assert.doesNotMatch(JSON.stringify(payload), /storageKey|storageProvider|checksumSha256|accessKeyId|secretAccessKey|\.r2\.cloudflarestorage\.com|stackTrace/);
}

function requireOrder(result: HttpResult, status = 200) {
  assert.equal(result.response.status, status, `Unexpected HTTP order status (${result.payload.code ?? "no code"}).`);
  assert.ok(result.payload.order, "A successful order response must include the persisted projection.");
  assertNoPrivateStorageLeak(result.payload);
  return result.payload.order;
}

function photoIds(order: SerializedOrder) {
  return order.photos.map(({ id }) => id);
}

function assertSameBriefAndPrice(actual: SerializedOrder, expected: SerializedOrder) {
  for (const key of [
    "brief", "recipient", "musicalDirection", "coverIncluded", "illustrationFormat", "illustrationFormatCustom",
    "pricingVersion", "basePriceCents", "coverPriceCents", "priorityPriceCents", "totalCents", "currency",
  ] as const) assert.equal(actual[key], expected[key], `Photo processing changed ${key}.`);
}

async function run() {
  const environment = await validateEnvironment();
  const { prisma } = await import("@/lib/prisma");
  const { createInternalAuthUser } = await import("@/lib/auth/internal-user");
  const origin = environment.origin;
  const references: FixtureReference[] = [];
  const profiles: Record<string, { id: string; email: string }> = {};
  const filesOnDisk: { label: string; path: string; bytes: number; sha256: string }[] = [];
  const runRoot = path.join(QA_ROOT, `run-${RUN_ID}`);

  async function http(route: string, options: RequestInit = {}) {
    guard(route.startsWith("/") && !route.startsWith("//"), "request path must remain local.");
    return fetch(`${origin}${route}`, { ...options, redirect: "manual", signal: AbortSignal.timeout(90_000) });
  }
  async function json(route: string, session: Session | null, options: { method?: string; body?: unknown } = {}): Promise<HttpResult> {
    const response = await http(route, {
      method: options.method ?? "GET",
      headers: {
        accept: "application/json", origin,
        ...(session ? { cookie: session.cookie } : {}),
        ...(options.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
    });
    const payload = await response.json() as OrderPayload;
    assertNoPrivateStorageLeak(payload);
    return { response, payload };
  }
  async function signIn(label: string, role: "MEMBER" | "ADMIN"): Promise<Session> {
    const email = `photos-format-${label}-${RUN_ID}@example.invalid`;
    const user = await createInternalAuthUser({ email, password: process.env.LNX_AUTH_QA_PASSWORD!, displayName: `QA ${label} synthétique`, role });
    const response = await http("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "content-type": "application/json", origin },
      body: JSON.stringify({ email, password: process.env.LNX_AUTH_QA_PASSWORD, rememberMe: true }),
    });
    assert.equal(response.status, 200, "The real sign-in endpoint must accept the synthetic verified profile.");
    const setCookies = response.headers.getSetCookie();
    const sessionCookie = setCookies.find((value) => /^(?:__Secure-)?lnx-studio\.session_token=/.test(value));
    guard(sessionCookie, "the real login response did not return its session cookie.");
    await response.body?.cancel();
    profiles[label] = { id: user.id, email };
    return { ...profiles[label], cookie: sessionCookie.split(";", 1)[0] };
  }
  async function draft(session: Session, label: string, input: OrderDraftInput = baseDraft) {
    const order = requireOrder(await json("/api/orders/drafts", session, {
      method: "POST", body: { ...input, title: `QA ${label} — ${RUN_ID}` },
    }), 201);
    references.push({ label, orderNumber: order.orderNumber, customerPath: `/commander?brouillon=${order.orderNumber}`, adminPath: `/admin/commandes/${order.orderNumber}` });
    return order;
  }
  async function readOrder(session: Session, order: Pick<SerializedOrder, "orderNumber">) {
    return requireOrder(await json(`/api/orders/${order.orderNumber}`, session));
  }
  async function upload(session: Session | null, order: Pick<SerializedOrder, "orderNumber">, files: readonly Fixture[], options: { consent?: string | null; origin?: string } = {}): Promise<HttpResult> {
    const response = await http(`/api/orders/${order.orderNumber}/photos`, {
      method: "POST", headers: { origin: options.origin ?? origin, ...(session ? { cookie: session.cookie } : {}) },
      body: multipart(files, options.consent === undefined ? "true" : options.consent),
    });
    const payload = await response.json() as OrderPayload;
    assertNoPrivateStorageLeak(payload);
    return { response, payload };
  }
  async function rejectedUpload(session: Session | null, order: SerializedOrder, files: readonly Fixture[], expectedStatus: number, options: { consent?: string | null; origin?: string; code?: string } = {}) {
    const result = await upload(session, order, files, options);
    assert.equal(result.response.status, expectedStatus, `Unexpected rejection (${result.payload.code ?? "no code"}).`);
    if (options.code) assert.equal(result.payload.code, options.code);
  }
  async function saveFixture(label: string, file: Fixture) {
    const filename = path.join(runRoot, `${label}-${file.filename}`);
    await writeFile(filename, file.bytes, { flag: "wx", mode: 0o600 });
    filesOnDisk.push({ label, path: filename, bytes: file.bytes.length, sha256: createHash("sha256").update(file.bytes).digest("hex") });
  }

  try {
    const metadata = await prisma.$queryRaw<Array<{ database: string; port: number; address: string; version: string }>>`
      SELECT current_database() AS database, inet_server_port() AS port,
        host(inet_server_addr()) AS address, current_setting('server_version') AS version
    `;
    guard(metadata[0]?.database === DATABASE_NAME && metadata[0]?.port === 55483 && metadata[0]?.address === "127.0.0.1", "connected database identity does not match the isolated instance.");
    guard(metadata[0]?.version.startsWith("18."), "PostgreSQL 18 is required for the local runtime proof.");
    const financialCountsBefore = await Promise.all([prisma.payment.count(), prisma.providerEvent.count(), prisma.invoice.count()]);
    const member = await signIn("member", "MEMBER");
    const other = await signIn("other", "MEMBER");
    const admin = await signIn("admin", "ADMIN");
    await mkdir(runRoot, { recursive: true, mode: 0o700 });
    record("real HTTP authentication for three synthetic local profiles");

    const multi = await draft(member, "quatre-photos-format-personnalise");
    const firstFour: Fixture[] = [];
    let current = multi;
    for (let index = 0; index < 4; index += 1) {
      const file = await jpegFixture(index + 1, 4 * MIB, true);
      firstFour.push(file);
      await saveFixture(`four-${index + 1}`, file);
      current = requireOrder(await upload(member, multi, [file]), 201);
      assert.equal(current.photos.length, index + 1);
      assertSameBriefAndPrice(current, multi);
    }
    assert.ok(firstFour.reduce((total, file) => total + file.bytes.length, 0) > 15 * MIB);
    assert.deepEqual(current.photos.map(({ position }) => position), [0, 1, 2, 3]);
    record("four real decodable 4 MiB JPEGs persist sequentially with order, format and price intact");

    const originalIds = photoIds(current);
    const additional = await jpegFixture(21);
    current = requireOrder(await upload(member, multi, [additional]), 201);
    assert.deepEqual(photoIds(current).slice(0, 4), originalIds);
    assert.equal(current.photos.length, 5);
    const ambiguous = await jpegFixture(22);
    const discarded = await http(`/api/orders/${multi.orderNumber}/photos`, {
      method: "POST", headers: { origin, cookie: member.cookie }, body: multipart([ambiguous]),
    });
    assert.equal(discarded.status, 201);
    // Deliberately discard the confirmed server response. This models a client
    // that cannot use the persisted response; it is not a TCP-crash claim.
    await discarded.body?.cancel();
    const afterDiscard = await readOrder(member, multi);
    assert.equal(afterDiscard.photos.length, 6);
    current = requireOrder(await upload(member, multi, [ambiguous]), 201);
    assert.deepEqual(photoIds(current), photoIds(afterDiscard));
    const concurrent = await jpegFixture(23);
    const duplicates = await Promise.all([upload(member, multi, [concurrent]), upload(member, multi, [concurrent])]);
    duplicates.forEach((result) => requireOrder(result, 201));
    current = await readOrder(member, multi);
    assert.equal(current.photos.length, 7);
    assert.deepEqual(photoIds(current).slice(0, 4), originalIds);
    assert.equal(new Set(current.photos.map(({ position }) => position)).size, 7);
    const removedExtraId = current.photos[4]!.id;
    const deletedExtra = await http(`/api/orders/${multi.orderNumber}/photos/${removedExtraId}`, {
      method: "DELETE", headers: { origin, cookie: member.cookie },
    });
    assert.equal(deletedExtra.status, 204);
    const positionsBeforeAppend = (await readOrder(member, multi)).photos.map(({ position }) => position);
    current = requireOrder(await upload(member, multi, [await jpegFixture(24)]), 201);
    assert.deepEqual(current.photos.map(({ position }) => position).slice(0, -1), positionsBeforeAppend);
    assert.equal(current.photos.at(-1)!.position, Math.max(...positionsBeforeAppend) + 1);
    assert.deepEqual(photoIds(current).slice(0, 4), originalIds);
    record("append preserves saved references; discarded-response retry and concurrent duplicate create no duplicates");

    const boundary = await draft(member, "frontieres-taille");
    const near = await jpegFixture(31, Math.floor(9.9 * MIB));
    const exact = await jpegFixture(32, orderOffer.maxPhotoBytes);
    const plusOne = await jpegFixture(33, orderOffer.maxPhotoBytes + 1);
    const exactEnvelopeBytes = await assertBoundaryEnvelope(origin, exact);
    const plusOneEnvelopeBytes = await assertBoundaryEnvelope(origin, plusOne);
    requireOrder(await upload(member, boundary, [near]), 201);
    requireOrder(await upload(member, boundary, [exact]), 201);
    await rejectedUpload(member, boundary, [plusOne], 413, { code: "FILE_TOO_LARGE" });
    assert.equal((await readOrder(member, boundary)).photos.length, 2);
    await saveFixture("exact-10mib", exact);
    await saveFixture("over-10mib", plusOne);
    record("9.9 MiB and exact 10 MiB plus multipart succeed; 10 MiB plus one file byte is refused");

    const corrupt: Fixture = { filename: "synthetic-corrupt.jpg", mimeType: "image/jpeg", bytes: Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x00]) };
    await saveFixture("corrupt", corrupt);
    const recovery = await draft(member, "reprise-partielle");
    const kept = requireOrder(await upload(member, recovery, [await jpegFixture(41)]), 201);
    await rejectedUpload(member, recovery, [corrupt], 400, { code: "DECODE_FAILED" });
    let recovered = await readOrder(member, recovery);
    assert.deepEqual(photoIds(recovered), photoIds(kept));
    assertSameBriefAndPrice(recovered, recovery);
    recovered = requireOrder(await upload(member, recovery, [await jpegFixture(42)]), 201);
    assert.equal(recovered.photos.length, 2);
    assert.deepEqual(photoIds(recovered).slice(0, 1), photoIds(kept));
    for (const [index, format] of ["png", "webp"].entries()) {
      const file: Fixture = {
        filename: `synthetic-valid.${format}`, mimeType: `image/${format}`,
        bytes: await sharp({ create: { width: 99 + index, height: 71, channels: 3, background: index ? "#309080" : "#702030" } })
          .toFormat(format as "png" | "webp").toBuffer(),
      };
      recovered = requireOrder(await upload(member, recovery, [file]), 201);
      assert.equal(recovered.photos.at(-1)!.mimeType, "image/webp");
    }
    const separateOrderReference = requireOrder(await upload(member, recovery, [firstFour[0]!]), 201);
    assert.notEqual(separateOrderReference.photos.at(-1)!.id, originalIds[0]);
    record("partial failure keeps confirmed photos, brief and custom format; individual retry adds only the missing photo");

    const small = await jpegFixture(51);
    await rejectedUpload(null, boundary, [small], 401);
    await rejectedUpload(other, boundary, [small], 404);
    await rejectedUpload(member, boundary, [small], 403, { origin: "https://attacker.invalid" });
    await rejectedUpload(member, boundary, [small], 400, { consent: null });
    await rejectedUpload(member, boundary, [{ ...small, mimeType: "image/png" }], 400, { code: "MIME_MISMATCH" });
    await rejectedUpload(member, boundary, [small, await jpegFixture(52)], 400, { code: "INVALID_PHOTO_COUNT" });
    const tooWide: Fixture = {
      filename: "synthetic-too-wide.png", mimeType: "image/png",
      bytes: await sharp({ create: { width: orderOffer.maxImageWidth + 1, height: 1, channels: 3, background: "red" } }).png().toBuffer(),
    };
    await rejectedUpload(member, boundary, [tooWide], 400, { code: "DIMENSIONS_TOO_LARGE" });
    const tooManyPixels: Fixture = {
      filename: "synthetic-too-many-pixels.png", mimeType: "image/png",
      bytes: await sharp({ create: { width: 6400, height: 6251, channels: 3, background: "#506070" } }).png().toBuffer(),
    };
    assert.ok(6400 * 6251 > orderOffer.maxImagePixels);
    await rejectedUpload(member, boundary, [tooManyPixels], 400);
    const invalidMultipart = await http(`/api/orders/${boundary.orderNumber}/photos`, {
      method: "POST", headers: { origin, cookie: member.cookie, "content-type": "multipart/form-data; boundary=qa-invalid" },
      body: "invalid multipart bytes",
    });
    assert.equal(invalidMultipart.status, 400);
    assertNoPrivateStorageLeak(await invalidMultipart.json());
    assert.equal((await readOrder(member, boundary)).photos.length, 2);
    record("anonymous, non-owner, cross-origin, no-consent, wrong MIME, malformed multipart, multiple files and excessive dimensions/pixels fail closed");

    const quota = await draft(other, "quota-concurrent");
    let quotaFirst: Fixture | undefined;
    for (let index = 0; index < 9; index += 1) {
      const file = await jpegFixture(70 + index);
      quotaFirst ??= file;
      requireOrder(await upload(other, quota, [file]), 201);
    }
    const quotaRace = await Promise.all([
      upload(other, quota, [await jpegFixture(80)]),
      upload(other, quota, [await jpegFixture(81)]),
    ]);
    assert.deepEqual(quotaRace.map(({ response }) => response.status).sort(), [201, 400]);
    assert.equal(quotaRace.find(({ response }) => response.status === 400)?.payload.code, "PHOTO_LIMIT_REACHED");
    const atQuota = await readOrder(other, quota);
    assert.equal(atQuota.photos.length, orderOffer.maxPhotos);
    assert.ok(quotaFirst);
    const quotaRetry = requireOrder(await upload(other, quota, [quotaFirst]), 201);
    assert.deepEqual(photoIds(quotaRetry), photoIds(atQuota));
    assert.equal(new Set(quotaRetry.photos.map(({ position }) => position)).size, orderOffer.maxPhotos);
    record("two concurrent additions cannot exceed ten references; a duplicate retry still succeeds at quota");

    const withoutIllustration: OrderDraftInput = { ...baseDraft, coverIncluded: false, illustrationFormat: null, illustrationFormatCustom: "" };
    const optional = await draft(member, "sans-illustration-avec-reference");
    const optionalPhoto = requireOrder(await upload(member, optional, [await jpegFixture(91)]), 201);
    const removed = requireOrder(await json(`/api/orders/${optional.orderNumber}`, member, { method: "PATCH", body: withoutIllustration }));
    assert.equal(removed.coverIncluded, false);
    assert.equal(removed.illustrationFormat, null);
    assert.deepEqual(photoIds(removed), photoIds(optionalPhoto));
    const finalizedOptional = requireOrder(await json(`/api/orders/${optional.orderNumber}/finalize`, member, { method: "POST", body: { ...withoutIllustration, ...CONSENTS } }));
    assert.equal(finalizedOptional.status, "AWAITING_PAYMENT");
    assert.deepEqual(photoIds(finalizedOptional), photoIds(optionalPhoto));
    const zero = await draft(member, "sans-photo", withoutIllustration);
    const missingSubmissionConsent = await json(`/api/orders/${zero.orderNumber}/finalize`, member, { method: "POST", body: withoutIllustration });
    assert.equal(missingSubmissionConsent.response.status, 400);
    assert.equal((await readOrder(member, zero)).status, "DRAFT");
    const finalizedZero = requireOrder(await json(`/api/orders/${zero.orderNumber}/finalize`, member, { method: "POST", body: { ...withoutIllustration, ...CONSENTS } }));
    assert.equal(finalizedZero.photos.length, 0);
    record("removing Illustration preserves reference photos; both optional-photo and zero-photo orders finalize without payment");

    for (const { value, label } of orderIllustrationFormatOptions) {
      const input: OrderDraftInput = { ...baseDraft, illustrationFormat: value, illustrationFormatCustom: value === "CUSTOM" ? baseDraft.illustrationFormatCustom : "" };
      const order = await draft(member, `format-${value.toLowerCase()}`, input);
      const saved = requireOrder(await json(`/api/orders/${order.orderNumber}`, member, { method: "PATCH", body: input }));
      assert.equal(saved.illustrationFormat, value);
      assert.equal((await readOrder(member, saved)).illustrationFormatCustom, input.illustrationFormatCustom);
      const final = requireOrder(await json(`/api/orders/${order.orderNumber}/finalize`, member, { method: "POST", body: { ...input, ...CONSENTS } }));
      assert.equal(final.illustrationFormat, value);
      assert.equal(final.illustrationFormatCustom, input.illustrationFormatCustom);
      assertSameBriefAndPrice(final, saved);
      const row = await prisma.order.findUniqueOrThrow({ where: { orderNumber: order.orderNumber } });
      assert.equal(row.illustrationFormat, value);
      assert.equal(row.illustrationFormatCustom ?? "", input.illustrationFormatCustom);
      assert.equal(row.musicalDirection, "Je laisse LNX Beats choisir");
      const detail = await http(`/admin/commandes/${order.orderNumber}`, { headers: { cookie: admin.cookie } });
      assert.equal(detail.status, 200);
      const html = await detail.text();
      assert.ok(html.includes("À produire") && html.includes(label), `Admin must display saved ${value} format.`);
      if (value === "CUSTOM") assert.ok(html.includes(input.illustrationFormatCustom));
    }
    const invalidCustom = await json(`/api/orders/${recovery.orderNumber}`, member, { method: "PATCH", body: { ...baseDraft, illustrationFormatCustom: "" } });
    assert.equal(invalidCustom.response.status, 400);
    assert.equal(invalidCustom.payload.field, "illustrationFormatCustom");
    const unknown = await json(`/api/orders/${recovery.orderNumber}`, member, { method: "PATCH", body: { ...baseDraft, illustrationFormat: "UNKNOWN_HISTORICAL" } });
    assert.equal(unknown.response.status, 400);
    assert.equal((await readOrder(member, recovery)).illustrationFormatCustom, baseDraft.illustrationFormatCustom);
    record("all five real illustration choices persist through save, reload, finalization and Admin HTML; invalid custom/unknown choices are rejected");

    const legacy = await prisma.order.create({ data: {
      orderNumber: `LNX-2099-${String(Number.parseInt(RUN_ID, 16) % 1_000_000).padStart(6, "0")}`,
      userId: member.id, customerEmail: member.email, customerName: "QA historique synthétique",
      title: `QA format historique absent — ${RUN_ID}`, brief: baseDraft.brief, musicalDirection: baseDraft.musicalDirection,
      coverIncluded: true, illustrationFormat: null, illustrationFormatCustom: null,
      basePriceCents: 2_000, coverPriceCents: 1_000, totalCents: 3_000, pricingVersion: orderOffer.pricingVersion,
      status: "ACCEPTED",
    } });
    references.push({ label: "historique-format-absent", orderNumber: legacy.orderNumber, customerPath: `/compte/commandes/${legacy.orderNumber}`, adminPath: `/admin/commandes/${legacy.orderNumber}` });
    const beforeLocked = JSON.stringify(await prisma.order.findUniqueOrThrow({ where: { id: legacy.id } }));
    await rejectedUpload(member, { ...multi, orderNumber: legacy.orderNumber }, [small], 404);
    assert.equal((await json(`/api/orders/${legacy.orderNumber}`, member, { method: "PATCH", body: baseDraft })).response.status, 404);
    assert.equal((await json(`/api/orders/${legacy.orderNumber}/finalize`, member, { method: "POST", body: { ...baseDraft, ...CONSENTS } })).response.status, 404);
    assert.equal(JSON.stringify(await prisma.order.findUniqueOrThrow({ where: { id: legacy.id } })), beforeLocked);
    const legacyHtml = await http(`/admin/commandes/${legacy.orderNumber}`, { headers: { cookie: admin.cookie } });
    assert.equal(legacyHtml.status, 200);
    assert.ok((await legacyHtml.text()).includes("Non précisé à la commande"));
    record("synthetic accepted legacy order is immutable and absent saved format is never invented");

    const photo = current.photos[0]!;
    for (const [session, status] of [[null, 401], [other, 404]] as const) {
      const response = await http(`/api/orders/${multi.orderNumber}/photos/${photo.id}`, { headers: session ? { cookie: session.cookie } : {} });
      assert.equal(response.status, status);
      await response.body?.cancel();
    }
    const crossOrder = await http(`/api/orders/${boundary.orderNumber}/photos/${photo.id}`, { headers: { cookie: member.cookie } });
    assert.equal(crossOrder.status, 404);
    await crossOrder.body?.cancel();
    const downloadable = await http(`/api/orders/${multi.orderNumber}/photos/${photo.id}?download=1`, { headers: { cookie: admin.cookie } });
    assert.equal(downloadable.status, 200);
    assert.equal(downloadable.headers.get("content-type"), "image/webp");
    assert.equal(downloadable.headers.get("cache-control"), "private, no-store");
    assert.equal(downloadable.headers.get("x-robots-tag"), "noindex, nofollow");
    assert.match(downloadable.headers.get("content-disposition") ?? "", /attachment;.*\.webp/);
    assert.equal((await sharp(Buffer.from(await downloadable.arrayBuffer())).metadata()).format, "webp");
    const memberDownload = await http(`/api/orders/${multi.orderNumber}/photos/${photo.id}?download=1`, { headers: { cookie: member.cookie } });
    assert.equal(memberDownload.status, 403);
    await memberDownload.body?.cancel();
    const list = await http("/admin/commandes?filtre=all", { headers: { cookie: admin.cookie } });
    assert.equal(list.status, 200);
    const listHtml = await list.text();
    assert.ok(listHtml.includes("Format de l’illustration") && listHtml.includes(baseDraft.illustrationFormatCustom));
    const memberAdmin = await http(`/admin/commandes/${multi.orderNumber}`, { headers: { cookie: member.cookie } });
    assert.ok(memberAdmin.status >= 300 && memberAdmin.status < 400);
    record("private WebP download and cross-order authorization remain protected; Admin list exposes custom precision");

    const financialCountsAfter = await Promise.all([prisma.payment.count(), prisma.providerEvent.count(), prisma.invoice.count()]);
    assert.deepEqual(financialCountsAfter, financialCountsBefore);
    const attachedPhotos = await prisma.orderAsset.findMany({
      where: { order: { userId: { in: [member.id, other.id] } }, role: "REFERENCE" },
      select: { asset: { select: { visibility: true, mimeType: true, storageBackend: true } } },
    });
    assert.ok(attachedPhotos.every(({ asset }) => asset.visibility === "PRIVATE" && asset.mimeType === "image/webp" && asset.storageBackend === "LOCAL"));
    const generatedOrders = await prisma.order.findMany({
      where: { orderNumber: { in: references.map(({ orderNumber }) => orderNumber) }, userId: { in: [member.id, other.id] } },
      select: { id: true, assets: { where: { role: "REFERENCE" }, select: { asset: { select: { storageKey: true } } } } },
    });
    for (const order of generatedOrders) {
      const stored = await readdir(path.join(PRIVATE_ROOT, "orders", order.id)).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [] as string[];
        throw error;
      });
      const expected = order.assets.map(({ asset }) => path.basename(asset.storageKey));
      assert.equal(stored.length, expected.length, "A generated order has an orphaned or missing local media object.");
      assert.ok(expected.every((filename) => stored.includes(filename)), "An attached generated reference is missing from private local storage.");
    }
    record("no payment, provider event or invoice is created; all references remain local private WebP");

    // Browser interaction gets its own normal profile so the HTTP abuse and
    // concurrency checks do not consume that person's upload allowance.
    const browserEmail = `photos-format-browser-${RUN_ID}@example.invalid`;
    const browserUser = await createInternalAuthUser({
      email: browserEmail, password: process.env.LNX_AUTH_QA_PASSWORD!,
      displayName: "QA navigateur synthétique", role: "MEMBER",
    });
    profiles.browser = { id: browserUser.id, email: browserEmail };

    const reportPath = path.join(runRoot, "http-report.json");
    const report = {
      status: "PASS", runId: RUN_ID, origin, target: TARGET,
      nextVersion: environment.nextVersion, buildId: environment.buildId,
      fileLimitBytes: orderOffer.maxPhotoBytes, transportLimitBytes: EXPECTED_TRANSPORT_BYTES,
      exactEnvelopeBytes, plusOneEnvelopeBytes,
      passed, profiles, references, files: filesOnDisk,
      adminListPath: "/admin/commandes?filtre=all",
      note: "Synthetic local fixtures only. JPEG COM padding is standards-valid and fully decoded. Discarded response is simulated after server acknowledgement, not a TCP crash. Concurrent requests use one Next process and do not prove inter-replica locking. Browser, Safari/iPhone, and Production are not proved by this script. The browser profile has no consumed upload allowance; authenticate it normally with the separate local QA password.",
    };
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    console.info(`Order photo HTTP QA passed: ${passed.length} groups, ${references.length} synthetic order fixtures, ${attachedPhotos.length} private references. Report: ${reportPath}`);
  } catch (error) {
    await mkdir(runRoot, { recursive: true, mode: 0o700 });
    const failureReport = path.join(runRoot, "http-report.failed.json");
    await writeFile(failureReport, `${JSON.stringify({
      status: "FAIL", runId: RUN_ID, origin, target: TARGET, passed, profiles, references, files: filesOnDisk,
      note: "Partial synthetic fixtures only; this is not a passing HTTP or browser result. No credentials are included.",
    }, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    console.info(`Partial synthetic QA inventory: ${failureReport}`);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

run().catch((error: unknown) => {
  // Never print connection objects, request headers, cookies, tokens or secrets.
  console.error(`Order photo HTTP QA failed after ${passed.length} passing groups: ${error instanceof Error ? error.message : "unexpected failure"}`);
  process.exitCode = 1;
});
