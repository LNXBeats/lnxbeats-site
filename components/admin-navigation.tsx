"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { ExternalLinkIcon } from "@/components/link-icons";

const adminNavigation = [
  { href: "/admin", label: "Vue d’ensemble" },
  { href: "/admin/commandes", label: "Commandes" },
  { href: "/admin/droits", label: "Droits & contrats" },
  { href: "/admin/notifications", label: "Notifications" },
  { href: "/admin/tarifs", label: "Tarifs" },
  { href: "/admin/boutique", label: "Boutique" },
  { href: "/admin/catalogue", label: "Catalogue" },
  { href: "/admin/membres", label: "Membres" },
] as const;

export function AdminNavigation({
  displayName,
  qaProfileSwitchAvailable = false,
}: {
  displayName?: string | null;
  qaProfileSwitchAvailable?: boolean;
}) {
  const pathname = usePathname();
  const identity = displayName?.trim();

  return (
    <header className="admin-header">
      <div className="admin-header__brand">
        <Link href="/admin" aria-label="LNX Admin — vue d’ensemble"><span>LNX</span> Admin</Link>
        <p>{identity ? `${identity} · Administrateur` : "Administrateur"}</p>
      </div>
      <nav className="admin-header__nav" aria-label="Navigation de l’administration">
        {adminNavigation.map((item) => {
          const active = item.href === "/admin"
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(`${item.href}/`);
          return <Link aria-current={active ? "page" : undefined} key={item.href} href={item.href}>{item.label}</Link>;
        })}
        {qaProfileSwitchAvailable ? <Link href="/qa/access">Changer de profil QA</Link> : null}
        <Link className="admin-header__site-link" href="/">Retour au site <ExternalLinkIcon /></Link>
      </nav>
    </header>
  );
}
