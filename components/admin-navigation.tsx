"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { ExternalLinkIcon } from "@/components/link-icons";

const adminNavigation = [
  { href: "/admin", label: "Vue d’ensemble", group: "Pilotage" },
  { href: "/admin/commandes", label: "Commandes", group: "Pilotage" },
  { href: "/admin/nettoyage", label: "Nettoyage & archives", group: "Pilotage" },
  { href: "/admin/boutique", label: "Boutique", group: "Commerce" },
  { href: "/admin/boutique/commandes", label: "Commandes Boutique", group: "Commerce" },
  { href: "/admin/boutique/logistique", label: "Logistique", group: "Commerce" },
  { href: "/admin/boutique/retours", label: "SAV Boutique", group: "Commerce" },
  { href: "/admin/tarifs", label: "Tarifs", group: "Commerce" },
  { href: "/admin/facturation", label: "Facturation", group: "Finance" },
  { href: "/admin/notifications", label: "Notifications", group: "Finance" },
  { href: "/admin/droits", label: "Droits & contrats", group: "Droits" },
  { href: "/admin/catalogue", label: "Catalogue", group: "Contenu" },
  { href: "/admin/membres", label: "Membres", group: "Comptes" },
] as const;

const adminNavigationGroups = ["Pilotage", "Commerce", "Finance", "Droits", "Contenu", "Comptes"] as const;

type AdminNavigationHref = (typeof adminNavigation)[number]["href"];

export type AdminNavigationActionCounts = Partial<Record<AdminNavigationHref, number>>;

function matchesAdminRoute(pathname: string, href: string) {
  return href === "/admin"
    ? pathname === href
    : pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminNavigation({
  displayName,
  qaProfileSwitchAvailable = false,
  actionRequiredCounts = {},
  criticalActionRequiredCounts = {},
}: {
  displayName?: string | null;
  qaProfileSwitchAvailable?: boolean;
  actionRequiredCounts?: AdminNavigationActionCounts;
  criticalActionRequiredCounts?: AdminNavigationActionCounts;
}) {
  const pathname = usePathname();
  const [navigationOpen, setNavigationOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const identity = displayName?.trim();
  const activeHref = adminNavigation
    .filter((item) => matchesAdminRoute(pathname, item.href))
    .reduce<string | null>(
      (longest, item) => !longest || item.href.length > longest.length ? item.href : longest,
      null,
    );

  useEffect(() => {
    if (!navigationOpen) return;

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setNavigationOpen(false);
      menuButtonRef.current?.focus();
    }

    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [navigationOpen]);

  function closeNavigation() {
    setNavigationOpen(false);
  }

  return (
    <header className="admin-header">
      <div className="admin-header__brand">
        <Link href="/admin" aria-label="LNX Admin — vue d’ensemble"><span>LNX</span> Admin</Link>
        <p>{identity ? `${identity} · Administrateur` : "Administrateur"}</p>
      </div>
      <button
        ref={menuButtonRef}
        className="admin-header__menu-button"
        type="button"
        aria-controls="admin-primary-navigation"
        aria-expanded={navigationOpen}
        aria-label={navigationOpen ? "Fermer le menu d’administration" : "Ouvrir le menu d’administration"}
        onClick={() => setNavigationOpen((open) => !open)}
      >
        <span>Menu</span>
        <span className="admin-header__menu-icon" aria-hidden="true"><i /><i /><i /></span>
      </button>
      <nav
        id="admin-primary-navigation"
        className={`admin-header__nav${navigationOpen ? " admin-header__nav--open" : ""}`}
        aria-label="Navigation de l’administration"
      >
        {adminNavigationGroups.map((group) => <div className="admin-header__nav-group" key={group}>
          <span className="admin-header__nav-group-label">{group}</span>
          {adminNavigation.filter((item) => item.group === group).map((item) => {
            const active = activeHref === item.href;
            const requestedCount = actionRequiredCounts[item.href] ?? 0;
            const actionCount = Number.isFinite(requestedCount) ? Math.max(0, Math.trunc(requestedCount)) : 0;
            const requestedCriticalCount = criticalActionRequiredCounts[item.href] ?? 0;
            const criticalCount = Number.isFinite(requestedCriticalCount)
              ? Math.min(actionCount, Math.max(0, Math.trunc(requestedCriticalCount)))
              : 0;
            return <Link aria-current={active ? "page" : undefined} key={item.href} href={item.href} onClick={closeNavigation}>
              <span>{item.label}</span>
              {actionCount > 0 ? <>
                <span className="admin-header__nav-badge" data-priority={criticalCount > 0 ? "critical" : "attention"} aria-hidden="true">{actionCount > 99 ? "99+" : actionCount}</span>
                <span className="visually-hidden"> · {actionCount} action{actionCount > 1 ? "s" : ""} requise{actionCount > 1 ? "s" : ""}{criticalCount > 0 ? `, dont ${criticalCount} critique${criticalCount > 1 ? "s" : ""}` : ""}</span>
              </> : null}
            </Link>;
          })}
        </div>)}
        {qaProfileSwitchAvailable ? <Link href="/qa/access" onClick={closeNavigation}>Changer de profil QA</Link> : null}
        <Link className="admin-header__site-link" href="/" onClick={closeNavigation}>Retour au site <ExternalLinkIcon /></Link>
      </nav>
    </header>
  );
}
