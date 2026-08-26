import type { Metadata } from "next";

import { AdminBackLink } from "@/components/admin-back-link";
import { listAdminMembers } from "@/lib/admin/service";
import { requireAdmin } from "@/lib/auth/session";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Membres" };

const roleLabels = { ADMIN: "Administrateur", CUSTOMER: "Client", MEMBER: "Membre" } as const;
const statusLabels = { ACTIVE: "Actif", DEACTIVATED: "Désactivé", PENDING: "En attente", SUSPENDED: "Suspendu" } as const;

export default async function AdminMembersPage() {
  await requireAdmin();
  const members = await listAdminMembers();
  return (
    <div className="admin-main">
      <AdminBackLink href="/admin">Retour à l’Administration</AdminBackLink>
      <header className="admin-page-heading"><div><p className="admin-kicker">Membres</p><h1>Les accès LNX Beats.</h1></div><p>Cette vue permet uniquement de consulter les comptes. Les rôles et les accès sensibles ne sont pas modifiables ici.</p></header>
      <section className="admin-list-window" aria-labelledby="admin-members-title">
        <div className="admin-list-window__heading"><h2 id="admin-members-title">Comptes réels</h2><span>{members.length} membre{members.length === 1 ? "" : "s"}</span></div>
        {members.length ? <ul className="admin-member-list">{members.map((member) => <li key={member.id}><div><strong>{member.displayName || "Nom non renseigné"}</strong><a href={`mailto:${member.email}`}>{member.email}</a></div><dl><div><dt>Rôle</dt><dd>{roleLabels[member.role]}</dd></div><div><dt>Statut</dt><dd>{statusLabels[member.status]}</dd></div><div><dt>Email</dt><dd>{member.emailVerified ? "Vérifié" : "Non vérifié"}</dd></div><div><dt>Création</dt><dd>{member.createdAt.toLocaleDateString("fr-FR")}</dd></div></dl></li>)}</ul> : <div className="admin-empty"><h2>Aucun membre.</h2><p>Cette base ne contient actuellement aucun compte.</p></div>}
      </section>
    </div>
  );
}
