import type { Metadata } from "next";

import { AdminBackLink } from "@/components/admin-back-link";
import { AdminStatusBadge } from "@/components/admin-v21-ui";
import { listAdminMembers } from "@/lib/admin/service";
import { requireAdmin } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Membres" };

const roleLabels = { ADMIN: "Administrateur", CUSTOMER: "Client", MEMBER: "Membre" } as const;
const statusLabels = { ACTIVE: "Actif", DEACTIVATED: "Désactivé", PENDING: "En attente", SUSPENDED: "Suspendu" } as const;

export default async function AdminMembersPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireAdmin();
  const query = (await searchParams).q?.trim().slice(0, 120) ?? "";
  const members = await listAdminMembers(query);
  return (
    <div className="admin-main">
      <AdminBackLink href="/admin">Retour à l’Administration</AdminBackLink>
      <header className="admin-page-heading"><div><p className="admin-kicker">Clients & documents</p><h1>Membres</h1></div><p>Vue de consultation. Les rôles et accès sensibles ne sont pas modifiables ici.</p></header>
      <form className="admin-search-form" action="/admin/membres" method="get" role="search"><label htmlFor="member-search">Rechercher un membre</label><input id="member-search" name="q" defaultValue={query} maxLength={120} placeholder="Nom ou adresse e-mail" /><button className="admin-button" type="submit">Rechercher</button></form>
      <section className="admin-list-window" aria-labelledby="admin-members-title">
        <div className="admin-list-window__heading"><h2 id="admin-members-title">Comptes réels</h2><span>{members.length} membre{members.length === 1 ? "" : "s"}</span></div>
        {members.length ? <ul className="admin-v21-member-grid">{members.map((member) => <li key={member.id} className="admin-v21-member-card"><div className="admin-v21-member-card__heading"><span className="admin-v21-member-card__avatar" aria-hidden="true">{(member.displayName || member.email).trim().slice(0, 1).toLocaleUpperCase("fr-FR")}</span><div><strong>{member.displayName || "Nom non renseigné"}</strong><a href={`mailto:${member.email}`}>{member.email}</a></div><AdminStatusBadge label={statusLabels[member.status]} tone={member.status === "ACTIVE" ? "ok" : member.status === "SUSPENDED" ? "critical" : "neutral"} /></div><dl><div><dt>Commandes musicales</dt><dd>{member._count.orders}</dd></div><div><dt>Achats Boutique</dt><dd>{member._count.shopOrders}</dd></div><div><dt>Rôle</dt><dd>{roleLabels[member.role]}</dd></div><div><dt>Email</dt><dd>{member.emailVerified ? "Vérifié" : "Non vérifié"}</dd></div></dl><small>Compte créé le {member.createdAt.toLocaleDateString("fr-FR")} · consultation uniquement</small></li>)}</ul> : <div className="admin-empty"><h2>Aucun membre.</h2><p>Aucun compte ne correspond à cette recherche.</p></div>}
      </section>
    </div>
  );
}
