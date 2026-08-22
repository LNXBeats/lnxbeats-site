import "server-only";

import { createHash } from "node:crypto";
import { appendFile, chmod, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import { Resend } from "resend";

import type { NotificationConfiguration } from "@/lib/notifications/config";
import {
  isFictitiousRecipient,
  isOfficialResendTestRecipient,
  notificationDefinition,
  normalizeNotificationRecipient,
  NotificationTransportError,
} from "@/lib/notifications/domain";
import type {
  NotificationTemplate,
  NotificationTransportResult,
  OrderNotificationMessage,
} from "@/lib/notifications/types";

export interface NotificationTransport {
  send(message: OrderNotificationMessage, template: NotificationTemplate): Promise<NotificationTransportResult>;
}

function assertIdempotencyKey(value: string) {
  if (!value || value.length > 255 || !/^[A-Za-z0-9_./:-]+$/.test(value)) {
    throw new NotificationTransportError({ code: "INVALID_MESSAGE", message: "La notification est invalide.", retryable: false });
  }
}

function deterministicCaptureId(message: OrderNotificationMessage) {
  return `capture_${createHash("sha256").update(`${message.id}:${message.idempotencyKey}`).digest("hex").slice(0, 32)}`;
}

function captureTransport(configuration: NotificationConfiguration): NotificationTransport {
  return {
    async send(message, template) {
      if (!configuration.emailEnabled) {
        throw new NotificationTransportError({ code: "EMAIL_DISABLED", message: "Le transport e-mail est désactivé.", retryable: false });
      }
      const audience = notificationDefinition(message.kind).audience;
      if (audience === "OWNER" && !configuration.ownerEmailEnabled) {
        throw new NotificationTransportError({ code: "OWNER_EMAIL_DISABLED", message: "Les notifications propriétaire sont désactivées.", retryable: false });
      }
      if (audience === "CLIENT" && !configuration.clientEmailEnabled) {
        throw new NotificationTransportError({ code: "CLIENT_EMAIL_DISABLED", message: "Les notifications client sont désactivées.", retryable: false });
      }
      const recipient = normalizeNotificationRecipient(message.recipient);
      assertIdempotencyKey(message.idempotencyKey);
      const providerMessageId = deterministicCaptureId(message);
      await mkdir(dirname(configuration.capturePath), { recursive: true, mode: 0o700 });
      await appendFile(configuration.capturePath, `${JSON.stringify({
        providerMessageId,
        kind: message.kind,
        channel: message.channel,
        recipient,
        idempotencyKey: message.idempotencyKey,
        templateKey: message.templateKey,
        templateVersion: message.templateVersion,
        subject: template.subject,
        text: template.text,
        html: template.html,
        capturedAt: new Date().toISOString(),
      })}\n`, { encoding: "utf8", mode: 0o600 });
      await chmod(configuration.capturePath, 0o600);
      return { provider: "CAPTURE", providerMessageId, deliveredImmediately: true };
    },
  };
}

function assertResendRecipient(message: OrderNotificationMessage, configuration: NotificationConfiguration) {
  const recipient = normalizeNotificationRecipient(message.recipient);
  if (isFictitiousRecipient(recipient)) {
    throw new NotificationTransportError({ code: "FICTITIOUS_RECIPIENT", message: "Une adresse de test locale ne peut pas être envoyée au fournisseur.", retryable: false });
  }
  const owner = message.kind === "OWNER_NEW_ORDER" || message.kind === "OWNER_RIGHTS_REQUESTED" || message.kind === "OWNER_RIGHTS_CLIENT_ACCEPTED" || message.kind === "OWNER_PAYMENT_INCIDENT";
  if (owner) {
    if (!configuration.ownerEmailEnabled || recipient !== configuration.ownerRecipient) {
      throw new NotificationTransportError({ code: "OWNER_DESTINATION_NOT_APPROVED", message: "La destination propriétaire n’est pas approuvée.", retryable: false });
    }
  } else {
    if (!configuration.clientEmailEnabled) {
      throw new NotificationTransportError({ code: "CLIENT_EMAIL_DISABLED", message: "Les notifications client sont désactivées.", retryable: false });
    }
    const allowed = isOfficialResendTestRecipient(recipient) || configuration.stagingRecipientAllowlist.includes(recipient);
    if (!allowed) {
      throw new NotificationTransportError({ code: "STAGING_DESTINATION_NOT_APPROVED", message: "La destination staging n’est pas approuvée.", retryable: false });
    }
  }
  return recipient;
}

function resendTransport(configuration: NotificationConfiguration): NotificationTransport {
  const client = new Resend(configuration.resendApiKey!);
  return {
    async send(message, template) {
      assertIdempotencyKey(message.idempotencyKey);
      const recipient = assertResendRecipient(message, configuration);
      const response = await client.emails.send({
        from: configuration.emailFrom!,
        to: recipient,
        replyTo: configuration.emailReplyTo!,
        subject: template.subject,
        text: template.text,
        html: template.html,
        headers: {
          "X-Entity-Ref-ID": message.id,
          "X-LNX-Environment": configuration.deploymentEnvironment,
        },
      }, { idempotencyKey: message.idempotencyKey });
      if (response.error || !response.data?.id) {
        const error = response.error as unknown as Record<string, unknown> | null;
        const statusCode = typeof error?.statusCode === "number" ? error.statusCode : null;
        const name = typeof error?.name === "string" ? error.name : "provider_error";
        throw Object.assign(new Error("Resend did not accept the notification."), { statusCode, name });
      }
      return { provider: "RESEND", providerMessageId: response.data.id, deliveredImmediately: false };
    },
  };
}

export function createNotificationTransport(configuration: NotificationConfiguration): NotificationTransport {
  if (configuration.emailTransport === "capture") return captureTransport(configuration);
  if (configuration.emailTransport === "resend") return resendTransport(configuration);
  return {
    async send() {
      throw new NotificationTransportError({ code: "EMAIL_DISABLED", message: "Le transport e-mail est désactivé.", retryable: false });
    },
  };
}
