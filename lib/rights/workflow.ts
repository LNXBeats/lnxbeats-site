import "server-only";

import { createHash, randomUUID } from "node:crypto";

import type {
  AiContributionAssessment,
  ContractDocumentKind,
  Prisma,
  RightsGrantKind,
  RightsRequestStatus,
} from "@/generated/prisma/client";
import { verifyPassword } from "@/lib/auth/password";
import { validateMediaStorageConfiguration } from "@/lib/media/storage/config";
import type { OrderActor } from "@/lib/orders/domain";
import { deletePrivateOrderFile, writePrivateOrderMedia } from "@/lib/orders/storage";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";
import { assertRightsSplit, canGenerateContractDraft, canStartRightsReview, isLegalTemplateUsable } from "@/lib/rights/domain";
import { buildRightsDocumentSections } from "@/lib/rights/document-presentation";
import { generateContractPdf } from "@/lib/rights/pdf";
import { defaultPrivateDocumentDependencies, RightsServiceError, type PreauthorizationDependencies } from "@/lib/rights/service";
import { validateContractTemplate } from "@/lib/rights/templates";

type Transaction = Prisma.TransactionClient;

type RightsWorkflowReader = Pick<
  typeof prisma,
  | "rightsRequest"
  | "order"
  | "user"
  | "contractPartySnapshot"
  | "rightsContribution"
  | "rightsGrant"
  | "rightsSplitProposal"
  | "contractDocument"
>;

const rightsDocumentGenerationQueues = new Map<string, Promise<void>>();

async function withLocalDocumentGenerationLock<T>(requestNumber: string, operation: () => Promise<T>) {
  const previous = rightsDocumentGenerationQueues.get(requestNumber) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.catch(() => undefined).then(() => current);
  rightsDocumentGenerationQueues.set(requestNumber, tail);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (rightsDocumentGenerationQueues.get(requestNumber) === tail) rightsDocumentGenerationQueues.delete(requestNumber);
  }
}

const aiAssessments = [
  "NOT_REVIEWED",
  "HUMAN_CONTRIBUTION_DOCUMENTED",
  "LEGAL_REVIEW_REQUIRED",
  "DECLARATION_NOT_RECOMMENDED",
  "POTENTIALLY_ELIGIBLE",
] as const satisfies readonly AiContributionAssessment[];

const grantKinds = [
  "PUBLICATION",
  "DISTRIBUTION",
  "PUBLIC_COMMUNICATION",
  "REPRODUCTION",
  "MONETIZATION",
  "ADAPTATION",
  "ADVERTISING",
  "AUDIOVISUAL_SYNCHRONIZATION",
  "CONTENT_ID",
  "SUBLICENSE",
  "CREDIT",
  "OTHER",
] as const satisfies readonly RightsGrantKind[];

const requestedFieldAllowlist = [
  "party",
  "project",
  "platforms",
  "territory",
  "duration",
  "contributions",
  "lyrics",
  "composition",
  "production",
  "aiContribution",
  "sacem",
  "credits",
] as const;

function cleanText(value: unknown, maximum: number, label: string, required = true) {
  if (typeof value !== "string") throw new RightsServiceError(`${label} est invalide.`, 400, "INVALID_RIGHTS_INPUT");
  const normalized = value.normalize("NFKC").trim();
  if ((required && !normalized) || normalized.length > maximum || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(normalized)) {
    throw new RightsServiceError(`${label} est invalide.`, 400, "INVALID_RIGHTS_INPUT");
  }
  return normalized;
}

function assertAdmin(actor: OrderActor) {
  if (actor.role !== "ADMIN" || actor.status !== "ACTIVE" || actor.emailVerified !== true) {
    throw new RightsServiceError("Accès administrateur requis.", 403, "ADMIN_REQUIRED");
  }
}

async function withWorkflowLock<T>(requestNumber: string, operation: (transaction: Transaction) => Promise<T>) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`rights:workflow:${requestNumber}`})) IS NULL AS locked`;
        return operation(transaction);
      }, { isolationLevel: "ReadCommitted" });
    } catch (error) {
      lastError = error;
      if (!error || typeof error !== "object" || !("code" in error) || (error.code !== "P2034" && error.code !== "P2002")) throw error;
    }
  }
  throw lastError;
}

async function adminRequest(database: RightsWorkflowReader, requestNumber: string) {
  const request = await database.rightsRequest.findUnique({ where: { requestNumber } });
  if (!request) throw new RightsServiceError("Cette demande est introuvable.", 404, "RIGHTS_REQUEST_NOT_FOUND");
  // Prisma's relation query loader may dispatch relation SELECTs concurrently.
  // Prisma Dev/PGlite exposes a single PostgreSQL wire connection, so a nested
  // include inside an interactive transaction can corrupt the unnamed prepared
  // statement. Keep every relation read explicitly sequential in all runtimes.
  const order = await database.order.findUniqueOrThrow({
    where: { id: request.orderId },
    select: { id: true, orderNumber: true, customerEmail: true },
  });
  const owner = await database.user.findUniqueOrThrow({
    where: { id: request.userId },
    select: { id: true, email: true, displayName: true },
  });
  const partySnapshots = await database.contractPartySnapshot.findMany({ where: { rightsRequestId: request.id }, orderBy: { version: "desc" } });
  const contributions = await database.rightsContribution.findMany({ where: { rightsRequestId: request.id }, orderBy: [{ position: "asc" }, { id: "asc" }] });
  const grants = await database.rightsGrant.findMany({ where: { rightsRequestId: request.id }, orderBy: [{ position: "asc" }, { id: "asc" }] });
  const splitProposals = await database.rightsSplitProposal.findMany({ where: { rightsRequestId: request.id }, orderBy: { version: "desc" } });
  const documents = await database.contractDocument.findMany({ where: { rightsRequestId: request.id }, orderBy: [{ kind: "asc" }, { documentVersion: "desc" }] });
  return { ...request, order, owner, partySnapshots, contributions, grants, splitProposals, documents };
}

function event(
  transaction: Transaction,
  input: { requestId: string; type: Prisma.RightsRequestEventUncheckedCreateInput["type"]; key: string; actorId: string; note: string },
) {
  return transaction.rightsRequestEvent.upsert({
    where: { idempotencyKey: input.key },
    update: {},
    create: {
      rightsRequestId: input.requestId,
      type: input.type,
      idempotencyKey: input.key,
      actorUserId: input.actorId,
      note: input.note,
    },
  });
}

function notification(
  transaction: Transaction,
  input: { orderId: string; kind: Prisma.OrderNotificationUncheckedCreateInput["kind"]; recipient: string | null; key: string },
) {
  return transaction.orderNotification.upsert({
    where: { idempotencyKey: input.key },
    update: {},
    create: { orderId: input.orderId, kind: input.kind, channel: "EMAIL", recipient: input.recipient, idempotencyKey: input.key },
  });
}

function workflowPayloadHash(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export async function startRightsReview(actor: OrderActor, requestNumber: string) {
  assertDatabaseConfigured();
  assertAdmin(actor);
  return withWorkflowLock(requestNumber, async (transaction) => {
    const request = await adminRequest(transaction, requestNumber);
    if (!canStartRightsReview(request.status) && request.status !== "UNDER_REVIEW") {
      throw new RightsServiceError("Cette demande ne peut pas être placée en étude.", 409, "RIGHTS_TRANSITION_FORBIDDEN");
    }
    if (request.status !== "UNDER_REVIEW") {
      await transaction.rightsRequest.update({ where: { id: request.id }, data: { status: "UNDER_REVIEW", reviewedAt: new Date(), needsInformationMessage: null } });
      await event(transaction, { requestId: request.id, type: "REVIEW_STARTED", key: `rights:${request.id}:review`, actorId: actor.id, note: "Étude manuelle ouverte par LNX Beats." });
    }
    return request.requestNumber;
  });
}

export async function requestRightsInformation(actor: OrderActor, requestNumber: string, rawMessage: unknown, rawFields: readonly unknown[]) {
  assertDatabaseConfigured();
  assertAdmin(actor);
  const message = cleanText(rawMessage, 4_000, "Le message");
  const fields = [...new Set(rawFields.map((field) => cleanText(field, 40, "Le champ demandé")))];
  if (!fields.length || fields.some((field) => !(requestedFieldAllowlist as readonly string[]).includes(field))) {
    throw new RightsServiceError("Sélectionnez des informations autorisées.", 400, "INVALID_REQUESTED_FIELDS");
  }
  return withWorkflowLock(requestNumber, async (transaction) => {
    const request = await adminRequest(transaction, requestNumber);
    if (["REJECTED", "CANCELLED", "READY_FOR_PAYMENT", "ACTIVE"].includes(request.status)) {
      throw new RightsServiceError("Cette demande ne peut plus être complétée.", 409, "RIGHTS_TRANSITION_FORBIDDEN");
    }
    const latest = await transaction.rightsMessage.findFirst({
      where: { rightsRequestId: request.id, kind: "ADMIN_REQUEST" },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    });
    const sameFields = latest && JSON.stringify(latest.requestedFields) === JSON.stringify(fields);
    if (request.status === "INFORMATION_REQUIRED" && latest?.body === message && sameFields) return request.requestNumber;
    const created = await transaction.rightsMessage.create({
      data: { rightsRequestId: request.id, kind: "ADMIN_REQUEST", authorUserId: actor.id, body: message, requestedFields: fields },
    });
    await transaction.rightsRequest.update({ where: { id: request.id }, data: { status: "INFORMATION_REQUIRED", needsInformationMessage: message } });
    await event(transaction, { requestId: request.id, type: "INFORMATION_REQUESTED", key: `rights:${request.id}:information:${created.id}`, actorId: actor.id, note: "Informations complémentaires demandées au client." });
    await notification(transaction, { orderId: request.orderId, kind: "CUSTOMER_RIGHTS_INFORMATION_REQUIRED", recipient: request.partySnapshots[0]?.contractEmail ?? request.owner.email, key: `rights:${request.id}:information:${created.id}:email` });
    return request.requestNumber;
  });
}

export async function respondRightsInformation(actor: OrderActor, requestNumber: string, rawMessage: unknown) {
  assertDatabaseConfigured();
  const message = cleanText(rawMessage, 6_000, "La réponse");
  return withWorkflowLock(requestNumber, async (transaction) => {
    const request = await transaction.rightsRequest.findFirst({ where: { requestNumber, userId: actor.id } });
    if (!request) throw new RightsServiceError("Cette demande est introuvable.", 404, "RIGHTS_REQUEST_NOT_FOUND");
    if (request.status !== "INFORMATION_REQUIRED") throw new RightsServiceError("Aucune information n’est demandée.", 409, "RIGHTS_TRANSITION_FORBIDDEN");
    const created = await transaction.rightsMessage.create({ data: { rightsRequestId: request.id, kind: "CLIENT_RESPONSE", authorUserId: actor.id, body: message } });
    await transaction.rightsRequest.update({ where: { id: request.id }, data: { status: "SUBMITTED", needsInformationMessage: null } });
    await event(transaction, { requestId: request.id, type: "INFORMATION_PROVIDED", key: `rights:${request.id}:response:${created.id}`, actorId: actor.id, note: "Le client a répondu à la demande de précision." });
    await notification(transaction, { orderId: request.orderId, kind: "OWNER_RIGHTS_REQUESTED", recipient: process.env.ADMIN_EMAIL?.trim().toLowerCase() || null, key: `rights:${request.id}:response:${created.id}:email` });
    return request.requestNumber;
  });
}

export async function rejectRightsRequest(actor: OrderActor, requestNumber: string, rawReason: unknown) {
  assertDatabaseConfigured();
  assertAdmin(actor);
  const reason = cleanText(rawReason, 4_000, "Le motif");
  return withWorkflowLock(requestNumber, async (transaction) => {
    const request = await adminRequest(transaction, requestNumber);
    if (["CLIENT_ACCEPTED", "ADMIN_VALIDATED", "READY_FOR_PAYMENT", "ACTIVE", "CANCELLED"].includes(request.status)) {
      throw new RightsServiceError("Cette demande ne peut pas être rejetée dans cet état.", 409, "RIGHTS_TRANSITION_FORBIDDEN");
    }
    await transaction.rightsRequest.update({ where: { id: request.id }, data: { status: "REJECTED", rejectedAt: new Date(), rejectionReason: reason } });
    await event(transaction, { requestId: request.id, type: "REQUEST_REJECTED", key: `rights:${request.id}:rejected`, actorId: actor.id, note: "Demande non retenue. Le motif est communiqué au client." });
    await notification(transaction, { orderId: request.orderId, kind: "CUSTOMER_RIGHTS_REJECTED", recipient: request.partySnapshots[0]?.contractEmail ?? request.owner.email, key: `rights:${request.id}:rejected:email` });
    return request.requestNumber;
  });
}

export async function updateAiContributionAssessment(actor: OrderActor, requestNumber: string, rawAssessment: unknown) {
  assertDatabaseConfigured();
  assertAdmin(actor);
  if (typeof rawAssessment !== "string" || !(aiAssessments as readonly string[]).includes(rawAssessment)) {
    throw new RightsServiceError("L’évaluation IA est invalide.", 400, "INVALID_AI_ASSESSMENT");
  }
  return withWorkflowLock(requestNumber, async (transaction) => {
    const request = await adminRequest(transaction, requestNumber);
    await transaction.rightsRequest.update({ where: { id: request.id }, data: { aiAssessment: rawAssessment as AiContributionAssessment } });
    await event(transaction, { requestId: request.id, type: "CONTRACT_PARAMETERS_UPDATED", key: `rights:${request.id}:ai:${rawAssessment}`, actorId: actor.id, note: "Évaluation interne de l’apport créatif mise à jour." });
    return request.requestNumber;
  });
}

export type RightsGrantInput = Readonly<{
  kind: RightsGrantKind;
  authorized: boolean;
  exclusive: boolean;
  destination: string;
  platforms: readonly string[];
  territory: string;
  duration: string;
  monetization: boolean;
  adaptation: boolean;
  advertising: boolean;
  audiovisualSync: boolean;
  contentId: boolean;
  sublicense: boolean;
  credit: string;
  restrictions: string;
}>;

export async function saveRightsGrant(actor: OrderActor, requestNumber: string, raw: RightsGrantInput) {
  assertDatabaseConfigured();
  assertAdmin(actor);
  if (!(grantKinds as readonly string[]).includes(raw.kind) || typeof raw.authorized !== "boolean" || typeof raw.exclusive !== "boolean") {
    throw new RightsServiceError("Le paramètre de droit est invalide.", 400, "INVALID_RIGHTS_GRANT");
  }
  const platforms = [...new Set(raw.platforms.map((item) => cleanText(item, 80, "La plateforme")))].slice(0, 30);
  const data = {
    authorized: raw.authorized,
    exclusive: raw.authorized && raw.exclusive,
    destination: cleanText(raw.destination, 2_000, "La destination", false) || null,
    platforms,
    territory: cleanText(raw.territory, 240, "Le territoire", false) || null,
    duration: cleanText(raw.duration, 240, "La durée", false) || null,
    monetization: raw.authorized && raw.monetization,
    adaptation: raw.authorized && raw.adaptation,
    advertising: raw.authorized && raw.advertising,
    audiovisualSync: raw.authorized && raw.audiovisualSync,
    contentId: raw.authorized && raw.contentId,
    sublicense: raw.authorized && raw.sublicense,
    credit: cleanText(raw.credit, 2_000, "Le crédit", false) || null,
    restrictions: cleanText(raw.restrictions, 4_000, "Les restrictions", false) || null,
  } as const;
  const payloadHash = workflowPayloadHash({ kind: raw.kind, ...data });
  return withWorkflowLock(requestNumber, async (transaction) => {
    const request = await adminRequest(transaction, requestNumber);
    if (!["UNDER_REVIEW", "PREAUTHORIZATION_GENERATED", "CONTRACT_PREPARATION", "CONTRACT_READY"].includes(request.status)) {
      throw new RightsServiceError("Les paramètres ne sont pas modifiables dans cet état.", 409, "RIGHTS_TRANSITION_FORBIDDEN");
    }
    await transaction.rightsGrant.upsert({
      where: { rightsRequestId_kind: { rightsRequestId: request.id, kind: raw.kind } },
      update: data,
      create: { rightsRequestId: request.id, kind: raw.kind, position: grantKinds.indexOf(raw.kind), ...data },
    });
    await transaction.rightsRequest.update({ where: { id: request.id }, data: { status: "CONTRACT_PREPARATION" } });
    await event(transaction, { requestId: request.id, type: "CONTRACT_PARAMETERS_UPDATED", key: `rights:${request.id}:grant:${raw.kind}:${payloadHash}`, actorId: actor.id, note: `Paramètre ${raw.kind} enregistré. Les droits non expressément autorisés restent non accordés.` });
    return request.requestNumber;
  });
}

export async function saveSplitProposal(actor: OrderActor, requestNumber: string, input: {
  clientSharePercent: number;
  lnxSharePercent: number;
  nature: unknown;
  comment: unknown;
  contributionRationale: unknown;
  proposedRoles: readonly unknown[];
}) {
  assertDatabaseConfigured();
  assertAdmin(actor);
  if (!assertRightsSplit(input.clientSharePercent, input.lnxSharePercent)) {
    throw new RightsServiceError("La proposition doit totaliser exactement 100 %.", 400, "INVALID_SPLIT");
  }
  const nature = cleanText(input.nature, 200, "La nature");
  const comment = cleanText(input.comment, 4_000, "Le commentaire", false);
  const rationale = cleanText(input.contributionRationale, 6_000, "La justification");
  const roles = [...new Set(input.proposedRoles.map((role) => cleanText(role, 80, "Le rôle")))].slice(0, 20);
  return withWorkflowLock(requestNumber, async (transaction) => {
    const request = await adminRequest(transaction, requestNumber);
    if (request.type !== "EXPLOITATION_PARTNERSHIP") throw new RightsServiceError("Une répartition n’est disponible que pour le partenariat.", 409, "SPLIT_NOT_APPLICABLE");
    const current = request.splitProposals[0];
    if (current
      && current.clientSharePercent === input.clientSharePercent
      && current.lnxSharePercent === input.lnxSharePercent
      && current.nature === nature
      && (current.comment ?? "") === comment
      && current.contributionRationale === rationale
      && JSON.stringify(current.proposedRoles) === JSON.stringify(roles)) return request.requestNumber;
    const latest = request.splitProposals[0]?.version ?? 0;
    await transaction.rightsSplitProposal.create({
      data: { rightsRequestId: request.id, version: latest + 1, clientSharePercent: input.clientSharePercent, lnxSharePercent: input.lnxSharePercent, nature, comment: comment || null, contributionRationale: rationale, proposedRoles: roles, proposedByAdminId: actor.id },
    });
    await event(transaction, { requestId: request.id, type: "CONTRACT_PARAMETERS_UPDATED", key: `rights:${request.id}:split:${latest + 1}`, actorId: actor.id, note: "Proposition commerciale enregistrée. Elle ne constitue pas une clé SACEM automatique." });
    return request.requestNumber;
  });
}

function contractSections(request: Awaited<ReturnType<typeof adminRequest>>, kind: ContractDocumentKind) {
  const party = request.partySnapshots[0];
  if (!party?.confirmedAt) throw new RightsServiceError("Les coordonnées doivent être confirmées.", 409, "CONTACT_NOT_CONFIRMED");
  return buildRightsDocumentSections({
    kind: kind === "SACEM_PREPARATION" ? "SACEM_PREPARATION" : "CONTRACT",
    requestType: request.type,
    workTitle: request.workTitle,
    orderNumber: request.order.orderNumber,
    requestedPriceCents: request.requestedPriceCents,
    formData: request.formData,
    party,
    grants: request.grants,
    contributions: request.contributions,
    splitProposal: request.splitProposals[0] ?? null,
    aiAssessment: request.aiAssessment,
  });
}

function sourceSnapshot(
  request: Awaited<ReturnType<typeof adminRequest>>,
  kind: ContractDocumentKind,
  template: { id: string; version: number; status: string; sourceMarkup: string },
  legalTemplateApproved: boolean,
) {
  return {
    kind,
    request: { id: request.id, requestNumber: request.requestNumber, orderNumber: request.order.orderNumber, type: request.type, priceCents: request.requestedPriceCents, currency: request.currency, workTitle: request.workTitle },
    party: request.partySnapshots[0],
    formData: request.formData,
    contributions: request.contributions,
    grants: request.grants,
    splitProposal: request.splitProposals[0] ?? null,
    aiAssessment: request.aiAssessment,
    template: { id: template.id, version: template.version, status: template.status, sourceMarkup: template.sourceMarkup },
    legalWarnings: { noRightsActive: true, noRightsPayment: true, noAutomaticSacem: true, legalReviewRequired: !legalTemplateApproved },
  };
}

export type RightsDocumentGenerationResult = Readonly<{
  requestNumber: string;
  documentVersion: number;
  documentStatus: "DRAFT" | "READY_FOR_CLIENT";
  duplicate: boolean;
  legalTemplateApproved: boolean;
}>;

export async function generateRightsDocument(
  actor: OrderActor,
  requestNumber: string,
  kind: "CONTRACT" | "SACEM_PREPARATION",
  expectedDocumentVersion?: number,
): Promise<RightsDocumentGenerationResult> {
  assertDatabaseConfigured();
  assertAdmin(actor);
  if (expectedDocumentVersion !== undefined && (!Number.isInteger(expectedDocumentVersion) || expectedDocumentVersion < 1)) {
    throw new RightsServiceError("La version de document attendue est invalide.", 400, "INVALID_DOCUMENT_VERSION");
  }
  return withLocalDocumentGenerationLock(requestNumber, async () => {
  const configuration = validateMediaStorageConfiguration();
  if (configuration.backend !== "OBJECT" || configuration.provider !== "r2") throw new RightsServiceError("Le stockage contractuel privé est indisponible.", 503, "CONTRACT_STORAGE_UNAVAILABLE");
  const request = await adminRequest(prisma, requestNumber);
  if (!["UNDER_REVIEW", "PREAUTHORIZATION_GENERATED", "CONTRACT_PREPARATION", "CONTRACT_READY", "CLIENT_ACCEPTED", "ADMIN_VALIDATED"].includes(request.status)) {
    throw new RightsServiceError("Le document ne peut pas être généré dans cet état.", 409, "RIGHTS_TRANSITION_FORBIDDEN");
  }
  if (kind === "CONTRACT" && !canGenerateContractDraft(request.status, request.grants.length)) {
    throw new RightsServiceError("Enregistrez au moins un paramètre structuré avant de préparer le contrat.", 409, "RIGHTS_PARAMETERS_REQUIRED");
  }
  if (!request.partySnapshots[0]?.confirmedAt) throw new RightsServiceError("Les coordonnées doivent être confirmées.", 409, "CONTACT_NOT_CONFIRMED");
  if (kind === "SACEM_PREPARATION" && (request.type !== "EXPLOITATION_PARTNERSHIP" || !["ADMIN_VALIDATED", "READY_FOR_PAYMENT"].includes(request.status))) {
    throw new RightsServiceError("La fiche SACEM reste réservée à un partenariat validé.", 409, "SACEM_PREPARATION_FORBIDDEN");
  }
  const templateType = kind === "SACEM_PREPARATION" ? "SACEM_PREPARATION" : request.type;
  const template = await prisma.contractTemplate.findFirst({ where: { type: templateType }, orderBy: { version: "desc" } });
  if (!template || template.status === "RETIRED") throw new RightsServiceError("Aucun modèle n’est disponible.", 503, "CONTRACT_TEMPLATE_UNAVAILABLE");
  if (!validateContractTemplate(template.sourceMarkup).ok) {
    throw new RightsServiceError("Le modèle contractuel est invalide et doit être corrigé.", 409, "CONTRACT_TEMPLATE_INVALID");
  }
  const legalTemplateApproved = isLegalTemplateUsable(template.status, template.approvedAt, template.approvedByAdminId, template.legalReviewReference);
  const previous = request.documents.find((document) => document.kind === kind) ?? null;
  const nextDocumentVersion = (previous?.documentVersion ?? 0) + 1;
  if (expectedDocumentVersion !== undefined) {
    const existing = request.documents.find((document) => document.kind === kind && document.documentVersion === expectedDocumentVersion);
    if (existing) return {
      requestNumber,
      documentVersion: existing.documentVersion,
      documentStatus: existing.status === "READY_FOR_CLIENT" ? "READY_FOR_CLIENT" : "DRAFT",
      duplicate: true,
      legalTemplateApproved,
    };
    if (expectedDocumentVersion !== nextDocumentVersion) {
      throw new RightsServiceError("La page n’est plus à jour. Rechargez la demande avant de générer une nouvelle version.", 409, "CONTRACT_VERSION_CHANGED");
    }
  }
  const documentVersion = expectedDocumentVersion ?? nextDocumentVersion;
  const suffix = kind === "CONTRACT" ? `C${String(documentVersion).padStart(2, "0")}` : `S${String(documentVersion).padStart(2, "0")}`;
  const contractNumber = `${request.requestNumber}-${suffix}`;
  const generatedAt = new Date();
  const sections = contractSections(request, kind);
  const pdf = await generateContractPdf({
    contractNumber,
    requestNumber: request.requestNumber,
    orderNumber: request.order.orderNumber,
    title: kind === "CONTRACT" ? `Conditions particulières - ${request.workTitle}` : `Fiche de préparation - ${request.workTitle}`,
    statusLabel: kind === "CONTRACT" ? "Projet de contrat - non actif" : "Préparation SACEM éventuelle - document privé Admin",
    templateVersion: template.version,
    generatedAt,
    legalTemplateApproved,
    kind,
    sections,
  });
  const storageKey = `orders/${request.orderId}/documents/${randomUUID()}.pdf`;
  const storedResult = await writePrivateOrderMedia({ storageKey, body: pdf.bytes, contentLength: pdf.bytes.length, contentType: "application/pdf", checksumSha256: pdf.sha256 });
  const stored = { ...storedResult, storageKey };
  if (stored.storageBackend !== "OBJECT" || stored.storageProvider !== "r2" || stored.visibility !== "PRIVATE") {
    await deletePrivateOrderFile(stored).catch(() => undefined);
    throw new RightsServiceError("Le stockage contractuel privé est indisponible.", 503, "CONTRACT_STORAGE_UNAVAILABLE");
  }
  try {
    const result = await withWorkflowLock(requestNumber, async (transaction) => {
      const current = await adminRequest(transaction, requestNumber);
      if (kind === "CONTRACT" && !canGenerateContractDraft(current.status, current.grants.length)) {
        throw new RightsServiceError("Enregistrez au moins un paramètre structuré avant de préparer le contrat.", 409, "RIGHTS_PARAMETERS_REQUIRED");
      }
      const currentPrevious = current.documents.find((document) => document.kind === kind) ?? null;
      const duplicate = current.documents.find((document) => document.kind === kind && document.documentVersion === documentVersion);
      if (duplicate) return { duplicate: true as const, documentStatus: duplicate.status === "READY_FOR_CLIENT" ? "READY_FOR_CLIENT" as const : "DRAFT" as const };
      const currentNextVersion = (currentPrevious?.documentVersion ?? 0) + 1;
      if (currentNextVersion !== documentVersion) {
        throw new RightsServiceError("La version du document a changé. Rechargez la demande.", 409, "CONTRACT_VERSION_CHANGED");
      }
      const persistedTemplate = await transaction.contractTemplate.findUnique({ where: { id: template.id } });
      if (
        !persistedTemplate
        || persistedTemplate.version !== template.version
        || persistedTemplate.status !== template.status
        || persistedTemplate.sourceMarkup !== template.sourceMarkup
        || persistedTemplate.approvedAt?.getTime() !== template.approvedAt?.getTime()
        || persistedTemplate.approvedByAdminId !== template.approvedByAdminId
        || persistedTemplate.legalReviewReference !== template.legalReviewReference
      ) {
        throw new RightsServiceError("Le modèle contractuel a changé. Relancez la génération depuis la fiche actualisée.", 409, "CONTRACT_TEMPLATE_CHANGED");
      }
      const documentStatus = kind === "CONTRACT" && legalTemplateApproved ? "READY_FOR_CLIENT" as const : "DRAFT" as const;
      const asset = await transaction.asset.create({
        data: { type: "DOCUMENT", storageKey, storageBackend: "OBJECT", storageProvider: "r2", visibility: "PRIVATE", checksumSha256: pdf.sha256, filename: `${contractNumber}.pdf`, mimeType: "application/pdf", sizeBytes: BigInt(pdf.bytes.length), rightsStatus: "RESTRICTED", rightsNote: "Document contractuel privé - propriétaire/Admin.", confidence: "CONFIRMED" },
      });
      await transaction.orderAsset.create({ data: { orderId: current.orderId, assetId: asset.id, role: "CONTRACT", position: documentVersion } });
      await transaction.contractDocument.create({
        data: { contractNumber, rightsRequestId: current.id, templateId: template.id, templateVersion: template.version, documentVersion, kind, status: documentStatus, generatedAt, priceSnapshotCents: current.requestedPriceCents, currency: current.currency, sourceSnapshot: JSON.parse(JSON.stringify(sourceSnapshot(current, kind, template, legalTemplateApproved))) as Prisma.InputJsonValue, documentHashSha256: pdf.sha256, assetId: asset.id, supersedesDocumentId: currentPrevious?.id ?? null },
      });
      // Prior versions and their metadata remain immutable. The new document
      // records its predecessor through supersedesDocumentId instead of
      // rewriting the earlier row.
      if (kind === "CONTRACT" && legalTemplateApproved) {
        await transaction.rightsRequest.update({ where: { id: current.id }, data: { status: "CONTRACT_READY" } });
        await notification(transaction, { orderId: current.orderId, kind: "CUSTOMER_RIGHTS_CONTRACT_READY", recipient: current.partySnapshots[0]?.contractEmail ?? current.owner.email, key: `rights:${current.id}:contract:${documentVersion}:email` });
      }
      await event(transaction, { requestId: current.id, type: currentPrevious ? "DOCUMENT_SUPERSEDED" : "DOCUMENT_GENERATED", key: `rights:${current.id}:${kind}:${documentVersion}`, actorId: actor.id, note: `${kind === "CONTRACT" ? "Projet de contrat" : "Fiche de préparation SACEM"} version ${documentVersion} généré ${legalTemplateApproved ? "pour revue client" : "en DRAFT filigrané"}, sans activation.` });
      return { duplicate: false as const, documentStatus };
    });
    if (result.duplicate) {
      await deletePrivateOrderFile(stored).catch(() => undefined);
    }
    return { requestNumber, documentVersion, documentStatus: result.documentStatus, duplicate: result.duplicate, legalTemplateApproved };
  } catch (error) {
    await deletePrivateOrderFile(stored).catch(() => undefined);
    throw error;
  }
  });
}

export async function approveContractTemplate(actor: OrderActor, templateId: string, rawReference: unknown) {
  assertDatabaseConfigured();
  assertAdmin(actor);
  const reference = cleanText(rawReference, 240, "La référence de revue juridique");
  const template = await prisma.contractTemplate.findUnique({ where: { id: templateId } });
  if (!template) throw new RightsServiceError("Le modèle est introuvable.", 404, "TEMPLATE_NOT_FOUND");
  if (template.status === "RETIRED") throw new RightsServiceError("Un modèle retiré ne peut pas être approuvé.", 409, "TEMPLATE_RETIRED");
  return prisma.contractTemplate.update({ where: { id: template.id }, data: { status: "APPROVED", approvedAt: new Date(), approvedByAdminId: actor.id, legalReviewReference: reference } });
}

export type ContractAcceptanceInput = Readonly<{
  typedFullName: unknown;
  password: unknown;
  accepted: unknown;
  sessionReferenceHash: string;
  userAgentHash: string | null;
}>;

export async function acceptRightsContract(
  actor: OrderActor,
  requestNumber: string,
  input: ContractAcceptanceInput,
  dependencies: PreauthorizationDependencies = defaultPrivateDocumentDependencies,
) {
  assertDatabaseConfigured();
  if (input.accepted !== true) throw new RightsServiceError("L’acceptation explicite est requise.", 400, "ACCEPTANCE_REQUIRED");
  const typedName = cleanText(input.typedFullName, 200, "Le nom complet");
  const password = cleanText(input.password, 128, "Le mot de passe");
  if (!/^[0-9a-f]{64}$/.test(input.sessionReferenceHash) || input.userAgentHash && !/^[0-9a-f]{64}$/.test(input.userAgentHash)) {
    throw new RightsServiceError("La preuve de session est invalide.", 400, "INVALID_SESSION_PROOF");
  }
  const credential = await prisma.account.findFirst({ where: { userId: actor.id, providerId: "credential" }, select: { password: true } });
  if (!credential?.password || !await verifyPassword(credential.password, password)) throw new RightsServiceError("Le mot de passe est incorrect.", 403, "REAUTHENTICATION_FAILED");
  const configuration = dependencies.validateStorage();
  if (configuration.backend !== "OBJECT" || configuration.provider !== "r2") throw new RightsServiceError("Le stockage contractuel privé est indisponible.", 503, "CONTRACT_STORAGE_UNAVAILABLE");
  const candidate = await adminRequest(prisma, requestNumber);
  if (candidate.owner.id !== actor.id) throw new RightsServiceError("Cette demande est introuvable.", 404, "RIGHTS_REQUEST_NOT_FOUND");
  const party = candidate.partySnapshots[0];
  const expectedName = party?.companyName || [party?.firstName, party?.lastName].filter(Boolean).join(" ");
  if (!party?.confirmedAt || typedName !== expectedName.normalize("NFKC").trim()) throw new RightsServiceError("Le nom saisi ne correspond pas aux coordonnées confirmées.", 400, "ACCEPTANCE_NAME_MISMATCH");
  const document = candidate.documents.find((item) => item.kind === "CONTRACT" && ["READY_FOR_CLIENT", "CLIENT_ACCEPTED", "ADMIN_VALIDATED"].includes(item.status));
  if (!document) throw new RightsServiceError("Aucun contrat n’est prêt.", 409, "CONTRACT_NOT_READY");
  const existing = await prisma.contractAcceptance.findUnique({ where: { contractDocumentId_kind: { contractDocumentId: document.id, kind: "CLIENT" } } });
  if (existing) return requestNumber;
  const template = await prisma.contractTemplate.findUnique({ where: { id: document.templateId } });
  if (!template) throw new RightsServiceError("Le modèle du contrat est introuvable.", 409, "CONTRACT_TEMPLATE_UNAVAILABLE");
  if (!isLegalTemplateUsable(template.status, template.approvedAt, template.approvedByAdminId, template.legalReviewReference)) {
    throw new RightsServiceError("Ce projet DRAFT ne peut pas être accepté avant la revue juridique du modèle.", 409, "LEGAL_REVIEW_REQUIRED");
  }
  const acceptedAt = new Date();
  const receiptNumber = `${document.contractNumber}-ACC`;
  const pdf = await generateContractPdf({
    contractNumber: receiptNumber,
    requestNumber: candidate.requestNumber,
    orderNumber: candidate.order.orderNumber,
    title: `Preuve d’acceptation - ${candidate.workTitle}`,
    statusLabel: "Acceptation électronique enregistrée - droits non actifs",
    templateVersion: document.templateVersion,
    generatedAt: acceptedAt,
    legalTemplateApproved: true,
    kind: "ACCEPTANCE_RECEIPT",
    sections: [
      { title: "Document accepté", paragraphs: [`Conditions particulières ${document.contractNumber}, version ${document.documentVersion}, modèle version ${document.templateVersion}.`, `Empreinte SHA-256 du document accepté : ${document.documentHashSha256}.`] },
      { title: "Identité et consentement", paragraphs: [`Acceptation enregistrée au nom de ${typedName}, depuis un compte authentifié dont l’e-mail est vérifié.`, `Acceptation explicite horodatée le ${acceptedAt.toISOString()}. Référence de session non sensible : ${input.sessionReferenceHash.slice(0, 12).toUpperCase()}.`] },
      ...contractSections(candidate, "CONTRACT"),
      { title: "Portée de la preuve", paragraphs: ["Cette preuve relie le compte, le consentement, la version du modèle et l’empreinte du document. Elle n’est pas présentée comme une signature électronique qualifiée.", "Aucun droit n’est actif et aucun paiement de droits n’est ouvert dans V0.7.2. Toute activation future exige les validations juridiques, administratives et techniques prévues."] },
    ],
  });
  const storageKey = `orders/${candidate.orderId}/documents/${randomUUID()}.pdf`;
  const stored = await dependencies.write({ storageKey, bytes: pdf.bytes, checksumSha256: pdf.sha256 });
  if (stored.storageBackend !== "OBJECT" || stored.storageProvider !== "r2" || stored.visibility !== "PRIVATE") {
    await dependencies.delete(stored).catch(() => undefined);
    throw new RightsServiceError("Le stockage contractuel privé est indisponible.", 503, "CONTRACT_STORAGE_UNAVAILABLE");
  }
  try {
    const result = await withWorkflowLock(requestNumber, async (transaction) => {
      const current = await adminRequest(transaction, requestNumber);
      if (current.owner.id !== actor.id) throw new RightsServiceError("Cette demande est introuvable.", 404, "RIGHTS_REQUEST_NOT_FOUND");
      const currentDocument = current.documents.find((item) => item.id === document.id && item.kind === "CONTRACT" && ["READY_FOR_CLIENT", "CLIENT_ACCEPTED", "ADMIN_VALIDATED"].includes(item.status));
      if (!currentDocument) throw new RightsServiceError("Le document a changé. Rechargez la page.", 409, "CONTRACT_VERSION_CHANGED");
      const currentTemplate = await transaction.contractTemplate.findUnique({ where: { id: currentDocument.templateId } });
      if (!currentTemplate || !isLegalTemplateUsable(currentTemplate.status, currentTemplate.approvedAt, currentTemplate.approvedByAdminId, currentTemplate.legalReviewReference)) {
        throw new RightsServiceError("Ce projet DRAFT ne peut pas être accepté avant la revue juridique du modèle.", 409, "LEGAL_REVIEW_REQUIRED");
      }
      const viewed = await transaction.rightsRequestEvent.findUnique({ where: { idempotencyKey: `rights:${current.id}:document:${currentDocument.id}:viewed:${actor.id}` }, select: { id: true } });
      if (!viewed) throw new RightsServiceError("Consultez le document intégral avant de l’accepter.", 409, "CONTRACT_NOT_VIEWED");
      const duplicate = await transaction.contractAcceptance.findUnique({ where: { contractDocumentId_kind: { contractDocumentId: currentDocument.id, kind: "CLIENT" } } });
      if (duplicate) return { duplicate: true as const };
      const asset = await transaction.asset.create({
        data: { type: "DOCUMENT", storageKey, storageBackend: "OBJECT", storageProvider: "r2", visibility: "PRIVATE", checksumSha256: pdf.sha256, filename: `${receiptNumber}.pdf`, mimeType: "application/pdf", sizeBytes: BigInt(pdf.bytes.length), rightsStatus: "RESTRICTED", rightsNote: "Preuve d’acceptation contractuelle privée - propriétaire/Admin.", confidence: "CONFIRMED" },
      });
      await transaction.orderAsset.create({ data: { orderId: current.orderId, assetId: asset.id, role: "CONTRACT", position: 10_000 + currentDocument.documentVersion } });
      await transaction.contractDocument.create({
        data: {
          contractNumber: receiptNumber,
          rightsRequestId: current.id,
          templateId: currentDocument.templateId,
          templateVersion: currentDocument.templateVersion,
          documentVersion: currentDocument.documentVersion,
          kind: "ACCEPTANCE_RECEIPT",
          status: "CLIENT_ACCEPTED",
          generatedAt: acceptedAt,
          acceptedAt,
          priceSnapshotCents: current.requestedPriceCents,
          currency: current.currency,
          sourceSnapshot: JSON.parse(JSON.stringify({ originalDocument: { id: currentDocument.id, contractNumber: currentDocument.contractNumber, hashSha256: currentDocument.documentHashSha256, sourceSnapshot: currentDocument.sourceSnapshot }, acceptance: { typedFullName: typedName, acceptedByUserId: actor.id, acceptedAt: acceptedAt.toISOString(), sessionReferenceHash: input.sessionReferenceHash, userAgentHash: input.userAgentHash }, legalWarnings: { noQualifiedSignatureClaim: true, noRightsActive: true, noRightsPayment: true } })) as Prisma.InputJsonValue,
          documentHashSha256: pdf.sha256,
          assetId: asset.id,
        },
      });
      await transaction.contractAcceptance.create({ data: { contractDocumentId: currentDocument.id, acceptedByUserId: actor.id, kind: "CLIENT", typedFullName: typedName, documentHashSha256: currentDocument.documentHashSha256, templateVersion: currentDocument.templateVersion, orderId: current.orderId, rightsRequestId: current.id, sessionReferenceHash: input.sessionReferenceHash, userAgentHash: input.userAgentHash, acceptedAt } });
      await transaction.contractDocument.update({ where: { id: currentDocument.id }, data: { status: "CLIENT_ACCEPTED", acceptedAt } });
      await transaction.rightsRequest.update({ where: { id: current.id }, data: { status: "CLIENT_ACCEPTED" } });
      await event(transaction, { requestId: current.id, type: "CLIENT_ACCEPTED", key: `rights:${current.id}:document:${currentDocument.id}:client-accepted`, actorId: actor.id, note: "Acceptation électronique QA enregistrée avec réauthentification, empreinte du document et PDF de preuve privé." });
      await notification(transaction, { orderId: current.orderId, kind: "OWNER_RIGHTS_CLIENT_ACCEPTED", recipient: process.env.ADMIN_EMAIL?.trim().toLowerCase() || null, key: `rights:${current.id}:client-accepted:email` });
      return { duplicate: false as const };
    });
    if (result.duplicate) await dependencies.delete(stored).catch(() => undefined);
    return requestNumber;
  } catch (error) {
    await dependencies.delete(stored).catch(() => undefined);
    throw error;
  }
}

export async function adminValidateRightsContract(actor: OrderActor, requestNumber: string, rawName: unknown, accepted: unknown) {
  assertDatabaseConfigured();
  assertAdmin(actor);
  if (accepted !== true) throw new RightsServiceError("La validation explicite est requise.", 400, "ADMIN_ACCEPTANCE_REQUIRED");
  const typedName = cleanText(rawName, 200, "Le nom complet");
  return withWorkflowLock(requestNumber, async (transaction) => {
    const request = await adminRequest(transaction, requestNumber);
    if (request.status !== "CLIENT_ACCEPTED") throw new RightsServiceError("L’acceptation client est requise.", 409, "CLIENT_ACCEPTANCE_REQUIRED");
    const document = request.documents.find((candidate) => candidate.kind === "CONTRACT" && candidate.status === "CLIENT_ACCEPTED");
    if (!document) throw new RightsServiceError("Le contrat accepté est introuvable.", 409, "CONTRACT_NOT_READY");
    const template = await transaction.contractTemplate.findUnique({ where: { id: document.templateId } });
    if (!template || !isLegalTemplateUsable(template.status, template.approvedAt, template.approvedByAdminId, template.legalReviewReference)) {
      throw new RightsServiceError("La validation juridique du modèle est requise.", 409, "LEGAL_REVIEW_REQUIRED");
    }
    const existing = await transaction.contractAcceptance.findUnique({ where: { contractDocumentId_kind: { contractDocumentId: document.id, kind: "ADMIN" } } });
    if (!existing) {
      const now = new Date();
      await transaction.contractAcceptance.create({ data: { contractDocumentId: document.id, acceptedByUserId: actor.id, kind: "ADMIN", typedFullName: typedName, documentHashSha256: document.documentHashSha256, templateVersion: document.templateVersion, orderId: request.orderId, rightsRequestId: request.id, sessionReferenceHash: createHash("sha256").update(`admin:${actor.id}:${document.id}`).digest("hex"), acceptedAt: now } });
      await transaction.contractDocument.update({ where: { id: document.id }, data: { status: "ADMIN_VALIDATED", adminAcceptedAt: now } });
      await transaction.rightsRequest.update({ where: { id: request.id }, data: { status: "READY_FOR_PAYMENT", approvedAt: now } });
      await event(transaction, { requestId: request.id, type: "ADMIN_VALIDATED", key: `rights:${request.id}:document:${document.id}:admin-validated`, actorId: actor.id, note: "Double validation enregistrée. Aucun paiement ni droit actif n’est créé." });
      await event(transaction, { requestId: request.id, type: "READY_FOR_PAYMENT", key: `rights:${request.id}:ready-for-future-payment`, actorId: actor.id, note: "Dossier prêt pour une future étape de paiement, actuellement désactivée." });
      await notification(transaction, { orderId: request.orderId, kind: "CUSTOMER_RIGHTS_READY_FOR_PAYMENT", recipient: request.partySnapshots[0]?.contractEmail ?? request.owner.email, key: `rights:${request.id}:ready-for-payment:email` });
    }
    return request.requestNumber;
  });
}

export function acceptanceRequestProof(cookieHeader: string, userAgent: string | null) {
  return {
    sessionReferenceHash: createHash("sha256").update(cookieHeader || "missing-cookie", "utf8").digest("hex"),
    userAgentHash: userAgent ? createHash("sha256").update(userAgent.slice(0, 500), "utf8").digest("hex") : null,
  };
}

export async function listAdminRightsCases(input: { type?: string; status?: string; query?: string } = {}) {
  assertDatabaseConfigured();
  const type = ["PUBLICATION_LICENSE", "EXPLOITATION_PARTNERSHIP"].includes(input.type ?? "") ? input.type as "PUBLICATION_LICENSE" | "EXPLOITATION_PARTNERSHIP" : undefined;
  const statuses: RightsRequestStatus[] = ["DRAFT", "SUBMITTED", "INFORMATION_REQUIRED", "UNDER_REVIEW", "PREAUTHORIZATION_GENERATED", "CONTRACT_PREPARATION", "CONTRACT_READY", "CLIENT_ACCEPTED", "ADMIN_VALIDATED", "READY_FOR_PAYMENT", "REJECTED", "CANCELLED", "ACTIVE"];
  const status = statuses.includes(input.status as RightsRequestStatus) ? input.status as RightsRequestStatus : undefined;
  const query = input.query?.normalize("NFKC").trim().slice(0, 120);
  return prisma.rightsRequest.findMany({
    where: {
      ...(type ? { type } : {}),
      ...(status ? { status } : {}),
      ...(query ? { OR: [
        { requestNumber: { contains: query, mode: "insensitive" } },
        { workTitle: { contains: query, mode: "insensitive" } },
        { order: { orderNumber: { contains: query, mode: "insensitive" } } },
        { owner: { displayName: { contains: query, mode: "insensitive" } } },
      ] } : {}),
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take: 200,
    select: {
      requestNumber: true,
      type: true,
      status: true,
      workTitle: true,
      requestedPriceCents: true,
      currency: true,
      createdAt: true,
      updatedAt: true,
      order: { select: { orderNumber: true, priorityProcessing: true } },
      owner: { select: { displayName: true, email: true } },
      _count: { select: { documents: true, messages: true } },
    },
  });
}

export async function getAdminRightsCase(requestNumber: string) {
  assertDatabaseConfigured();
  return prisma.rightsRequest.findUnique({
    where: { requestNumber },
    include: {
      order: {
        include: {
          payments: { where: { status: "SUCCEEDED" }, select: { id: true, amountCents: true, currency: true, paidAt: true } },
          assets: { where: { role: "DELIVERY" }, select: { asset: { select: { id: true, filename: true, mimeType: true, sizeBytes: true } } } },
          notifications: { orderBy: { createdAt: "desc" }, take: 30 },
        },
      },
      owner: { select: { id: true, displayName: true, email: true, status: true, emailVerified: true } },
      partySnapshots: { orderBy: { version: "desc" } },
      contributions: { orderBy: [{ position: "asc" }, { id: "asc" }] },
      grants: { orderBy: [{ position: "asc" }, { id: "asc" }] },
      splitProposals: { orderBy: { version: "desc" }, include: { proposedBy: { select: { displayName: true } } } },
      documents: { orderBy: [{ generatedAt: "desc" }, { id: "desc" }], include: { template: true, acceptances: { include: { acceptedBy: { select: { displayName: true, role: true } } } } } },
      events: { orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: { actor: { select: { displayName: true } } } },
      messages: { orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
    },
  });
}

export function listContractTemplates() {
  assertDatabaseConfigured();
  return prisma.contractTemplate.findMany({ orderBy: [{ type: "asc" }, { version: "desc" }], include: { approvedBy: { select: { displayName: true } }, _count: { select: { documents: true } } } });
}
