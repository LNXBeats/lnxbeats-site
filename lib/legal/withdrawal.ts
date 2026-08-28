import "server-only";

import { createHash, createHmac, randomBytes } from "node:crypto";

import type { Prisma } from "@/generated/prisma/client";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";

export const WITHDRAWAL_DECLARATION = "Je vous notifie par la présente ma décision de me rétracter du contrat identifié ci-dessus, sous réserve de la vérification de son applicabilité.";
export const WITHDRAWAL_RATE_LIMIT_WINDOW_MS = 60 * 60_000;

type Transaction = Prisma.TransactionClient;

export type WithdrawalContractType = "MUSIC_ORDER" | "SHOP_ORDER";

export type WithdrawalSubmission = Readonly<{
  contractType: WithdrawalContractType;
  orderNumber: string;
  firstName: string;
  lastName: string;
  email: string;
  productDescription: string;
  quantity: number | null;
  reason: string | null;
  declarationAccepted: true;
}>;

export class WithdrawalServiceError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = "WithdrawalServiceError";
  }
}

function normalizeText(value: unknown, name: string, maximum: number) {
  if (typeof value !== "string") throw new WithdrawalServiceError("La demande est invalide.", 400, "INVALID_REQUEST");
  const normalized = value.trim().replace(/\s+/g, " ");
  if (!normalized || normalized.length > maximum || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new WithdrawalServiceError(`${name} est invalide.`, 400, "INVALID_REQUEST");
  }
  return normalized;
}

function normalizeEmail(value: unknown) {
  const email = normalizeText(value, "L’adresse e-mail", 320).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new WithdrawalServiceError("L’adresse e-mail est invalide.", 400, "INVALID_REQUEST");
  }
  return email;
}

const submissionKeys = [
  "contractType", "declarationAccepted", "email", "firstName", "lastName",
  "orderNumber", "productDescription", "quantity", "reason",
] as const;

export function parseWithdrawalSubmission(value: unknown): WithdrawalSubmission {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new WithdrawalServiceError("La demande est invalide.", 400, "INVALID_REQUEST");
  }
  const input = value as Record<string, unknown>;
  const keys = Object.keys(input).sort();
  if (keys.length !== submissionKeys.length || keys.some((key, index) => key !== [...submissionKeys].sort()[index])) {
    throw new WithdrawalServiceError("La demande est invalide.", 400, "INVALID_REQUEST");
  }
  if (input.contractType !== "MUSIC_ORDER" && input.contractType !== "SHOP_ORDER") {
    throw new WithdrawalServiceError("Le type de contrat est invalide.", 400, "INVALID_REQUEST");
  }
  if (input.declarationAccepted !== true) {
    throw new WithdrawalServiceError("La déclaration doit être confirmée.", 400, "DECLARATION_REQUIRED");
  }
  const orderNumber = normalizeText(input.orderNumber, "Le numéro de commande", 64).toUpperCase();
  const expectedOrderPattern = input.contractType === "SHOP_ORDER"
    ? /^LNX-SHOP-\d{4}-\d{6}$/
    : /^LNX-\d{4}-\d{6}$/;
  if (!expectedOrderPattern.test(orderNumber)) {
    throw new WithdrawalServiceError("Le numéro de commande est invalide.", 400, "INVALID_REQUEST");
  }
  const quantity = input.quantity === null ? null : input.quantity;
  if (quantity !== null && (!Number.isSafeInteger(quantity) || Number(quantity) < 1 || Number(quantity) > 999)) {
    throw new WithdrawalServiceError("La quantité est invalide.", 400, "INVALID_REQUEST");
  }
  const reason = input.reason === null || input.reason === "" ? null : normalizeText(input.reason, "Le motif", 1000);
  return Object.freeze({
    contractType: input.contractType,
    orderNumber,
    firstName: normalizeText(input.firstName, "Le prénom", 100),
    lastName: normalizeText(input.lastName, "Le nom", 100),
    email: normalizeEmail(input.email),
    productDescription: normalizeText(input.productDescription, "Le produit ou la prestation", 500),
    quantity: quantity === null ? null : Number(quantity),
    reason,
    declarationAccepted: true,
  });
}

function secret() {
  const value = process.env.AUTH_SECRET;
  if (!value || value.length < 32) {
    throw new WithdrawalServiceError("La demande ne peut pas être enregistrée pour le moment.", 503, "SERVICE_UNAVAILABLE");
  }
  return value;
}

function keyedHash(scope: string, value: string) {
  return createHmac("sha256", secret()).update(`${scope}\0${value}`, "utf8").digest("hex");
}

function receiptToken() {
  return randomBytes(32).toString("base64url");
}

function tokenHash(token: string) {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function requestNumber(now: Date) {
  return `LNX-RET-${now.getUTCFullYear()}-${randomBytes(6).toString("hex").toUpperCase()}`;
}

async function consumeRateLimit(transaction: Transaction, key: string, now: number, maximum: number) {
  await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${key})) IS NULL AS locked`;
  const current = await transaction.rateLimit.findUnique({ where: { key } });
  if (!current) {
    await transaction.rateLimit.create({ data: { key, count: 1, lastRequest: BigInt(now) } });
    return;
  }
  if (BigInt(now) - current.lastRequest >= BigInt(WITHDRAWAL_RATE_LIMIT_WINDOW_MS)) {
    await transaction.rateLimit.update({ where: { key }, data: { count: 1, lastRequest: BigInt(now) } });
    return;
  }
  if (current.count >= maximum) {
    throw new WithdrawalServiceError("Trop de demandes ont été reçues. Réessayez plus tard.", 429, "RATE_LIMITED");
  }
  await transaction.rateLimit.update({ where: { key }, data: { count: { increment: 1 } } });
}

function safeClientAddress(value: string) {
  return value.replace(/[^0-9a-f:.]/gi, "").slice(0, 64) || "unknown";
}

async function resolveContract(transaction: Transaction, input: WithdrawalSubmission) {
  if (input.contractType === "MUSIC_ORDER") {
    const order = await transaction.order.findUnique({
      where: { orderNumber: input.orderNumber },
      select: { id: true, customerEmail: true, personalUseTermsVersion: true },
    });
    return order && order.customerEmail.trim().toLowerCase() === input.email
      ? { identityMatch: "MATCHED" as const, orderId: order.id, shopOrderId: null, termsVersion: order.personalUseTermsVersion }
      : { identityMatch: "UNMATCHED" as const, orderId: null, shopOrderId: null, termsVersion: null };
  }
  const shopOrder = await transaction.shopOrder.findUnique({
    where: { orderNumber: input.orderNumber },
    select: { id: true, termsVersion: true, user: { select: { email: true } } },
  });
  return shopOrder && shopOrder.user.email.trim().toLowerCase() === input.email
    ? { identityMatch: "MATCHED" as const, orderId: null, shopOrderId: shopOrder.id, termsVersion: shopOrder.termsVersion }
    : { identityMatch: "UNMATCHED" as const, orderId: null, shopOrderId: null, termsVersion: null };
}

export async function submitWithdrawalRequest(input: WithdrawalSubmission, clientAddress: string, now = new Date()) {
  assertDatabaseConfigured();
  const token = receiptToken();
  const publicReceiptTokenHash = tokenHash(token);
  const deduplicationHashSha256 = keyedHash("withdrawal-deduplication", `${input.contractType}\0${input.orderNumber}\0${input.email}`);
  const identityLimitKey = `withdrawal:identity:${keyedHash("withdrawal-rate-identity", `${input.orderNumber}\0${input.email}`)}`;
  const addressLimitKey = `withdrawal:address:${keyedHash("withdrawal-rate-address", safeClientAddress(clientAddress))}`;

  const result = await prisma.$transaction(async (transaction) => {
    await consumeRateLimit(transaction, identityLimitKey, now.getTime(), 5);
    await consumeRateLimit(transaction, addressLimitKey, now.getTime(), 20);
    await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`withdrawal:${deduplicationHashSha256}`})) IS NULL AS locked`;

    const existing = await transaction.consumerWithdrawalRequest.findUnique({ where: { deduplicationHashSha256 } });
    if (existing) {
      const refreshed = await transaction.consumerWithdrawalRequest.update({
        where: { id: existing.id },
        data: { publicReceiptTokenHash },
        select: { requestNumber: true, receivedAt: true },
      });
      return refreshed;
    }

    const contract = await resolveContract(transaction, input);
    const nextRequestNumber = requestNumber(now);
    const acknowledgementSnapshot = {
      requestNumber: nextRequestNumber,
      receivedAt: now.toISOString(),
      contractType: input.contractType,
      claimedOrderReference: input.orderNumber,
      claimantName: `${input.firstName} ${input.lastName}`,
      claimantEmail: input.email,
      productDescription: input.productDescription,
      quantity: input.quantity,
      declaration: WITHDRAWAL_DECLARATION,
      status: "RECEIVED",
      eligibility: "PENDING_REVIEW",
      professional: "Ludovic Mickaël Mathon — LNX Beats / LNX STUDIO",
      contact: "lnx.beats.pro@gmail.com",
    } satisfies Prisma.InputJsonObject;
    const acknowledgementHashSha256 = createHash("sha256").update(JSON.stringify(acknowledgementSnapshot), "utf8").digest("hex");

    return transaction.consumerWithdrawalRequest.create({
      data: {
        requestNumber: nextRequestNumber,
        publicReceiptTokenHash,
        deduplicationHashSha256,
        contractType: input.contractType,
        claimedOrderReference: input.orderNumber,
        ...contract,
        claimantFirstName: input.firstName,
        claimantLastName: input.lastName,
        claimantEmail: input.email,
        productDescription: input.productDescription,
        quantity: input.quantity,
        reason: input.reason,
        declarationText: WITHDRAWAL_DECLARATION,
        receivedAt: now,
        acknowledgementSnapshot,
        acknowledgementHashSha256,
        acknowledgementCreatedAt: now,
      },
      select: { requestNumber: true, receivedAt: true },
    });
  });

  return { ...result, receiptToken: token };
}

export async function getWithdrawalReceipt(token: string | undefined) {
  if (!token || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  assertDatabaseConfigured();
  return prisma.consumerWithdrawalRequest.findUnique({
    where: { publicReceiptTokenHash: tokenHash(token) },
    select: {
      requestNumber: true,
      receivedAt: true,
      contractType: true,
      claimedOrderReference: true,
      claimantFirstName: true,
      claimantLastName: true,
      claimantEmail: true,
      productDescription: true,
      quantity: true,
      declarationText: true,
      acknowledgementHashSha256: true,
    },
  });
}

export async function listMemberWithdrawalRequests(userId: string) {
  assertDatabaseConfigured();
  return prisma.consumerWithdrawalRequest.findMany({
    where: {
      OR: [
        { order: { userId } },
        { shopOrder: { userId } },
      ],
    },
    orderBy: [{ receivedAt: "desc" }, { requestNumber: "desc" }],
    select: {
      requestNumber: true,
      contractType: true,
      claimedOrderReference: true,
      receivedAt: true,
      status: true,
      eligibilityReview: true,
      acknowledgementHashSha256: true,
    },
  });
}
