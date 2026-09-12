import Image from "next/image";

import { ExternalLinkIcon } from "@/components/link-icons";

type PlatformLinkProps = {
  icon?: string;
  name: string;
  url: string;
  compact?: boolean;
};

function platformAction(name: string) {
  if (name === "TikTok" || name === "Instagram") return `Suivre LNX Beats sur ${name}`;
  if (name === "YouTube") return "Voir LNX Beats sur YouTube";
  return `Écouter LNX Beats sur ${name}`;
}

export function PlatformLink({ icon, name, url, compact = false }: PlatformLinkProps) {
  const tone = name.toLowerCase().replaceAll(" ", "-");
  const action = platformAction(name);

  return (
    <a
      className={compact ? "platform-link platform-link--compact" : "platform-link"}
      data-platform={tone}
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
