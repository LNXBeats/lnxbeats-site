"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { ExternalLinkIcon } from "@/components/link-icons";

const adminNavigation = [
  { href: "/admin", label: "Accueil", group: "Accueil" },
  { href: "/admin/creations", label: "Créations & collaborations", group: "Créations" },
  { href: "/admin/catalogue", label: "Catalogue & discographie", group: "Créations" },
  { href: "/admin/commandes", label: "Commandes musicales", group: "Créations" },
  { href: "/admin/boutique", label: "Produits", group: "Boutique" },
  { href: "/admin/boutique/commandes", label: "Commandes Boutique", group: "Boutique" },
  { href: "/admin/boutique/retours", label: "SAV Boutique", group: "Boutique" },
  { href: "/admin/boutique/logistique", label: "Logistique / configuration", group: "Boutique" },
  { href: "/admin/membres", label: "Membres", group: "Clients & documents" },
  { href: "/admin/facturation", label: "Factures & avoirs", group: "Clients & documents" },
  { href: "/admin/tarifs", label: "Tarifs & paramètres", group: "Réglages" },
  { href: "/admin/nettoyage", label: "Nettoyage & archives", group: "Avancé" },
  { href: "/admin/notifications", label: "Notifications techniques", group: "Avancé" },
  { href: "/admin/droits", label: "Droits & contrats", group: "Avancé" },
] as const;

const adminNavigationGroups = ["Accueil", "Créations", "Boutique", "Clients & documents", "Réglages", "Avancé"] as const;

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
        {adminNavigationGroups.map((group) => {
          const items = adminNavigation.filter((item) => item.group === group);
          const primary = items[0];
          const groupIsActive = items.some((item) => activeHref === item.href);
          return <div className="admin-header__nav-group" key={group}>
          <Link className="admin-header__primary-link" href={primary.href} aria-current={activeHref === primary.href ? "page" : undefined} data-group-active={groupIsActive || undefined} onClick={closeNavigation}>{group}</Link>
          {items.length > 1 ? <details className="admin-header__subnav" open={groupIsActive}>
            <summary aria-label={`Rubriques ${group}`}>Rubriques <span aria-hidden="true">⌄</span></summary>
            <div className="admin-header__subnav-links">{items.slice(1).map((item) => {
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
          })}</div></details> : null}
        </div>;})}
        {qaProfileSwitchAvailable ? <Link href="/qa/access" onClick={closeNavigation}>Changer de profil QA</Link> : null}
        <Link className="admin-header__site-link" href="/" onClick={closeNavigation}>Retour au site <ExternalLinkIcon /></Link>
      </nav>
    </header>
  );
}
