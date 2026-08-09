type PlatformLinkProps = {
  name: string;
  url: string;
  compact?: boolean;
};

export function PlatformLink({ name, url, compact = false }: PlatformLinkProps) {
  return (
    <a
      className={compact ? "platform-link platform-link--compact" : "platform-link"}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${name} — ouvrir dans un nouvel onglet`}
    >
      <span className="platform-link__mark" aria-hidden="true" />
      <span>{name}</span>
      <span className="platform-link__arrow" aria-hidden="true">↗</span>
    </a>
  );
}
