import "server-only";

import type { NotificationConfiguration } from "@/lib/notifications/config";
import {
  notificationDefinition,
  NOTIFICATION_PAYLOAD_VERSION,
  NOTIFICATION_TEMPLATE_VERSION,
  PRODUCTION_OWNER_EMAIL_SMOKE_IDEMPOTENCY_KEY,
} from "@/lib/notifications/domain";
import type { NotificationTemplate, OrderNotificationMessage } from "@/lib/notifications/types";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;",
  })[character]!);
}

function plainText(value: string) {
  return value.replaceAll("<", "‹").replaceAll(">", "›").replace(/[\r\n]+/g, " ");
}

function formatEuro(cents: number, currency: string) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(cents / 100);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Paris" }).format(new Date(value));
}

function canonicalOrigin(configuration: NotificationConfiguration) {
  if (configuration.canonicalUrl) return configuration.canonicalUrl;
  const parsed = new URL(process.env.AUTH_URL ?? process.env.SITE_URL ?? "http://localhost:3000");
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error("Notification origin is invalid.");
  return parsed.origin;
}

function resourceUrl(message: OrderNotificationMessage, configuration: NotificationConfiguration) {
  const owner = notificationDefinition(message.kind).audience === "OWNER";
  const rightsReference = message.kind.includes("RIGHTS") ? message.payload.rightsRequestNumber : undefined;
  const pathname = rightsReference
    ? `${owner ? "/admin/droits/" : "/compte/droits/"}${encodeURIComponent(rightsReference)}`
    : `${owner ? "/admin/commandes/" : "/compte/commandes/"}${encodeURIComponent(message.payload.orderNumber)}`;
  return new URL(pathname, canonicalOrigin(configuration)).toString();
}

function copy(message: OrderNotificationMessage) {
  if (message.idempotencyKey === PRODUCTION_OWNER_EMAIL_SMOKE_IDEMPOTENCY_KEY) {
    return {
      subject: "[TEST PRODUCTION] Vérification e-mail propriétaire LNX Studio",
      eyebrow: "Test Production",
      title: "Vérification e-mail propriétaire",
      body: "Ce message est un test one-shot autorisé. Il ne correspond à aucune commande, aucun client et aucun paiement réel.",
      cta: "Ouvrir l’Admin",
    } as const;
  }
  const values = {
    OWNER_NEW_ORDER: [
      `Nouvelle commande LNX Beats — ${message.payload.orderNumber}`,
      "Nouvelle commande payée", "Une commande attend votre revue",
      "Le paiement a été confirmé par le flux serveur. La commande est disponible dans l’Admin.", "Ouvrir la commande",
    ],
    CUSTOMER_PAYMENT_CONFIRMED: [
      "Paiement confirmé — votre commande LNX Beats", "Commande reçue", "Votre paiement est confirmé",
      "Votre commande est bien enregistrée. Vous pouvez suivre chaque étape depuis votre Compte LNX Beats.", "Suivre ma commande",
    ],
    CUSTOMER_ORDER_ACCEPTED: [
      "Votre commande LNX Beats est acceptée", "Commande acceptée", "LNX Beats prend en charge votre projet",
      "Votre commande a été examinée et acceptée. Son avancement reste disponible dans votre Compte.", "Voir l’avancement",
    ],
    CUSTOMER_CREATION_STARTED: [
      "La création de votre projet LNX Beats a commencé", "Création en cours", "Votre projet entre en production",
      "La création a commencé. Vous retrouverez les prochaines étapes dans votre Compte.", "Voir l’avancement",
    ],
    CUSTOMER_DELIVERY_READY: [
      "Votre création LNX Beats est disponible", "Livraison disponible", "Votre création est prête",
      "Votre master est disponible dans votre Compte. Le fichier audio n’est jamais joint à cet e-mail.", "Télécharger ma création",
    ],
    OWNER_RIGHTS_REQUESTED: [
      "Nouvelle demande de droits LNX Studio", "Droits & contrats", "Une demande attend votre revue",
      "Une demande de licence ou de partenariat a été soumise. Aucun droit et aucun paiement de droits ne sont actifs.", "Ouvrir la demande",
    ],
    CUSTOMER_RIGHTS_INFORMATION_REQUIRED: [
      "Informations complémentaires demandées", "Droits & contrats", "Une précision est nécessaire",
      "LNX Beats a besoin d’informations complémentaires pour poursuivre l’étude de votre demande.", "Répondre dans mon Compte",
    ],
    CUSTOMER_RIGHTS_PREAUTHORIZATION_READY: [
      "Votre projet de préautorisation est disponible", "Projet non actif", "Un document DRAFT est disponible",
      "Ce document reste un projet soumis à validation juridique. Il n’accorde aucun droit actif.", "Consulter le projet",
    ],
    CUSTOMER_RIGHTS_CONTRACT_READY: [
      "Votre projet de document est disponible", "Projet non actif", "Un nouveau document DRAFT est prêt à lire",
      "Lisez intégralement le document et vérifiez ses paramètres. Aucun droit n’est activé par cet e-mail.", "Consulter le document",
    ],
    OWNER_RIGHTS_CLIENT_ACCEPTED: [
      "Un projet de document a été accepté par le client", "Revue Admin requise", "Une acceptation attend votre contrôle",
      "La preuve d’acceptation est enregistrée. Aucun droit ni paiement n’est activé et la revue juridique reste obligatoire.", "Ouvrir la demande",
    ],
    CUSTOMER_RIGHTS_REJECTED: [
      "Décision sur votre demande de droits", "Droits & contrats", "Votre demande n’a pas été retenue",
      "Le motif humain de la décision est disponible dans votre Compte. Aucun paiement n’a été effectué.", "Consulter la décision",
    ],
    CUSTOMER_RIGHTS_READY_FOR_PAYMENT: [
      "Votre dossier est prêt pour une étape future", "Paiement non ouvert", "Votre dossier a franchi l’étape de revue",
      "Le paiement des droits restera fermé jusqu’aux validations juridique et technique. Aucun droit n’est actif.", "Consulter le dossier",
    ],
    CUSTOMER_PARTIAL_REFUND: [
      "Remboursement partiel confirmé — LNX Beats", "Paiement", "Votre remboursement partiel est confirmé",
      "Le remboursement a été confirmé par le prestataire. L’état de votre création reste visible séparément dans votre Compte.", "Voir ma commande",
    ],
    CUSTOMER_REFUND_COMPLETED: [
      "Remboursement total confirmé — LNX Beats", "Paiement", "Votre remboursement est confirmé",
      "Le remboursement total a été confirmé par le prestataire. Il ne réécrit pas l’historique de votre commande.", "Voir ma commande",
    ],
    OWNER_PAYMENT_INCIDENT: [
      "Incident de paiement à examiner — LNX Studio", "Paiement", "Une réconciliation opérateur est requise",
      "Un incident fournisseur a été enregistré sans modifier automatiquement l’état de la commande.", "Ouvrir la commande",
    ],
  } as const;
  const [subject, eyebrow, title, body, cta] = values[message.kind];
  return { subject, eyebrow, title, body, cta };
}

function layout(input: {
  preview: string; eyebrow: string; title: string; body: string; details: readonly string[];
  cta: string; url: string; environmentLabel: string | null;
}) {
  const prefix = input.environmentLabel ? `${input.environmentLabel}\n\n` : "";
  const text = [prefix + input.title, "", input.body, "", ...input.details.map(plainText), "", `${input.cta} : ${input.url}`, "", "LNX Beats · notification transactionnelle"].join("\n");
  const badge = input.environmentLabel ? `<tr><td style="padding:12px 28px;background:#7b5d14;color:#fff4c7;font:700 12px Arial,sans-serif;letter-spacing:.12em">${escapeHtml(input.environmentLabel)}</td></tr>` : "";
  const details = input.details.map((line) => `<div style="padding:4px 0;color:#ded8ca;font:14px/1.5 Arial,sans-serif">${escapeHtml(line)}</div>`).join("");
  const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(input.preview)}</title></head><body style="margin:0;background:#0d0d0d;color:#f6f2e8"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#0d0d0d"><tr><td align="center" style="padding:24px 12px"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:620px;background:#171717;border:1px solid #3b3425;border-radius:16px;overflow:hidden">${badge}<tr><td style="padding:30px 28px 12px;color:#d9b85b;font:700 13px Arial,sans-serif;letter-spacing:.16em">LNX BEATS · ${escapeHtml(input.eyebrow.toUpperCase())}</td></tr><tr><td style="padding:0 28px 10px"><h1 style="margin:0;color:#fffaf0;font:700 28px/1.2 Arial,sans-serif">${escapeHtml(input.title)}</h1></td></tr><tr><td style="padding:0 28px 20px;color:#cfc8b9;font:16px/1.65 Arial,sans-serif">${escapeHtml(input.body)}</td></tr><tr><td style="padding:0 28px 22px">${details}</td></tr><tr><td style="padding:0 28px 32px"><a href="${escapeHtml(input.url)}" style="display:inline-block;padding:14px 20px;background:#d9b85b;color:#111;text-decoration:none;border-radius:999px;font:700 14px Arial,sans-serif">${escapeHtml(input.cta)}</a></td></tr><tr><td style="padding:18px 28px;border-top:1px solid #332e24;color:#8f897c;font:12px/1.5 Arial,sans-serif">Notification transactionnelle LNX Beats. Aucun fichier audio, document privé ou donnée bancaire n’est joint à cet e-mail.</td></tr></table></td></tr></table></body></html>`;
  return { text, html };
}

export function orderNotificationTemplate(message: OrderNotificationMessage, configuration: NotificationConfiguration): NotificationTemplate {
  const definition = notificationDefinition(message.kind);
  if (
    message.templateKey !== definition.templateKey
    || message.templateVersion !== NOTIFICATION_TEMPLATE_VERSION
    || message.payloadVersion !== NOTIFICATION_PAYLOAD_VERSION
  ) {
    throw new Error("Notification template version is not supported.");
  }
  if (message.deploymentEnvironment !== configuration.deploymentEnvironment) {
    throw new Error("Notification template environment does not match the runtime.");
  }
  const content = copy(message);
  const options = [message.payload.coverIncluded ? "Illustration personnalisée" : "", message.payload.priorityProcessing ? "Priorité" : ""].filter(Boolean).join(", ") || "Aucune";
  const details = [
    `Commande : ${message.payload.orderNumber}`,
    ...(message.payload.rightsRequestNumber ? [`Demande : ${message.payload.rightsRequestNumber}`] : []),
    ...(message.kind === "OWNER_NEW_ORDER" ? [
      `Client : ${message.payload.customerName || "Non renseigné"} — ${message.payload.customerEmail}`,
      ...(message.payload.workTitle ? [`Projet : ${message.payload.workTitle}`] : []),
      `Montant : ${formatEuro(message.payload.totalCents, message.payload.currency)}`,
      `Options : ${options}`,
      `Date : ${formatDate(message.payload.createdAt)}`,
    ] : []),
    ...(message.payload.refundAmountCents ? [
      `Montant remboursé : ${formatEuro(message.payload.refundAmountCents, message.payload.currency)}`,
    ] : []),
  ];
  const environmentLabel = configuration.deploymentEnvironment === "production" ? null : configuration.deploymentEnvironment === "staging" ? "STAGING · MODE TEST" : "DÉVELOPPEMENT · CAPTURE";
  const rendered = layout({ ...content, preview: content.subject, details, url: resourceUrl(message, configuration), environmentLabel });
  const subject = configuration.deploymentEnvironment === "production" ? content.subject : `[TEST] ${content.subject}`;
  return { subject, ...rendered };
}
