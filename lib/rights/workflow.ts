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
import { assertRightsSplit } from "@/lib/rights/domain";
import { generateContractPdf } from "@/lib/rights/pdf";
import { defaultPrivateDocumentDependencies, RightsServiceError, type PreauthorizationDependencies } from "@/lib/rights/service";

type Transaction = Prisma.TransactionClient;

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

async function adminRequest(transaction: Transaction, requestNumber: string) {
  const request = await transaction.rightsRequest.findUnique({
    where: { requestNumber },
    include: {
      order: { select: { id: true, orderNumber: true, customerEmail: true } },
      owner: { select: { id: true, email: true, displayName: true } },
      partySnapshots: { orderBy: { version: "desc" } },
      contributions: { orderBy: [{ position: "asc" }, { id: "asc" }] },
      grants: { orderBy: [{ position: "asc" }, { id: "asc" }] },
      splitProposals: { orderBy: { version: "desc" } },
      documents: { orderBy: [{ kind: "asc" }, { documentVersion: "desc" }] },
    },
  });
  if (!request) throw new RightsServiceError("Cette demande est introuvable.", 404, "RIGHTS_REQUEST_NOT_FOUND");
  return request;
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
    if (!["SUBMITTED", "PREAUTHORIZATION_GENERATED", "INFORMATION_REQUIRED", "UNDER_REVIEW"].includes(request.status)) {
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
    const request = await transaction.rightsRequest.findFirst({ where: { requestNumber, userId: actor.id }, include: { owner: { select: { email: true } } } });
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

function jsonRecord(value: Prisma.JsonValue): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function textFrom(value: unknown, fallback = "À définir") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function contractSections(request: Awaited<ReturnType<typeof adminRequest>>, kind: ContractDocumentKind) {
  const party = request.partySnapshots[0];
  if (!party?.confirmedAt) throw new RightsServiceError("Les coordonnées doivent être confirmées.", 409, "CONTACT_NOT_CONFIRMED");
  const form = jsonRecord(request.formData);
  const project = jsonRecord((form.project ?? {}) as Prisma.JsonValue);
  const split = request.splitProposals[0];
  const grants = request.grants.map((grant) => `${grant.kind} : ${grant.authorized ? "autorisé" : "non accordé"}${grant.authorized ? ` ; ${grant.exclusive ? "exclusif" : "non exclusif"} ; ${grant.territory || "territoire à définir"} ; ${grant.duration || "durée à définir"}` : ""}. ${grant.restrictions || ""}`);
  if (kind === "SACEM_PREPARATION") {
    return [
      { title: "Nature du document", paragraphs: ["FICHE DE PRÉPARATION - DÉCLARATION ÉVENTUELLE. Ce document n’est pas une déclaration SACEM et n’est envoyé automatiquement à aucun organisme."] },
      { title: "Œuvre et parties", paragraphs: [`Création : ${request.workTitle}. Client : ${party.companyName || [party.firstName, party.lastName].filter(Boolean).join(" ")}.`] },
      { title: "Contributions et rôles envisagés", paragraphs: request.contributions.map((item) => `${item.kind} : ${item.description}`) },
      { title: "Proposition commerciale", paragraphs: [split ? `${split.clientSharePercent} % client / ${split.lnxSharePercent} % LNX Beats. ${split.contributionRationale}` : "Aucune proposition validée.", "Cette proposition n’est pas automatiquement une clé de répartition SACEM."] },
      { title: "Éligibilité interne", paragraphs: [`Évaluation : ${request.aiAssessment}. Points à vérifier juridiquement avant toute déclaration.`] },
    ];
  }
  return [
    { title: "Parties et œuvre concernée", paragraphs: [`LNX Beats et ${party.companyName || [party.firstName, party.lastName].filter(Boolean).join(" ")}, ${party.streetAddress}, ${party.postalCode} ${party.city}, ${party.country}.`, `Œuvre : ${request.workTitle}. Commande ${request.order.orderNumber}.`] },
    { title: "Objet et destination", paragraphs: [`Offre : ${request.type === "PUBLICATION_LICENSE" ? "licence de publication" : "partenariat d’exploitation"}. Nom de publication : ${textFrom(project.publicationName)}. Distributeur : ${textFrom(project.distributor)}.`] },
    { title: "Droits expressément paramétrés", paragraphs: grants.length ? grants : ["Aucun droit n’est expressément accordé dans ce projet. Les droits non listés restent non accordés."] },
    { title: "Territoire, durée et supports", paragraphs: [`Territoire : ${textFrom(project.territory)}. Durée : ${textFrom(project.duration)}. Plateformes/supports : ${Array.isArray(project.platforms) ? project.platforms.join(", ") : "À définir"}.`] },
    { title: "Rémunération et état", paragraphs: [`Montant cible futur : ${(request.requestedPriceCents / 100).toLocaleString("fr-FR")} €. Aucun paiement de droits n’est ouvert dans cette version. Aucun droit n’est actif.`] },
    { title: "Contributions, crédits et garanties", paragraphs: request.contributions.map((item) => `${item.kind} : ${item.description}${item.claimedPercentage === null ? "" : ` (${item.claimedPercentage} % revendiqués par le client)`}. Cette déclaration reste à vérifier.`) },
    { title: "SACEM et gestion collective", paragraphs: ["Ce document ne transfère ni la qualité d’auteur, ni les droits moraux, ni une quote-part SACEM. Une proposition entre les parties n’est pas une répartition SACEM automatique.", request.type === "EXPLOITATION_PARTNERSHIP" && split ? `Proposition commerciale : ${split.clientSharePercent} % client / ${split.lnxSharePercent} % LNX Beats, sous réserve d’étude et de validation.` : "Aucune répartition n’est promise."] },
    { title: "Rétractation, entrée en vigueur et limites", paragraphs: ["Les règles de rétractation et de commencement anticipé sont en attente de validation juridique. Aucune renonciation n’est précochée.", "Une acceptation QA ne suffit pas à activer les droits : un modèle juridiquement approuvé, une validation Admin, un futur paiement confirmé, l’absence d’anomalie et une date d’entrée en vigueur seront nécessaires."] },
  ];
}

function sourceSnapshot(request: Awaited<ReturnType<typeof adminRequest>>, kind: ContractDocumentKind, template: { id: string; version: number; status: string; sourceMarkup: string }) {
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
    legalWarnings: { noRightsActive: true, noRightsPayment: true, noAutomaticSacem: true, legalReviewRequired: template.status !== "APPROVED" },
  };
}

export async function generateRightsDocument(actor: OrderActor, requestNumber: string, kind: "CONTRACT" | "SACEM_PREPARATION") {
  assertDatabaseConfigured();
  assertAdmin(actor);
  const configuration = validateMediaStorageConfiguration();
  if (configuration.backend !== "OBJECT" || configuration.provider !== "r2") throw new RightsServiceError("Le stockage contractuel privé est indisponible.", 503, "CONTRACT_STORAGE_UNAVAILABLE");
  const request = await prisma.$transaction((transaction) => adminRequest(transaction, requestNumber));
  if (!["UNDER_REVIEW", "PREAUTHORIZATION_GENERATED", "CONTRACT_PREPARATION", "CONTRACT_READY", "CLIENT_ACCEPTED", "ADMIN_VALIDATED"].includes(request.status)) {
    throw new RightsServiceError("Le document ne peut pas être généré dans cet état.", 409, "RIGHTS_TRANSITION_FORBIDDEN");
  }
  if (kind === "SACEM_PREPARATION" && (request.type !== "EXPLOITATION_PARTNERSHIP" || !["ADMIN_VALIDATED", "READY_FOR_PAYMENT"].includes(request.status))) {
    throw new RightsServiceError("La fiche SACEM reste réservée à un partenariat validé.", 409, "SACEM_PREPARATION_FORBIDDEN");
  }
  const templateType = kind === "SACEM_PREPARATION" ? "SACEM_PREPARATION" : request.type;
  const template = await prisma.contractTemplate.findFirst({ where: { type: templateType }, orderBy: { version: "desc" } });
  if (!template || template.status === "RETIRED") throw new RightsServiceError("Aucun modèle n’est disponible.", 503, "CONTRACT_TEMPLATE_UNAVAILABLE");
  const previous = request.documents.find((document) => document.kind === kind) ?? null;
  const documentVersion = (previous?.documentVersion ?? 0) + 1;
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
    legalTemplateApproved: template.status === "APPROVED",
    kind,
    sections,
  });
  const storageKey = `contracts/${request.id}/${randomUUID()}.pdf`;
  const storedResult = await writePrivateOrderMedia({ storageKey, body: pdf.bytes, contentLength: pdf.bytes.length, contentType: "application/pdf", checksumSha256: pdf.sha256 });
  const stored = { ...storedResult, storageKey };
  if (stored.storageBackend !== "OBJECT" || stored.storageProvider !== "r2" || stored.visibility !== "PRIVATE") {
    await deletePrivateOrderFile(stored).catch(() => undefined);
    throw new RightsServiceError("Le stockage contractuel privé est indisponible.", 503, "CONTRACT_STORAGE_UNAVAILABLE");
  }
  try {
    const result = await withWorkflowLock(requestNumber, async (transaction) => {
      const current = await adminRequest(transaction, requestNumber);
      const currentPrevious = current.documents.find((document) => document.kind === kind) ?? null;
      const expectedVersion = (currentPrevious?.documentVersion ?? 0) + 1;
      if (expectedVersion !== documentVersion) return { duplicate: true as const };
      const asset = await transaction.asset.create({
        data: { type: "DOCUMENT", storageKey, storageBackend: "OBJECT", storageProvider: "r2", visibility: "PRIVATE", checksumSha256: pdf.sha256, filename: `${contractNumber}.pdf`, mimeType: "application/pdf", sizeBytes: BigInt(pdf.bytes.length), rightsStatus: "RESTRICTED", rightsNote: "Document contractuel privé - propriétaire/Admin.", confidence: "CONFIRMED" },
      });
      await transaction.orderAsset.create({ data: { orderId: current.orderId, assetId: asset.id, role: "CONTRACT", position: documentVersion } });
      await transaction.contractDocument.create({
        data: { contractNumber, rightsRequestId: current.id, templateId: template.id, templateVersion: template.version, documentVersion, kind, status: kind === "CONTRACT" ? "READY_FOR_CLIENT" : "DRAFT", generatedAt, priceSnapshotCents: current.requestedPriceCents, currency: current.currency, sourceSnapshot: JSON.parse(JSON.stringify(sourceSnapshot(current, kind, template))) as Prisma.InputJsonValue, documentHashSha256: pdf.sha256, assetId: asset.id, supersedesDocumentId: currentPrevious?.id ?? null },
      });
      if (currentPrevious && !["ACTIVE", "SUPERSEDED"].includes(currentPrevious.status)) await transaction.contractDocument.update({ where: { id: currentPrevious.id }, data: { status: "SUPERSEDED" } });
      if (kind === "CONTRACT") {
        await transaction.rightsRequest.update({ where: { id: current.id }, data: { status: "CONTRACT_READY" } });
        await notification(transaction, { orderId: current.orderId, kind: "CUSTOMER_RIGHTS_CONTRACT_READY", recipient: current.partySnapshots[0]?.contractEmail ?? current.owner.email, key: `rights:${current.id}:contract:${documentVersion}:email` });
      }
      await event(transaction, { requestId: current.id, type: currentPrevious ? "DOCUMENT_SUPERSEDED" : "DOCUMENT_GENERATED", key: `rights:${current.id}:${kind}:${documentVersion}`, actorId: actor.id, note: `${kind === "CONTRACT" ? "Projet de contrat" : "Fiche de préparation SACEM"} version ${documentVersion} généré sans activation.` });
      return { duplicate: false as const };
    });
    if (result.duplicate) {
      await deletePrivateOrderFile(stored).catch(() => undefined);
      return requestNumber;
    }
    return requestNumber;
  } catch (error) {
    await deletePrivateOrderFile(stored).catch(() => undefined);
    throw error;
  }
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
  const candidate = await prisma.$transaction((transaction) => adminRequest(transaction, requestNumber));
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
    legalTemplateApproved: template.status === "APPROVED",
    kind: "ACCEPTANCE_RECEIPT",
    sections: [
      { title: "Document accepté", paragraphs: [`Conditions particulières ${document.contractNumber}, version ${document.documentVersion}, modèle version ${document.templateVersion}.`, `Empreinte SHA-256 du document accepté : ${document.documentHashSha256}.`] },
      { title: "Identité et consentement", paragraphs: [`Acceptation enregistrée au nom de ${typedName}, depuis un compte authentifié dont l’e-mail est vérifié.`, `Acceptation explicite horodatée le ${acceptedAt.toISOString()}. Référence de session non sensible : ${input.sessionReferenceHash.slice(0, 12).toUpperCase()}.`] },
      ...contractSections(candidate, "CONTRACT"),
      { title: "Portée de la preuve", paragraphs: ["Cette preuve relie le compte, le consentement, la version du modèle et l’empreinte du document. Elle n’est pas présentée comme une signature électronique qualifiée.", "Aucun droit n’est actif et aucun paiement de droits n’est ouvert dans V0.7.2. Toute activation future exige les validations juridiques, administratives et techniques prévues."] },
    ],
  });
  const storageKey = `contracts/${candidate.id}/${randomUUID()}.pdf`;
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
