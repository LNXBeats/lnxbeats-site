import Link from "next/link";

const adminNavigation = [
  { href: "/admin", label: "Vue d’ensemble" },
  { href: "/admin/commandes", label: "Commandes" },
  { href: "/admin/droits", label: "Droits & contrats" },
  { href: "/admin/catalogue", label: "Catalogue" },
  { href: "/admin/membres", label: "Membres" },
] as const;

export function AdminNavigation({ displayName }: { displayName?: string | null }) {
  const identity = displayName?.trim();

  return (
    <header className="admin-header">
      <div className="admin-header__brand">
        <Link href="/admin" aria-label="LNX Admin — vue d’ensemble"><span>LNX</span> Admin</Link>
        <p>{identity ? `${identity} · Administrateur` : "Administrateur"}</p>
      </div>
      <nav aria-label="Navigation de l’administration">
        {adminNavigation.map((item) => <Link key={item.href} href={item.href}>{item.label}</Link>)}
        <Link className="admin-header__site-link" href="/">Retour au site <span aria-hidden="true">↗</span></Link>
      </nav>
    </header>
  );
}
