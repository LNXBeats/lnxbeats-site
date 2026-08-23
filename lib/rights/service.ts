import "server-only";

import { randomUUID } from "node:crypto";

import type { Prisma, RightsRequestType } from "@/generated/prisma/client";

import { rightsFormVersion } from "@/data/rights-offer";
import { validateMediaStorageConfiguration } from "@/lib/media/storage/config";
import { canReadOrderMedia } from "@/lib/media/authorization";
import type { OrderActor } from "@/lib/orders/domain";
import { deletePrivateOrderFile, writePrivateOrderMedia } from "@/lib/orders/storage";
import { enqueueOrderNotification } from "@/lib/notifications/service";
import { assertDatabaseConfigured, prisma } from "@/lib/prisma";
import { activeRightsStatuses, canCreateRightsRequest, formatRightsNumber, rightsPriceSnapshot } from "@/lib/rights/domain";
import { buildRightsDocumentSections, formatRightsCurrency, humanRightsContribution, humanRightsPlatform } from "@/lib/rights/document-presentation";
import type { RightsDraftInput } from "@/lib/rights/input";
import { generateContractPdf } from "@/lib/rights/pdf";
import type { SerializedRightsRequest } from "@/lib/rights/types";

type Transaction = Prisma.TransactionClient;

const rightsConfirmationQueues = new Map<string, Promise<void>>();

async function withLocalConfirmationLock<T>(requestNumber: string, operation: () => Promise<T>) {
  const previous = rightsConfirmationQueues.get(requestNumber) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.catch(() => undefined).then(() => current);
  rightsConfirmationQueues.set(requestNumber, tail);
  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (rightsConfirmationQueues.get(requestNumber) === tail) rightsConfirmationQueues.delete(requestNumber);
  }
}

export class RightsServiceError extends Error {
  constructor(message: string, readonly status: number, readonly code: string) {
    super(message);
    this.name = "RightsServiceError";
  }
}

const requestInclude = {
  order: { select: { id: true, orderNumber: true, userId: true, status: true, customerEmail: true } },
  partySnapshots: { orderBy: { version: "desc" as const } },
  contributions: { orderBy: [{ position: "asc" as const }, { id: "asc" as const }] },
  grants: { orderBy: [{ position: "asc" as const }, { id: "asc" as const }] },
  splitProposals: { orderBy: { version: "desc" as const } },
  documents: {
    orderBy: [{ documentVersion: "desc" as const }, { generatedAt: "desc" as const }],
    select: {
      id: true,
      contractNumber: true,
      documentVersion: true,
      templateVersion: true,
      kind: true,
      status: true,
      generatedAt: true,
      acceptedAt: true,
      adminAcceptedAt: true,
      retentionUntil: true,
      documentHashSha256: true,
    },
  },
  events: { orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }] },
  messages: { orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }] },
} satisfies Prisma.RightsRequestInclude;

type RequestWithRelations = Prisma.RightsRequestGetPayload<{ include: typeof requestInclude }>;

type RightsReader = Pick<
  typeof prisma,
  | "rightsRequest"
  | "order"
  | "contractPartySnapshot"
  | "rightsContribution"
  | "rightsGrant"
  | "rightsSplitProposal"
  | "contractDocument"
  | "rightsRequestEvent"
  | "rightsMessage"
>;

async function findRequestWithRelations(database: RightsReader, where: Prisma.RightsRequestWhereInput) {
  const request = await database.rightsRequest.findFirst({ where });
  if (!request) return null;
  // Prisma's query relation loader can fan several SELECTs out concurrently.
  // That is unsafe on the single PostgreSQL wire connection used by Prisma Dev
  // transactions, so the confirmation path deliberately loads each relation in
  // sequence. Production keeps the same deterministic behavior.
  const order = await database.order.findUniqueOrThrow({
    where: { id: request.orderId },
    select: { id: true, orderNumber: true, userId: true, status: true, customerEmail: true },
  });
  const partySnapshots = await database.contractPartySnapshot.findMany({ where: { rightsRequestId: request.id }, orderBy: { version: "desc" } });
  const contributions = await database.rightsContribution.findMany({ where: { rightsRequestId: request.id }, orderBy: [{ position: "asc" }, { id: "asc" }] });
  const grants = await database.rightsGrant.findMany({ where: { rightsRequestId: request.id }, orderBy: [{ position: "asc" }, { id: "asc" }] });
  const splitProposals = await database.rightsSplitProposal.findMany({ where: { rightsRequestId: request.id }, orderBy: { version: "desc" } });
  const documents = await database.contractDocument.findMany({
    where: { rightsRequestId: request.id },
    orderBy: [{ documentVersion: "desc" }, { generatedAt: "desc" }],
    select: requestInclude.documents.select,
  });
  const events = await database.rightsRequestEvent.findMany({ where: { rightsRequestId: request.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const messages = await database.rightsMessage.findMany({ where: { rightsRequestId: request.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  return { ...request, order, partySnapshots, contributions, grants, splitProposals, documents, events, messages } as RequestWithRelations;
}

export function serializeRightsRequest(request: RequestWithRelations): SerializedRightsRequest {
  const party = request.partySnapshots[0] ?? null;
  const split = request.splitProposals[0] ?? null;
  return {
    requestNumber: request.requestNumber,
    orderNumber: request.order.orderNumber,
    type: request.type,
    status: request.status,
    requestedPriceCents: request.requestedPriceCents,
    currency: request.currency,
    pricingVersion: request.pricingVersion,
    workTitle: request.workTitle,
    artistName: request.artistName ?? "",
    formData: request.formData,
    aiAssessment: request.aiAssessment,
    submittedAt: request.submittedAt?.toISOString() ?? null,
    reviewedAt: request.reviewedAt?.toISOString() ?? null,
    rejectedAt: request.rejectedAt?.toISOString() ?? null,
    rejectionReason: request.rejectionReason ?? "",
    needsInformationMessage: request.needsInformationMessage ?? "",
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
    party: party ? {
      version: party.version,
      partyType: party.partyType,
      firstName: party.firstName ?? "",
      lastName: party.lastName ?? "",
      artistName: party.artistName ?? "",
      companyName: party.companyName ?? "",
      legalForm: party.legalForm ?? "",
      legalRepresentative: party.legalRepresentative ?? "",
      streetAddress: party.streetAddress,
      postalCode: party.postalCode,
      city: party.city,
      country: party.country,
      siret: party.siret ?? "",
      vatNumber: party.vatNumber ?? "",
      contractEmail: party.contractEmail,
      phone: party.phone ?? "",
      confirmedAt: party.confirmedAt?.toISOString() ?? null,
    } : null,
    contributions: request.contributions.map((contribution) => ({
      kind: contribution.kind,
      description: contribution.description,
      claimedPercentage: contribution.claimedPercentage,
      evidenceNote: contribution.evidenceNote ?? "",
    })),
    grants: request.grants.map((grant) => ({
      kind: grant.kind,
      authorized: grant.authorized,
      exclusive: grant.exclusive,
      destination: grant.destination ?? "",
      platforms: Array.isArray(grant.platforms) ? grant.platforms.filter((item): item is string => typeof item === "string") : [],
      territory: grant.territory ?? "",
      duration: grant.duration ?? "",
      monetization: grant.monetization,
      adaptation: grant.adaptation,
      advertising: grant.advertising,
      audiovisualSync: grant.audiovisualSync,
      contentId: grant.contentId,
      sublicense: grant.sublicense,
      credit: grant.credit ?? "",
      restrictions: grant.restrictions ?? "",
    })),
    splitProposal: split ? {
      version: split.version,
      clientSharePercent: split.clientSharePercent,
      lnxSharePercent: split.lnxSharePercent,
      nature: split.nature,
      comment: split.comment ?? "",
      contributionRationale: split.contributionRationale,
      proposedRoles: split.proposedRoles,
    } : null,
    documents: request.documents.map((document) => ({
      id: document.id,
      contractNumber: document.contractNumber,
      documentVersion: document.documentVersion,
      templateVersion: document.templateVersion,
      kind: document.kind,
      status: document.status,
      generatedAt: document.generatedAt.toISOString(),
      acceptedAt: document.acceptedAt?.toISOString() ?? null,
      adminAcceptedAt: document.adminAcceptedAt?.toISOString() ?? null,
      retentionUntil: document.retentionUntil?.toISOString() ?? null,
      hashShort: document.documentHashSha256.slice(0, 12).toUpperCase(),
    })),
    events: request.events.map((event) => ({ id: event.id, type: event.type, note: event.note ?? "", createdAt: event.createdAt.toISOString() })),
    messages: request.messages.map((message) => ({ id: message.id, kind: message.kind, body: message.body, requestedFields: message.requestedFields, createdAt: message.createdAt.toISOString() })),
  };
}

async function withRightsLock<T>(key: string, operation: (transaction: Transaction) => Promise<T>) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(async (transaction) => {
        await transaction.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`rights:${key}`})) IS NULL AS locked`;
        return operation(transaction);
      }, { isolationLevel: "ReadCommitted" });
    } catch (error) {
      lastError = error;
      if (!error || typeof error !== "object" || !("code" in error) || (error.code !== "P2034" && error.code !== "P2002")) throw error;
    }
  }
  throw lastError;
}

async function nextRightsNumber(transaction: Transaction, type: RightsRequestType) {
  const sequenceName = type === "PUBLICATION_LICENSE" ? "lnx_rights_license_number_seq" : "lnx_rights_partnership_number_seq";
  const rows = await transaction.$queryRawUnsafe<Array<{ value: bigint }>>(`SELECT nextval('${sequenceName}') AS value`);
  const value = rows[0]?.value;
  if (value === undefined) throw new RightsServiceError("La demande n’a pas pu être numérotée.", 500, "NUMBER_GENERATION_FAILED");
  return formatRightsNumber(type, value);
}

function partyData(input: RightsDraftInput["party"]) {
  return {
    partyType: input.partyType,
    firstName: input.firstName || null,
    lastName: input.lastName || null,
    artistName: input.artistName || null,
    companyName: input.companyName || null,
    legalForm: input.legalForm || null,
    legalRepresentative: input.legalRepresentative || null,
    streetAddress: input.streetAddress,
    postalCode: input.postalCode,
    city: input.city,
    country: input.country,
    siret: input.siret || null,
    vatNumber: input.vatNumber || null,
    contractEmail: input.contractEmail,
    phone: input.phone || null,
  } as const;
}

function contributionData(input: RightsDraftInput["contributions"]) {
  return input.map((contribution, position) => ({
    kind: contribution.kind,
    description: contribution.description,
    claimedPercentage: contribution.claimedPercentage,
    evidenceNote: contribution.evidenceNote || null,
    position,
  }));
}

function formData(input: RightsDraftInput): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify({ project: input.project, partnership: input.partnership })) as Prisma.InputJsonValue;
}

export async function createRightsDraft(actor: OrderActor, orderNumber: string, input: RightsDraftInput) {
  assertDatabaseConfigured();
  return withRightsLock(`order:${orderNumber}:${input.type}`, async (transaction) => {
    const order = await transaction.order.findFirst({ where: { orderNumber, userId: actor.id } });
    if (!order) throw new RightsServiceError("Cette commande est introuvable.", 404, "ORDER_NOT_FOUND");
    // Keep relation reads sequential on Prisma Dev's single PostgreSQL wire
    // connection. A nested include here can fan out during the transaction.
    const successfulPayment = await transaction.payment.findFirst({ where: { orderId: order.id, status: "SUCCEEDED" }, select: { id: true } });
    if (!successfulPayment) throw new RightsServiceError("La commande doit être payée avant une demande de droits.", 409, "ORDER_NOT_PAID");
    const publishedDelivery = await transaction.orderAsset.findFirst({ where: { orderId: order.id, role: "DELIVERY" }, select: { assetId: true } });
    const existing = await transaction.rightsRequest.findFirst({
      where: { orderId: order.id, type: input.type, status: { in: [...activeRightsStatuses] } },
      orderBy: { createdAt: "desc" },
    });
    if (!canCreateRightsRequest({ orderStatus: order.status, hasPublishedDelivery: Boolean(publishedDelivery), existingStatuses: existing ? [existing.status] : [] }) && existing?.status !== "DRAFT") {
      throw new RightsServiceError("Une demande active existe déjà ou la livraison n’est pas publiée.", 409, "RIGHTS_REQUEST_NOT_ELIGIBLE");
    }

    let requestId: string;
    if (existing?.status === "DRAFT") {
      requestId = existing.id;
      await transaction.rightsContribution.deleteMany({ where: { rightsRequestId: requestId } });
      await transaction.contractPartySnapshot.deleteMany({ where: { rightsRequestId: requestId, confirmedAt: null } });
      await transaction.rightsRequest.update({
        where: { id: requestId },
        data: {
          requestedPriceCents: rightsPriceSnapshot(input.type).priceCents,
          currency: rightsPriceSnapshot(input.type).currency,
          pricingVersion: rightsPriceSnapshot(input.type).pricingVersion,
          workTitle: input.project.workTitle,
          artistName: input.project.artistName,
          formVersion: rightsFormVersion,
          formData: formData(input),
        },
      });
      await transaction.contractPartySnapshot.create({ data: { rightsRequestId: requestId, version: 1, ...partyData(input.party) } });
      const contributions = contributionData(input.contributions);
      if (contributions.length) await transaction.rightsContribution.createMany({ data: contributions.map((item) => ({ rightsRequestId: requestId, ...item })) });
    } else {
      const pricing = rightsPriceSnapshot(input.type);
      const requestNumber = await nextRightsNumber(transaction, input.type);
      const created = await transaction.rightsRequest.create({
        data: {
          requestNumber,
          orderId: order.id,
          userId: actor.id,
          type: input.type,
          status: "DRAFT",
          requestedPriceCents: pricing.priceCents,
          currency: pricing.currency,
          pricingVersion: pricing.pricingVersion,
          workTitle: input.project.workTitle,
          artistName: input.project.artistName,
          formVersion: rightsFormVersion,
          formData: formData(input),
        },
      });
      requestId = created.id;
      await transaction.contractPartySnapshot.create({ data: { rightsRequestId: requestId, version: 1, ...partyData(input.party) } });
      const contributions = contributionData(input.contributions);
      if (contributions.length) await transaction.rightsContribution.createMany({ data: contributions.map((item) => ({ rightsRequestId: requestId, ...item })) });
      await transaction.rightsRequestEvent.create({
        data: {
          rightsRequestId: requestId,
          type: "REQUEST_CREATED",
          idempotencyKey: `rights:${requestId}:created`,
          actorUserId: actor.id,
          note: "Brouillon de demande créé.",
        },
      });
    }
    const persisted = await findRequestWithRelations(transaction, { id: requestId });
    if (!persisted) throw new RightsServiceError("Cette demande est introuvable.", 404, "RIGHTS_REQUEST_NOT_FOUND");
    return serializeRightsRequest(persisted);
  });
}

function partyDisplayName(party: RequestWithRelations["partySnapshots"][number]) {
  return party.companyName || [party.firstName, party.lastName].filter(Boolean).join(" ") || "Client";
}

function formObject(value: Prisma.JsonValue) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function nestedRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

async function preauthorizationSnapshot(
  request: RequestWithRelations,
  template: { id: string; version: number; status: string; sourceMarkup: string },
  documentVersion: number,
) {
  const party = request.partySnapshots[0];
  if (!party?.confirmedAt) throw new RightsServiceError("Les coordonnées doivent être confirmées.", 409, "CONTACT_NOT_CONFIRMED");
  return {
    generationSchemaVersion: 2,
    documentVersion,
    templateId: template.id,
    templateVersion: template.version,
    templateStatus: template.status,
    sourceMarkup: template.sourceMarkup,
    request: {
      requestNumber: request.requestNumber,
      orderNumber: request.order.orderNumber,
      type: request.type,
      priceCents: request.requestedPriceCents,
      currency: request.currency,
      workTitle: request.workTitle,
      artistName: request.artistName,
    },
    party: {
      version: party.version,
      name: partyDisplayName(party),
      address: `${party.streetAddress}, ${party.postalCode} ${party.city}, ${party.country}`,
      contractEmail: party.contractEmail,
    },
    clientDeclarations: request.formData,
    contributions: request.contributions.map(({ kind, description, claimedPercentage, evidenceNote, position }) => ({
      kind,
      description,
      claimedPercentage,
      evidenceNote,
      position,
    })),
    adminDecisions: {
      grants: request.grants.map(({ kind, authorized, exclusive, destination, platforms, territory, duration, monetization, adaptation, advertising, audiovisualSync, contentId, sublicense, credit, restrictions, position }) => ({
        kind,
        authorized,
        exclusive,
        destination,
        platforms,
        territory,
        duration,
        monetization,
        adaptation,
        advertising,
        audiovisualSync,
        contentId,
        sublicense,
        credit,
        restrictions,
        position,
      })),
      splitProposal: request.splitProposals[0] ? {
        version: request.splitProposals[0].version,
        clientSharePercent: request.splitProposals[0].clientSharePercent,
        lnxSharePercent: request.splitProposals[0].lnxSharePercent,
        nature: request.splitProposals[0].nature,
        comment: request.splitProposals[0].comment,
        contributionRationale: request.splitProposals[0].contributionRationale,
        proposedRoles: request.splitProposals[0].proposedRoles,
      } : null,
    },
    legalWarnings: {
      noRightsGranted: true,
      noAutomaticSacem: true,
      noRightsPayment: true,
      withdrawalLegalReviewRequired: true,
    },
  } as const;
}

function preauthorizationSections(request: RequestWithRelations, sourceSnapshot: Awaited<ReturnType<typeof preauthorizationSnapshot>>) {
  const party = request.partySnapshots[0];
  if (!party) throw new RightsServiceError("Les coordonnées sont incomplètes.", 409, "CONTACT_MISSING");
  if (request.type === "EXPLOITATION_PARTNERSHIP") {
    return buildRightsDocumentSections({
      kind: "PREAUTHORIZATION",
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

  const project = nestedRecord(formObject(request.formData).project);
  const platforms = Array.isArray(project.platforms)
    ? project.platforms.filter((item): item is string => typeof item === "string").map(humanRightsPlatform).join(", ")
    : "Non renseignées";
  return [
    { title: "Parties et création", paragraphs: [`LNX Beats et ${sourceSnapshot.party.name}, ${sourceSnapshot.party.address}.`, `Création : ${request.workTitle}. Référence ${request.order.orderNumber}.`] },
    { title: "Demande préparée", paragraphs: [`Offre : Licence de publication. Plateformes souhaitées : ${platforms}. Territoire souhaité : ${typeof project.territory === "string" && project.territory.trim() ? project.territory.trim() : "Non renseigné"}. Durée souhaitée : ${typeof project.duration === "string" && project.duration.trim() ? project.duration.trim() : "Non renseignée"}.`, `Montant cible futur : ${formatRightsCurrency(request.requestedPriceCents)}. Aucun paiement n’est effectué à cette étape.`] },
    { title: "Contributions déclarées", paragraphs: request.contributions.length ? request.contributions.map((item) => `${humanRightsContribution(item.kind)} : ${item.description}${item.claimedPercentage === null ? "" : ` (${item.claimedPercentage} % revendiqués par le client)`}. Cette déclaration reste à vérifier.`) : ["Aucune contribution reconnue automatiquement."] },
    { title: "Limites", paragraphs: ["Ce document n’accorde aucun droit tant qu’il n’a pas été approuvé, accepté et, dans une version ultérieure, payé.", "Cette demande ne transfère pas la qualité d’auteur, les droits moraux, la propriété de l’œuvre ou une quote-part SACEM.", "Les règles de rétractation et de commencement anticipé restent soumises à validation juridique. Aucune renonciation n’est précochée."] },
  ];
}

type StoredPrivateDocument = Readonly<{
  storageKey: string;
  storageBackend: "LOCAL" | "OBJECT";
  storageProvider: string;
  visibility: "PUBLIC" | "PRIVATE";
  checksumSha256: string;
}>;

export type PreauthorizationDependencies = Readonly<{
  validateStorage(): { backend: string; provider: string };
  write(input: { storageKey: string; bytes: Buffer; checksumSha256: string }): Promise<StoredPrivateDocument>;
  delete(input: Pick<StoredPrivateDocument, "storageKey" | "storageBackend" | "storageProvider" | "visibility">): Promise<void>;
}>;

export const defaultPrivateDocumentDependencies: PreauthorizationDependencies = {
  validateStorage: validateMediaStorageConfiguration,
  async write({ storageKey, bytes, checksumSha256 }) {
    const stored = await writePrivateOrderMedia({ storageKey, body: bytes, contentLength: bytes.length, contentType: "application/pdf", checksumSha256 });
    return { ...stored, storageKey, checksumSha256 };
  },
  delete: deletePrivateOrderFile,
};

export async function generatePreauthorization(
  actor: OrderActor,
  requestNumber: string,
  dependencies: PreauthorizationDependencies = defaultPrivateDocumentDependencies,
) {
  assertDatabaseConfigured();
  const configuration = dependencies.validateStorage();
  if (configuration.backend !== "OBJECT" || configuration.provider !== "r2") {
    throw new RightsServiceError("Le stockage contractuel privé est indisponible.", 503, "CONTRACT_STORAGE_UNAVAILABLE");
  }
  const request = await findRequestWithRelations(prisma, { requestNumber, userId: actor.id });
  if (!request) throw new RightsServiceError("Cette demande est introuvable.", 404, "RIGHTS_REQUEST_NOT_FOUND");
  const existing = request.documents.find(({ kind }) => kind === "PREAUTHORIZATION");
  if (existing) return serializeRightsRequest(request);
  if (!request.submittedAt || !["SUBMITTED", "PREAUTHORIZATION_GENERATED"].includes(request.status)) {
    throw new RightsServiceError("La demande doit d’abord être soumise.", 409, "RIGHTS_REQUEST_NOT_SUBMITTED");
  }
  const templateType = request.type === "PUBLICATION_LICENSE" ? "PUBLICATION_LICENSE" : "EXPLOITATION_PARTNERSHIP";
  const template = await prisma.contractTemplate.findFirst({
    where: { type: templateType, status: { in: ["DRAFT", "AWAITING_LEGAL_REVIEW", "APPROVED"] } },
    orderBy: { version: "desc" },
  });
  if (!template) throw new RightsServiceError("Aucun modèle contractuel n’est disponible.", 503, "CONTRACT_TEMPLATE_UNAVAILABLE");
  const sourceSnapshot = await preauthorizationSnapshot(request, template, 1);
  const generatedAt = new Date();
  const contractNumber = `${request.requestNumber}-P01`;
  const pdf = await generateContractPdf({
    contractNumber,
    requestNumber: request.requestNumber,
    orderNumber: request.order.orderNumber,
    title: `Projet de préautorisation - ${request.workTitle}`,
    statusLabel: "Projet de préautorisation",
    templateVersion: template.version,
    generatedAt,
    legalTemplateApproved: template.status === "APPROVED",
    kind: "PREAUTHORIZATION",
    sections: preauthorizationSections(request, sourceSnapshot),
  });
  const storageKey = `orders/${request.orderId}/documents/${randomUUID()}.pdf`;
  const stored = await dependencies.write({ storageKey, bytes: pdf.bytes, checksumSha256: pdf.sha256 });
  if (stored.storageBackend !== "OBJECT" || stored.storageProvider !== "r2" || stored.visibility !== "PRIVATE") {
    await dependencies.delete(stored).catch(() => undefined);
    throw new RightsServiceError("Le stockage contractuel privé est indisponible.", 503, "CONTRACT_STORAGE_UNAVAILABLE");
  }
  let duplicate: boolean;
  try {
    duplicate = await withRightsLock(`request:${request.id}:preauthorization`, async (transaction) => {
      const current = await transaction.rightsRequest.findUniqueOrThrow({ where: { id: request.id }, select: { id: true, status: true } });
      const existingDocument = await transaction.contractDocument.findFirst({
        where: { rightsRequestId: current.id, kind: "PREAUTHORIZATION" },
        select: { id: true },
      });
      if (existingDocument) return true;
      if (current.status !== "SUBMITTED") {
        throw new RightsServiceError("La demande doit d’abord être soumise.", 409, "RIGHTS_REQUEST_NOT_SUBMITTED");
      }
      const asset = await transaction.asset.create({
        data: {
          type: "DOCUMENT",
          storageKey,
          storageBackend: "OBJECT",
          storageProvider: "r2",
          visibility: "PRIVATE",
          checksumSha256: pdf.sha256,
          filename: `${contractNumber}.pdf`,
          mimeType: "application/pdf",
          sizeBytes: BigInt(pdf.bytes.length),
          rightsStatus: "RESTRICTED",
          rightsNote: "Document contractuel privé - accès propriétaire/Admin uniquement.",
          confidence: "CONFIRMED",
        },
      });
      await transaction.orderAsset.create({ data: { orderId: request.orderId, assetId: asset.id, role: "CONTRACT", position: 0 } });
      await transaction.contractDocument.create({
        data: {
          contractNumber,
          rightsRequestId: request.id,
          templateId: template.id,
          templateVersion: template.version,
          documentVersion: 1,
          kind: "PREAUTHORIZATION",
          status: "DRAFT",
          generatedAt,
          priceSnapshotCents: request.requestedPriceCents,
          currency: request.currency,
          sourceSnapshot: JSON.parse(JSON.stringify(sourceSnapshot)) as Prisma.InputJsonValue,
          documentHashSha256: pdf.sha256,
          assetId: asset.id,
        },
      });
      await transaction.rightsRequest.updateMany({
        where: { id: request.id, status: "SUBMITTED" },
        data: { status: "PREAUTHORIZATION_GENERATED" },
      });
      await transaction.rightsRequestEvent.upsert({
        where: { idempotencyKey: `rights:${request.id}:preauthorization:1` },
        update: {},
        create: { rightsRequestId: request.id, type: "PREAUTHORIZATION_GENERATED", idempotencyKey: `rights:${request.id}:preauthorization:1`, actorUserId: actor.id, note: "Projet de préautorisation généré et archivé en privé." },
      });
      const idempotencyKey = `rights:${request.id}:preauthorization-ready:email`;
      await enqueueOrderNotification(transaction, {
        orderId: request.orderId,
        kind: "CUSTOMER_RIGHTS_PREAUTHORIZATION_READY",
        recipient: request.order.customerEmail,
        idempotencyKey,
        resource: {
          type: "RIGHTS_REQUEST", id: request.id, reference: request.requestNumber,
          rightsRequestNumber: request.requestNumber, rightsRequestType: request.type,
          requestedPriceCents: request.requestedPriceCents, workTitle: request.workTitle,
        },
      });
      return false;
    });
  } catch (error) {
    await dependencies.delete(stored).catch(() => undefined);
    throw error;
  }
  if (duplicate) await dependencies.delete(stored).catch(() => undefined);
  const persisted = await findRequestWithRelations(prisma, { id: request.id, userId: actor.id });
  if (!persisted) throw new RightsServiceError("Cette demande est introuvable.", 404, "RIGHTS_REQUEST_NOT_FOUND");
  return serializeRightsRequest(persisted);
}

async function generatePartnershipPreauthorizationRevisionUnlocked(
  actor: OrderActor,
  requestNumber: string,
  dependencies: PreauthorizationDependencies,
) {
  assertDatabaseConfigured();
  const configuration = dependencies.validateStorage();
  if (configuration.backend !== "OBJECT" || configuration.provider !== "r2") {
    throw new RightsServiceError("Le stockage contractuel privé est indisponible.", 503, "CONTRACT_STORAGE_UNAVAILABLE");
  }
  const request = await findRequestWithRelations(prisma, { requestNumber, userId: actor.id });
  if (!request) throw new RightsServiceError("Cette demande est introuvable.", 404, "RIGHTS_REQUEST_NOT_FOUND");
  if (request.type !== "EXPLOITATION_PARTNERSHIP") {
    throw new RightsServiceError("Cette révision est réservée au partenariat d’exploitation.", 409, "PREAUTHORIZATION_REVISION_NOT_ALLOWED");
  }
  const existingRevision = request.documents.find(({ kind, documentVersion }) => kind === "PREAUTHORIZATION" && documentVersion === 2);
  if (existingRevision) return serializeRightsRequest(request);
  const original = request.documents.find(({ kind, documentVersion }) => kind === "PREAUTHORIZATION" && documentVersion === 1);
  if (!original || original.status !== "DRAFT" || request.status !== "PREAUTHORIZATION_GENERATED") {
    throw new RightsServiceError("La préautorisation d’origine n’est pas révisable.", 409, "PREAUTHORIZATION_REVISION_NOT_ALLOWED");
  }
  const acceptedOriginal = await prisma.contractAcceptance.count({ where: { contractDocumentId: original.id } });
  if (acceptedOriginal !== 0) {
    throw new RightsServiceError("Un document accepté ne peut pas être remplacé.", 409, "ACCEPTED_DOCUMENT_IMMUTABLE");
  }
  const template = await prisma.contractTemplate.findFirst({
    where: { type: "EXPLOITATION_PARTNERSHIP", status: { in: ["DRAFT", "AWAITING_LEGAL_REVIEW", "APPROVED"] } },
    orderBy: { version: "desc" },
  });
  if (!template) throw new RightsServiceError("Aucun modèle contractuel n’est disponible.", 503, "CONTRACT_TEMPLATE_UNAVAILABLE");

  const sourceSnapshot = await preauthorizationSnapshot(request, template, 2);
  const generatedAt = new Date();
  const contractNumber = `${request.requestNumber}-P02`;
  const pdf = await generateContractPdf({
    contractNumber,
    requestNumber: request.requestNumber,
    orderNumber: request.order.orderNumber,
    title: `Projet de préautorisation - ${request.workTitle}`,
    statusLabel: "Projet de préautorisation",
    templateVersion: template.version,
    generatedAt,
    legalTemplateApproved: template.status === "APPROVED",
    kind: "PREAUTHORIZATION",
    sections: preauthorizationSections(request, sourceSnapshot),
  });
  const storageKey = `orders/${request.orderId}/documents/${randomUUID()}.pdf`;
  const stored = await dependencies.write({ storageKey, bytes: pdf.bytes, checksumSha256: pdf.sha256 });
  if (stored.storageBackend !== "OBJECT" || stored.storageProvider !== "r2" || stored.visibility !== "PRIVATE") {
    await dependencies.delete(stored).catch(() => undefined);
    throw new RightsServiceError("Le stockage contractuel privé est indisponible.", 503, "CONTRACT_STORAGE_UNAVAILABLE");
  }

  let duplicate: boolean;
  try {
    duplicate = await withRightsLock(`request:${request.id}:preauthorization`, async (transaction) => {
      const current = await transaction.rightsRequest.findUniqueOrThrow({
        where: { id: request.id },
        select: { id: true, type: true, status: true },
      });
      const currentRevision = await transaction.contractDocument.findFirst({
        where: { rightsRequestId: current.id, kind: "PREAUTHORIZATION", documentVersion: 2 },
        select: { id: true },
      });
      if (currentRevision) return true;
      const currentOriginal = await transaction.contractDocument.findFirst({
        where: { rightsRequestId: current.id, kind: "PREAUTHORIZATION", documentVersion: 1 },
        select: { id: true, status: true },
      });
      if (current.type !== "EXPLOITATION_PARTNERSHIP" || current.status !== "PREAUTHORIZATION_GENERATED" || !currentOriginal || currentOriginal.status !== "DRAFT") {
        throw new RightsServiceError("La préautorisation d’origine n’est pas révisable.", 409, "PREAUTHORIZATION_REVISION_NOT_ALLOWED");
      }
      const acceptanceCount = await transaction.contractAcceptance.count({ where: { contractDocumentId: currentOriginal.id } });
      if (acceptanceCount !== 0) {
        throw new RightsServiceError("Un document accepté ne peut pas être remplacé.", 409, "ACCEPTED_DOCUMENT_IMMUTABLE");
      }
      const asset = await transaction.asset.create({
        data: {
          type: "DOCUMENT",
          storageKey,
          storageBackend: "OBJECT",
          storageProvider: "r2",
          visibility: "PRIVATE",
          checksumSha256: pdf.sha256,
          filename: `${contractNumber}.pdf`,
          mimeType: "application/pdf",
          sizeBytes: BigInt(pdf.bytes.length),
          rightsStatus: "RESTRICTED",
          rightsNote: "Document contractuel privé - accès propriétaire/Admin uniquement.",
          confidence: "CONFIRMED",
        },
      });
      await transaction.orderAsset.create({ data: { orderId: request.orderId, assetId: asset.id, role: "CONTRACT", position: 1 } });
      await transaction.contractDocument.create({
        data: {
          contractNumber,
          rightsRequestId: request.id,
          templateId: template.id,
          templateVersion: template.version,
          documentVersion: 2,
          kind: "PREAUTHORIZATION",
          status: "DRAFT",
          generatedAt,
          priceSnapshotCents: request.requestedPriceCents,
          currency: request.currency,
          sourceSnapshot: JSON.parse(JSON.stringify(sourceSnapshot)) as Prisma.InputJsonValue,
          documentHashSha256: pdf.sha256,
          assetId: asset.id,
          supersedesDocumentId: currentOriginal.id,
        },
      });
      await transaction.rightsRequestEvent.upsert({
        where: { idempotencyKey: `rights:${request.id}:preauthorization:2` },
        update: {},
        create: {
          rightsRequestId: request.id,
          type: "PREAUTHORIZATION_GENERATED",
          idempotencyKey: `rights:${request.id}:preauthorization:2`,
          actorUserId: actor.id,
          note: "Projet de préautorisation P02 généré sans modification de P01.",
        },
      });
      return false;
    });
  } catch (error) {
    await dependencies.delete(stored).catch(() => undefined);
    throw error;
  }
  if (duplicate) await dependencies.delete(stored).catch(() => undefined);
  const persisted = await findRequestWithRelations(prisma, { id: request.id, userId: actor.id });
  if (!persisted) throw new RightsServiceError("Cette demande est introuvable.", 404, "RIGHTS_REQUEST_NOT_FOUND");
  return serializeRightsRequest(persisted);
}

export function generatePartnershipPreauthorizationRevision(
  actor: OrderActor,
  requestNumber: string,
  dependencies: PreauthorizationDependencies = defaultPrivateDocumentDependencies,
) {
  return withLocalConfirmationLock(requestNumber, () => generatePartnershipPreauthorizationRevisionUnlocked(actor, requestNumber, dependencies));
}

async function confirmRightsCoordinatesUnlocked(actor: OrderActor, requestNumber: string, dependencies: PreauthorizationDependencies) {
  assertDatabaseConfigured();
  const confirmation = await withRightsLock(`request:${requestNumber}:confirm`, async (transaction) => {
    const current = await transaction.rightsRequest.findFirst({
      where: { requestNumber, userId: actor.id },
      select: { id: true, requestNumber: true, orderId: true, status: true, type: true, requestedPriceCents: true, workTitle: true },
    });
    if (!current) throw new RightsServiceError("Cette demande est introuvable.", 404, "RIGHTS_REQUEST_NOT_FOUND");
    const party = await transaction.contractPartySnapshot.findFirst({
      where: { rightsRequestId: current.id },
      orderBy: { version: "desc" },
    });
    if (!party) throw new RightsServiceError("Les coordonnées sont incomplètes.", 409, "CONTACT_MISSING");
    if (current.status !== "DRAFT" && current.status !== "SUBMITTED" && current.status !== "PREAUTHORIZATION_GENERATED") {
      throw new RightsServiceError("Ces coordonnées ne peuvent plus être modifiées.", 409, "CONTACT_IMMUTABLE");
    }
    const now = new Date();
    if (!party.confirmedAt) {
      await transaction.contractPartySnapshot.update({ where: { id: party.id }, data: { confirmedAt: now, confirmedByUserId: actor.id } });
      await transaction.rightsRequestEvent.upsert({
        where: { idempotencyKey: `rights:${current.id}:contact:${party.version}` },
        update: {},
        create: { rightsRequestId: current.id, type: "CONTACT_CONFIRMED", idempotencyKey: `rights:${current.id}:contact:${party.version}`, actorUserId: actor.id, note: `Coordonnées contractuelles version ${party.version} confirmées.` },
      });
    }
    if (current.status === "DRAFT") {
      await transaction.rightsRequest.update({ where: { id: current.id }, data: { status: "SUBMITTED", submittedAt: now } });
      await transaction.rightsRequestEvent.upsert({
        where: { idempotencyKey: `rights:${current.id}:submitted` },
        update: {},
        create: { rightsRequestId: current.id, type: "REQUEST_SUBMITTED", idempotencyKey: `rights:${current.id}:submitted`, actorUserId: actor.id, note: "Demande envoyée pour étude." },
      });
      const idempotencyKey = `rights:${current.id}:owner-requested:email`;
      await enqueueOrderNotification(transaction, {
        orderId: current.orderId,
        kind: "OWNER_RIGHTS_REQUESTED",
        recipient: process.env.EMAIL_OWNER_RECIPIENT?.trim().toLowerCase() || null,
        idempotencyKey,
        resource: {
          type: "RIGHTS_REQUEST", id: current.id, reference: current.requestNumber,
          rightsRequestNumber: current.requestNumber, rightsRequestType: current.type,
          requestedPriceCents: current.requestedPriceCents, workTitle: current.workTitle,
        },
      });
    }
    return { requestNumber: current.requestNumber, alreadyGenerated: current.status === "PREAUTHORIZATION_GENERATED" };
  });
  if (confirmation.alreadyGenerated) {
    const persisted = await findRequestWithRelations(prisma, { requestNumber: confirmation.requestNumber, userId: actor.id });
    if (!persisted) throw new RightsServiceError("Cette demande est introuvable.", 404, "RIGHTS_REQUEST_NOT_FOUND");
    return serializeRightsRequest(persisted);
  }
  return generatePreauthorization(actor, confirmation.requestNumber, dependencies);
}

export function confirmRightsCoordinates(actor: OrderActor, requestNumber: string, dependencies: PreauthorizationDependencies = defaultPrivateDocumentDependencies) {
  // The database constraints remain the cross-process source of truth. This
  // same-process queue additionally prevents Prisma Dev/PGlite from executing
  // two relation reads on one wire client when Safari retries a confirmation.
  return withLocalConfirmationLock(requestNumber, () => confirmRightsCoordinatesUnlocked(actor, requestNumber, dependencies));
}

export async function listRightsRequestsForActor(actor: OrderActor) {
  assertDatabaseConfigured();
  const requests = await prisma.rightsRequest.findMany({
    where: actor.role === "ADMIN" ? {} : { userId: actor.id },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    include: requestInclude,
  });
  return requests.map(serializeRightsRequest);
}

export async function listRightsRequestsForOrderActor(actor: OrderActor, orderNumber: string) {
  assertDatabaseConfigured();
  const requests = await prisma.rightsRequest.findMany({
    where: {
      order: { orderNumber },
      ...(actor.role === "ADMIN" ? {} : { userId: actor.id }),
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    include: requestInclude,
  });
  return requests.map(serializeRightsRequest);
}

export async function getRightsRequestForActor(actor: OrderActor, requestNumber: string) {
  assertDatabaseConfigured();
  const request = await prisma.rightsRequest.findUnique({ where: { requestNumber }, include: requestInclude });
  if (!request || (actor.role !== "ADMIN" && request.userId !== actor.id)) return null;
  return serializeRightsRequest(request);
}

export async function getContractDocumentForActor(actor: OrderActor, documentId: string) {
  assertDatabaseConfigured();
  const document = await prisma.contractDocument.findUnique({
    where: { id: documentId },
    include: { asset: true, request: { include: { order: { select: { userId: true, orderNumber: true } } } } },
  });
  if (!document || !canReadOrderMedia(actor, document.request.order.userId)) return null;
  if (document.asset.visibility !== "PRIVATE" || document.asset.storageBackend !== "OBJECT" || document.asset.storageProvider !== "r2" || document.asset.mimeType !== "application/pdf") return null;
  return document;
}

export async function recordContractDocumentViewed(actor: OrderActor, documentId: string) {
  assertDatabaseConfigured();
  const document = await prisma.contractDocument.findUnique({ where: { id: documentId }, select: { rightsRequestId: true, request: { select: { userId: true } } } });
  if (!document || (actor.role !== "ADMIN" && document.request.userId !== actor.id)) return;
  await prisma.rightsRequestEvent.upsert({
    where: { idempotencyKey: `rights:${document.rightsRequestId}:document:${documentId}:viewed:${actor.id}` },
    update: {},
    create: { rightsRequestId: document.rightsRequestId, type: "DOCUMENT_VIEWED", idempotencyKey: `rights:${document.rightsRequestId}:document:${documentId}:viewed:${actor.id}`, actorUserId: actor.id, note: "Document privé consulté par un acteur autorisé." },
  });
}

export async function deleteRightsDraft(actor: OrderActor, requestNumber: string) {
  assertDatabaseConfigured();
  return withRightsLock(`request:${requestNumber}:delete`, async (transaction) => {
    const request = await transaction.rightsRequest.findFirst({ where: { requestNumber, userId: actor.id } });
    if (!request) throw new RightsServiceError("Cette demande est introuvable.", 404, "RIGHTS_REQUEST_NOT_FOUND");
    const relatedCounts = [
      await transaction.contractDocument.count({ where: { rightsRequestId: request.id } }),
      await transaction.rightsMessage.count({ where: { rightsRequestId: request.id } }),
      await transaction.rightsSplitProposal.count({ where: { rightsRequestId: request.id } }),
      await transaction.rightsGrant.count({ where: { rightsRequestId: request.id } }),
    ];
    if (request.status !== "DRAFT" || relatedCounts.some((count) => count > 0)) {
      throw new RightsServiceError("Seul un brouillon sans document peut être supprimé.", 409, "RIGHTS_DRAFT_NOT_DELETABLE");
    }
    await transaction.rightsRequestEvent.deleteMany({ where: { rightsRequestId: request.id } });
    await transaction.rightsContribution.deleteMany({ where: { rightsRequestId: request.id } });
    await transaction.contractPartySnapshot.deleteMany({ where: { rightsRequestId: request.id } });
    await transaction.rightsRequest.delete({ where: { id: request.id } });
    return { deleted: true as const, orderId: request.orderId };
  });
}

export async function cancelRightsRequest(actor: OrderActor, requestNumber: string) {
  assertDatabaseConfigured();
  return withRightsLock(`request:${requestNumber}:cancel`, async (transaction) => {
    const request = await transaction.rightsRequest.findFirst({ where: { requestNumber, userId: actor.id } });
    if (!request) throw new RightsServiceError("Cette demande est introuvable.", 404, "RIGHTS_REQUEST_NOT_FOUND");
    if (request.status === "CANCELLED") return { cancelled: true as const, orderId: request.orderId };
    if (!["SUBMITTED", "INFORMATION_REQUIRED", "UNDER_REVIEW", "PREAUTHORIZATION_GENERATED", "CONTRACT_PREPARATION", "CONTRACT_READY"].includes(request.status)) {
      throw new RightsServiceError("Cette demande ne peut plus être annulée.", 409, "RIGHTS_REQUEST_NOT_CANCELLABLE");
    }
    const now = new Date();
    await transaction.rightsRequest.update({ where: { id: request.id }, data: { status: "CANCELLED", cancelledAt: now, needsInformationMessage: null } });
    await transaction.rightsRequestEvent.upsert({
      where: { idempotencyKey: `rights:${request.id}:cancelled` },
      update: {},
      create: { rightsRequestId: request.id, type: "REQUEST_CANCELLED", idempotencyKey: `rights:${request.id}:cancelled`, actorUserId: actor.id, note: "Demande annulée par le client. L’historique et les documents existants restent archivés." },
    });
    return { cancelled: true as const, orderId: request.orderId };
  });
}
