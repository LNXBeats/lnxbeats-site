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
  const ownerNotification = message.kind === "OWNER_NEW_ORDER"
    || message.kind === "OWNER_RIGHTS_REQUESTED"
    || message.kind === "OWNER_RIGHTS_CLIENT_ACCEPTED";
  const accountUrl = new URL(
    ownerNotification
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

  const rightsMessages = {
    OWNER_RIGHTS_REQUESTED: ["Nouvelle demande de droits LNX Studio", "Une nouvelle demande de droits attend une revue dans l’Admin."],
    CUSTOMER_RIGHTS_INFORMATION_REQUIRED: ["Informations complémentaires demandées", "LNX Beats a besoin d’une précision pour poursuivre l’étude de votre demande."],
    CUSTOMER_RIGHTS_PREAUTHORIZATION_READY: ["Votre projet de préautorisation est disponible", "Un document non actif, soumis à validation juridique, est disponible dans votre Compte."],
    CUSTOMER_RIGHTS_CONTRACT_READY: ["Votre projet de contrat est prêt à lire", "Vérifiez intégralement le document et ses paramètres avant toute acceptation."],
    OWNER_RIGHTS_CLIENT_ACCEPTED: ["Un projet de contrat a été accepté par le client", "La preuve d’acceptation attend une revue Admin. Aucun droit ni paiement n’est activé."],
    CUSTOMER_RIGHTS_REJECTED: ["Décision sur votre demande de droits", "Votre demande n’a pas été retenue. Le motif est disponible dans votre Compte."],
    CUSTOMER_RIGHTS_READY_FOR_PAYMENT: ["Votre dossier est prêt pour une étape future", "Le paiement restera fermé jusqu’à validation juridique et technique."],
  } as const;
  if (message.kind in rightsMessages) {
    const [subject, body] = rightsMessages[message.kind as keyof typeof rightsMessages];
    const text = [subject, "", `Commande : ${message.order.orderNumber}`, body, "", `Consulter le dossier : ${accountUrl}`].join("\n");
    return {
      subject,
      text,
      html: `<h1>${escapeHtml(subject)}</h1><p>Commande : <strong>${escapeHtml(message.order.orderNumber)}</strong></p><p>${escapeHtml(body)}</p><p><a href="${escapeHtml(accountUrl)}">Consulter le dossier</a></p>`,
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
