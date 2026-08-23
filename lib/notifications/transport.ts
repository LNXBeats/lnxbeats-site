import "server-only";

import { createHash } from "node:crypto";
import { appendFile, chmod, mkdir } from "node:fs/promises";
import { dirname } from "node:path";

import type { NotificationConfiguration } from "@/lib/notifications/config";
import { sendResendEmail, type ResendEmailSender } from "@/lib/email/resend-adapter";
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

function assertMessageEnvironment(message: OrderNotificationMessage, configuration: NotificationConfiguration) {
  if (message.deploymentEnvironment !== configuration.deploymentEnvironment) {
    throw new NotificationTransportError({
      code: "DEPLOYMENT_ENVIRONMENT_MISMATCH",
      message: "La notification appartient à un autre environnement.",
      retryable: false,
    });
  }
}

function captureTransport(configuration: NotificationConfiguration): NotificationTransport {
  return {
    async send(message, template) {
      assertMessageEnvironment(message, configuration);
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
  const audience = notificationDefinition(message.kind).audience;
  if (audience === "OWNER") {
    if (!configuration.ownerEmailEnabled || recipient !== configuration.ownerRecipient) {
      throw new NotificationTransportError({ code: "OWNER_DESTINATION_NOT_APPROVED", message: "La destination propriétaire n’est pas approuvée.", retryable: false });
    }
  } else {
    if (!configuration.clientEmailEnabled) {
      throw new NotificationTransportError({ code: "CLIENT_EMAIL_DISABLED", message: "Les notifications client sont désactivées.", retryable: false });
    }
    if (recipient !== normalizeNotificationRecipient(message.order.customerEmail)) {
      throw new NotificationTransportError({ code: "CLIENT_DESTINATION_MISMATCH", message: "La destination client ne correspond pas au compte de la commande.", retryable: false });
    }
    const stagingAllowed = isOfficialResendTestRecipient(recipient) || configuration.stagingRecipientAllowlist.includes(recipient);
    if (configuration.deploymentEnvironment === "staging" && !stagingAllowed) {
      throw new NotificationTransportError({ code: "STAGING_DESTINATION_NOT_APPROVED", message: "La destination staging n’est pas approuvée.", retryable: false });
    }
    if (configuration.deploymentEnvironment === "production" && (isOfficialResendTestRecipient(recipient) || recipient.endsWith("@resend.dev"))) {
      throw new NotificationTransportError({ code: "PRODUCTION_DESTINATION_NOT_APPROVED", message: "La destination production n’est pas approuvée.", retryable: false });
    }
  }
  return recipient;
}

function resendTransport(configuration: NotificationConfiguration, injectedSender?: ResendEmailSender): NotificationTransport {
  return {
    async send(message, template) {
      assertMessageEnvironment(message, configuration);
      assertIdempotencyKey(message.idempotencyKey);
      const recipient = assertResendRecipient(message, configuration);
      const providerMessageId = await sendResendEmail({
        apiKey: configuration.resendApiKey!,
        idempotencyKey: message.idempotencyKey,
        message: {
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
          tags: [
            { name: "lnx_source", value: "order_outbox" },
            { name: "lnx_environment", value: configuration.deploymentEnvironment },
          ],
        },
      }, injectedSender);
      return { provider: "RESEND", providerMessageId, deliveredImmediately: false };
    },
  };
}

export function createNotificationTransport(
  configuration: NotificationConfiguration,
  dependencies: { resendSender?: ResendEmailSender } = {},
): NotificationTransport {
  if (configuration.emailTransport === "capture") return captureTransport(configuration);
  if (configuration.emailTransport === "resend") return resendTransport(configuration, dependencies.resendSender);
  return {
    async send() {
      throw new NotificationTransportError({ code: "EMAIL_DISABLED", message: "Le transport e-mail est désactivé.", retryable: false });
    },
  };
}
