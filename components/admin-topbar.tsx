import Link from "next/link";

import { AdminIcon } from "@/components/admin-icons";

export function AdminTopbar({ displayName, notificationCount }: { displayName: string | null | undefined; notificationCount: number }) {
  const identity = displayName?.trim() || "Admin";
  return <div className="admin-topbar">
    <form action="/admin/recherche" method="get" role="search" className="admin-topbar__search">
      <label htmlFor="admin-global-search" className="visually-hidden">Rechercher dans l’Administration</label>
      <AdminIcon name="search" />
      <input id="admin-global-search" name="q" type="search" maxLength={120} minLength={2} placeholder="Rechercher…" title="Commande, client, projet, facture ou avoir" autoComplete="off" />
      <button type="submit">Rechercher</button>
    </form>
    <div className="admin-topbar__utilities">
      <Link href="/admin/notifications?filtre=attention" className="admin-topbar__notification" aria-label={`${notificationCount} notification${notificationCount === 1 ? "" : "s"} à examiner`}>
        <AdminIcon name="bell" />{notificationCount > 0 ? <span>{notificationCount > 99 ? "99+" : notificationCount}</span> : null}
      </Link>
      <span className="admin-topbar__identity" title={identity}>{identity.slice(0, 1).toLocaleUpperCase("fr-FR")}<span>{identity}</span></span>
    </div>
  </div>;
}
