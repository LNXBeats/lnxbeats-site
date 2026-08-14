import type { NotificationTemplate, OrderNotificationMessage } from "@/lib/notifications/types";

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#039;",
  })[character]!);
}

function formatEuro(cents: number) {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(cents / 100);
}

function canonicalOrigin() {
  const value = process.env.AUTH_URL ?? process.env.SITE_URL ?? "http://localhost:3000";
  const origin = new URL(value);
  if (origin.username || origin.password || origin.search || origin.hash) {
    throw new Error("Notification origin is invalid.");
  }
  return origin.origin;
}

export function orderNotificationTemplate(message: OrderNotificationMessage): NotificationTemplate {
  const accountUrl = new URL(
    message.kind === "OWNER_NEW_ORDER"
      ? `/admin/commandes/${encodeURIComponent(message.order.orderNumber)}`
      : `/compte/commandes/${encodeURIComponent(message.order.orderNumber)}`,
    canonicalOrigin(),
  ).toString();

  if (message.kind === "CUSTOMER_DELIVERY_READY") {
    const subject = "Votre création LNX Beats est disponible";
    const text = [
      subject,
      "",
      `Commande : ${message.order.orderNumber}`,
      "Votre création est prête.",
      "Téléchargez-la depuis votre Compte LNX Beats :",
      accountUrl,
      "",
      "Le fichier audio n’est jamais joint à cet email.",
    ].join("\n");
    return {
      subject,
      text,
      html: `<h1>${escapeHtml(subject)}</h1><p>Commande : <strong>${escapeHtml(message.order.orderNumber)}</strong></p><p>Votre création est prête.</p><p><a href="${escapeHtml(accountUrl)}">Télécharger ma création depuis mon Compte</a></p><p>Le fichier audio n’est jamais joint à cet email.</p>`,
    };
  }

  const options = [
    message.order.coverIncluded ? "Cover" : "",
    message.order.priorityProcessing ? "Priorité" : "",
  ].filter(Boolean).join(", ") || "Aucune";
  const client = [message.order.customerName, message.order.customerEmail].filter(Boolean).join(" — ");
  const subject = "Nouvelle commande LNX Beats";
  const text = [
    subject,
    "",
    `Commande : ${message.order.orderNumber}`,
    `Client : ${client}`,
    `Montant : ${formatEuro(message.order.totalCents)}`,
    `Options : ${options}`,
    `Date : ${message.order.createdAt.toLocaleString("fr-FR")}`,
    "",
    `Ouvrir la commande : ${accountUrl}`,
  ].join("\n");
  return {
    subject,
    text,
    html: `<h1>${escapeHtml(subject)}</h1><p>Commande : <strong>${escapeHtml(message.order.orderNumber)}</strong></p><p>Client : ${escapeHtml(client)}</p><p>Montant : ${escapeHtml(formatEuro(message.order.totalCents))}</p><p>Options : ${escapeHtml(options)}</p><p>Date : ${escapeHtml(message.order.createdAt.toLocaleString("fr-FR"))}</p><p><a href="${escapeHtml(accountUrl)}">Ouvrir la commande dans l’Admin</a></p>`,
  };
}
