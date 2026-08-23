import "server-only";

import { Resend, type CreateEmailOptions, type CreateEmailResponse } from "resend";

import { RESEND_API_BASE_URL } from "@/lib/notifications/config";

export const RESEND_REQUEST_TIMEOUT_MS = 10_000;

export type ResendEmailSender = (
  message: CreateEmailOptions,
  options: { idempotencyKey: string; signal: AbortSignal },
) => Promise<CreateEmailResponse>;

export class ResendAdapterError extends Error {
  constructor(
    readonly providerErrorName: string,
    readonly statusCode: number | null,
  ) {
    super("Resend did not accept the transactional email.");
    this.name = providerErrorName;
  }
}

function defaultSender(apiKey: string): ResendEmailSender {
  const client = new Resend(apiKey, { baseUrl: RESEND_API_BASE_URL });
  return (message, options) => client.emails.send(message, options as Parameters<typeof client.emails.send>[1]);
}

export async function sendResendEmail(
  input: {
    apiKey: string;
    idempotencyKey: string;
    message: CreateEmailOptions;
    timeoutMs?: number;
  },
  injectedSender?: ResendEmailSender,
) {
  const controller = new AbortController();
  const timeoutMs = input.timeoutMs ?? RESEND_REQUEST_TIMEOUT_MS;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (injectedSender ?? defaultSender(input.apiKey))(input.message, {
      idempotencyKey: input.idempotencyKey,
      signal: controller.signal,
    });
    if (response.error || !response.data?.id) {
      const error = response.error as unknown as Record<string, unknown> | null;
      throw new ResendAdapterError(
        typeof error?.name === "string" ? error.name : "provider_error",
        typeof error?.statusCode === "number" ? error.statusCode : null,
      );
    }
    return response.data.id;
  } catch (error) {
    if (controller.signal.aborted) throw new ResendAdapterError("request_timeout", 408);
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
