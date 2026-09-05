export type ClientNotificationCategory =
  | "SAFE_TO_SEND_NOW"
  | "OBSOLETE_DO_NOT_SEND"
  | "NEEDS_HUMAN_REVIEW"
  | "ALREADY_FINAL_NO_RETRY"
  | "CURRENT_FUTURE_ONLY";

export type ClientNotificationRow = Readonly<{
  kind: string;
  status: string;
  createdAt: string | Date;
  availableAt?: string | Date;
  leaseExpiresAt?: string | Date | null;
  lastErrorCode?: string | null;
}>;

export const CLIENT_NOTIFICATION_CATEGORIES: readonly ClientNotificationCategory[];
export const APPROVED_CLIENT_NOTIFICATION_ACTIVATION_POLICY: "OPTION_B_PLUS_E";
export function assertClientNotificationDryRunArguments(argumentsProvided: readonly string[]): void;
export function classifyClientNotification(row: Pick<ClientNotificationRow, "status" | "createdAt">, cutoff: Date): ClientNotificationCategory;
export function summarizeClientNotifications(rows: readonly ClientNotificationRow[], cutoff: Date, now?: Date): Readonly<{
  cutoff: string;
  approvedPolicy: "OPTION_B_PLUS_E";
  total: number;
  statuses: Record<string, number>;
  kinds: Record<string, number>;
  retryableNow: number;
  expiredLeases: number;
  clientEmailDisabled: number;
  categories: Record<ClientNotificationCategory, number>;
  historicalClaimable: number;
  dangerousBacklog: number;
  activatingWorkerWouldSendHistoricalMail: "YES" | "NO";
  backlogSafe: boolean;
  activationReady: boolean;
  workerOnlyActivationRequired: true;
  manualRunNowAllowed: false;
  rollbackWorkerFlagValue: false;
}>;
export function readClientNotificationActivationState(
  client: { query(sql: string): Promise<{ rows: unknown[] }> },
  cutoff?: Date,
): ReturnType<typeof summarizeClientNotifications> extends infer T ? Promise<T> : never;
