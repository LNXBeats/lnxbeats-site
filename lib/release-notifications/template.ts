import { releaseAlertCopy } from "@/lib/release-notifications/messages";

function escape(value: string) { return value.replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!); }
export function releaseAlertTemplate(input: { locale: unknown; title: string; url: string; unsubscribeUrl: string }) {
  const copy = releaseAlertCopy(input.locale);
  if (!/^https?:\/\//.test(input.url) || !/^https?:\/\//.test(input.unsubscribeUrl)) throw new Error("INVALID_ALERT_URL");
  // The publication title is deliberately never translated.
  const title = input.title.replace(/[\r\n]/g, " ").slice(0, 240);
  return { subject: `${copy.subject} — ${title}`, text: `${copy.mailIntro}\n\n${title}\n${input.url}\n\n${copy.unsubscribe}\n${input.unsubscribeUrl}`,
    html: `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;padding:28px;background:#111;color:#f5f2e9"><p style="color:#ddbd68">LNX Beats</p><p>${escape(copy.mailIntro)}</p><h1 style="font-size:24px">${escape(title)}</h1><p><a href="${escape(input.url)}" style="display:inline-block;padding:14px 22px;background:#ddbd68;color:#111;border-radius:8px;text-decoration:none">${escape(copy.discover)}</a></p><hr style="border:0;border-top:1px solid #444"><p style="font-size:12px"><a href="${escape(input.unsubscribeUrl)}" style="color:#ddbd68">${escape(copy.unsubscribe)}</a></p></div>` };
}
