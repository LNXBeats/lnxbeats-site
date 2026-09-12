import Image from "next/image";

import { ExternalLinkIcon } from "@/components/link-icons";

type PlatformLinkProps = {
  icon?: string;
  name: string;
  url: string;
  compact?: boolean;
  featured?: boolean;
};

function platformAction(name: string) {
  if (name === "TikTok" || name === "Instagram") return `Suivre LNX Beats sur ${name}`;
  if (name === "YouTube") return "Regarder et écouter LNX Beats sur YouTube";
  return `Écouter LNX Beats sur ${name}`;
}

export function PlatformLink({ icon, name, url, compact = false, featured = false }: PlatformLinkProps) {
  const tone = name.toLowerCase().replaceAll(" ", "-");
  const action = platformAction(name);
  const className = [
    "platform-link",
    compact ? "platform-link--compact" : null,
    featured ? "platform-link--featured" : null,
  ].filter(Boolean).join(" ");

  return (
    <a
      className={className}
      data-platform={tone}
      data-featured={featured ? "true" : undefined}
      data-motion-tilt={compact ? undefined : "contact-card"}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${action} — nouvel onglet`}
    >
      <span className={`platform-link__mark${icon ? " platform-link__mark--brand" : ""}`} aria-hidden="true">
        {icon ? <Image src={icon} alt="" width={24} height={24} sizes="24px" /> : <><i /><i /><i /></>}
      </span>
      <span><strong>{name}</strong>{compact ? null : <small>{action}</small>}</span>
      <ExternalLinkIcon className="platform-link__arrow link-icon" />
    </a>
  );
}
