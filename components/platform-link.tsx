type PlatformLinkProps = {
  name: string;
  url: string;
  compact?: boolean;
};

export function PlatformLink({ name, url, compact = false }: PlatformLinkProps) {
  const tone = name.toLowerCase().replaceAll(" ", "-");
  const action = name === "YouTube" ? "Voir sur YouTube" : `Écouter sur ${name}`;

  return (
    <a
      className={compact ? "platform-link platform-link--compact" : "platform-link"}
      data-platform={tone}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${action} — nouvel onglet`}
    >
      <span className="platform-link__mark" aria-hidden="true"><i /><i /><i /></span>
      <span><strong>{name}</strong>{compact ? null : <small>{action}</small>}</span>
      <span className="platform-link__arrow" aria-hidden="true">↗</span>
    </a>
  );
}
