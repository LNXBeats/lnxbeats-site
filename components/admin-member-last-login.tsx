import { formatMemberLastLogin } from "@/lib/admin/member-presentation";

export function AdminMemberLastLogin({ lastLoginAt }: { lastLoginAt: Date | null }) {
  const formatted = formatMemberLastLogin(lastLoginAt);
  return (
    <p className="admin-v21-member-card__last-login">
      <span>Dernière connexion</span>
      {formatted && lastLoginAt ? (
        <time dateTime={lastLoginAt.toISOString()} title="Heure de Paris">
          {formatted} <span className="admin-v21-member-card__timezone">(Paris)</span>
        </time>
      ) : <span>Non renseignée</span>}
    </p>
  );
}
