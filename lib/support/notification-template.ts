import { SUPPORT_CONFIRMATION_LEGAL } from "@/lib/support/contact";
const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
export function supportEmailTemplate(value: { id: string; amountCents: number; provider: string; createdAt: Date;
  supporterEmail: string | null; supporterMessage: string | null }, audience: string) {
  const amount = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR" }).format(value.amountCents / 100);
  const admin = audience === "ADMIN";
  const subject = admin ? `Nouveau soutien LNX Beats — ${amount}` : "Merci pour votre soutien à LNX Beats ♡";
  const lines = [admin ? "Un nouveau soutien a été confirmé." : "Merci de faire vivre LNX Beats et de contribuer aux prochaines histoires.",
    `Montant : ${amount}`, `Date : ${value.createdAt.toLocaleString("fr-FR", { timeZone: "Europe/Paris" })} (Europe/Paris)`,
    `Prestataire : ${value.provider}`, `Référence LNX : ${value.id}`,
    ...(admin ? [`E-mail : ${value.supporterEmail ?? "Non renseigné"}`] : []),
    `Message : ${value.supporterMessage ?? "Aucun message"}`, SUPPORT_CONFIRMATION_LEGAL, "https://www.lnxbeats.fr"];
  return { subject, text: lines.join("\n\n"), html: `<!doctype html><html lang="fr"><body style="margin:0;background:#080a0a;color:#f8f4e9;font-family:Arial,sans-serif"><div style="max-width:600px;margin:32px auto;padding:32px;border:1px solid #b89a58;border-radius:20px"><p style="color:#dbb45f">SOUTENIR LNX BEATS</p><h1>${escape(admin ? "Un soutien qui compte." : "MERCI ♡")}</h1>${lines.slice(0,-1).map(line => `<p style="line-height:1.7;white-space:pre-wrap;overflow-wrap:anywhere">${escape(line)}</p>`).join("")}<a href="https://www.lnxbeats.fr" style="display:inline-block;padding:14px 22px;background:#dbb45f;color:#111;text-decoration:none;border-radius:8px">Découvrir LNX Beats</a></div></body></html>` };
}
