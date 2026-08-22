import Link from "next/link";

const adminNavigation = [
  { href: "/admin", label: "Vue d’ensemble" },
  { href: "/admin/commandes", label: "Commandes" },
  { href: "/admin/droits", label: "Droits & contrats" },
  { href: "/admin/notifications", label: "Notifications" },
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
  const identity = displayName?.trim();

  return (
    <header className="admin-header">
      <div className="admin-header__brand">
        <Link href="/admin" aria-label="LNX Admin — vue d’ensemble"><span>LNX</span> Admin</Link>
        <p>{identity ? `${identity} · Administrateur` : "Administrateur"}</p>
      </div>
      <nav aria-label="Navigation de l’administration">
        {adminNavigation.map((item) => <Link key={item.href} href={item.href}>{item.label}</Link>)}
        {qaProfileSwitchAvailable ? <Link href="/qa/access">Changer de profil QA</Link> : null}
        <Link className="admin-header__site-link" href="/">Retour au site <span aria-hidden="true">↗</span></Link>
      </nav>
    </header>
  );
}
