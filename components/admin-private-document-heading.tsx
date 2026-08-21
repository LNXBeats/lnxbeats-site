import {
  adminRightsDocumentVersionLabel,
  adminRightsLatestDocumentLabel,
} from "@/lib/rights/admin-presentation";

type AdminPrivateDocumentHeadingProps = Readonly<{
  contractNumber: string;
  documentVersion: number;
  kind: "PREAUTHORIZATION" | "CONTRACT" | "ACCEPTANCE_RECEIPT" | "SACEM_PREPARATION";
  isLatest: boolean;
}>;

export function AdminPrivateDocumentHeading({
  contractNumber,
  documentVersion,
  kind,
  isLatest,
}: AdminPrivateDocumentHeadingProps) {
  const versionLabel = adminRightsDocumentVersionLabel(contractNumber, documentVersion);
  const latestLabel = isLatest ? adminRightsLatestDocumentLabel(kind) : null;

  return <div
    aria-label={latestLabel ? `${versionLabel}. ${latestLabel}.` : versionLabel}
    className="admin-private-document__heading"
  >
    <p className="admin-private-document__version"><strong>{versionLabel}</strong></p>
    {latestLabel ? <span className="admin-private-document__badge">{latestLabel}</span> : null}
  </div>;
}
