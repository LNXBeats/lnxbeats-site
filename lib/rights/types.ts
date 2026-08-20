import type {
  AiContributionAssessment,
  ContractDocumentKind,
  ContractDocumentStatus,
  ContractPartyType,
  RightsContributionKind,
  RightsEventType,
  RightsGrantKind,
  RightsMessageKind,
  RightsRequestStatus,
  RightsRequestType,
} from "@/generated/prisma/client";

export type SerializedContractParty = Readonly<{
  version: number;
  partyType: ContractPartyType;
  firstName: string;
  lastName: string;
  artistName: string;
  companyName: string;
  legalForm: string;
  legalRepresentative: string;
  streetAddress: string;
  postalCode: string;
  city: string;
  country: string;
  siret: string;
  vatNumber: string;
  contractEmail: string;
  phone: string;
  confirmedAt: string | null;
}>;

export type SerializedRightsRequest = Readonly<{
  requestNumber: string;
  orderNumber: string;
  type: RightsRequestType;
  status: RightsRequestStatus;
  requestedPriceCents: number;
  currency: string;
  pricingVersion: string;
  workTitle: string;
  artistName: string;
  formData: unknown;
  aiAssessment: AiContributionAssessment;
  submittedAt: string | null;
  reviewedAt: string | null;
  rejectedAt: string | null;
  rejectionReason: string;
  needsInformationMessage: string;
  createdAt: string;
  updatedAt: string;
  party: SerializedContractParty | null;
  contributions: readonly Readonly<{
    kind: RightsContributionKind;
    description: string;
    claimedPercentage: number | null;
    evidenceNote: string;
  }>[];
  grants: readonly Readonly<{
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
  }>[];
  splitProposal: Readonly<{
    version: number;
    clientSharePercent: number;
    lnxSharePercent: number;
    nature: string;
    comment: string;
    contributionRationale: string;
    proposedRoles: unknown;
  }> | null;
  documents: readonly Readonly<{
    id: string;
    contractNumber: string;
    documentVersion: number;
    templateVersion: number;
    kind: ContractDocumentKind;
    status: ContractDocumentStatus;
    generatedAt: string;
    acceptedAt: string | null;
    adminAcceptedAt: string | null;
    retentionUntil: string | null;
    hashShort: string;
  }>[];
  events: readonly Readonly<{
    id: string;
    type: RightsEventType;
    note: string;
    createdAt: string;
  }>[];
  messages: readonly Readonly<{
    id: string;
    kind: RightsMessageKind;
    body: string;
    requestedFields: unknown;
    createdAt: string;
  }>[];
}>;
