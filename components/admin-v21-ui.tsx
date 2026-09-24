import Link from "next/link";

import { AdminIcon, type AdminIconName } from "@/components/admin-icons";

export function AdminStatCard({ icon, title, count, caption, href, tone = "neutral" }: { icon: AdminIconName; title: string; count: number; caption: string; href: string; tone?: "neutral" | "attention" | "critical" }) {
  const effectiveTone = count === 0 ? "quiet" : tone;
  return <Link className="admin-v21-stat" href={href} data-tone={effectiveTone}>
    <span className="admin-v21-stat__top"><AdminIcon name={icon} /><span>{title}</span><AdminIcon name="arrow" /></span>
    <strong>{count}</strong><small>{count === 0 ? "Aucun dossier" : caption}</small>
  </Link>;
}

export function AdminStatusBadge({ label, tone = "neutral" }: { label: string; tone?: "neutral" | "ok" | "attention" | "critical" }) {
  return <span className="admin-v21-status" data-tone={tone}>{label}</span>;
}

export function AdminProgress({ value, label }: { value: number; label: string }) {
  const percent = Math.min(100, Math.max(0, Math.round(value)));
  return <div className="admin-v21-progress"><div><span>{label}</span><strong>{percent} %</strong></div><progress value={percent} max={100}>{percent} %</progress></div>;
}
