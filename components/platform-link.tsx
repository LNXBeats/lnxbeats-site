import Image from "next/image";

import { ExternalLinkIcon } from "@/components/link-icons";
import styles from "./platform-link.module.css";

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

function platformDescription(name: string) {
  if (name === "YouTube") return "Clips, morceaux et coulisses";
  if (name === "TikTok") return "Extraits et découvertes";
  if (name === "Instagram") return "Actualités et coulisses";
  return "Écouter la musique";
}

export function PlatformLink({ icon, name, url, compact = false, featured = false }: PlatformLinkProps) {
  const tone = name.toLowerCase().replaceAll(" ", "-");
  const action = platformAction(name);
  const className = [
    styles.link,
    compact ? styles.compact : null,
    featured ? styles.featured : null,
  ].filter(Boolean).join(" ");

  return (
    <a
      className={className}
      data-platform-link
      data-platform={tone}
      data-featured={featured ? "true" : undefined}
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`${action} — nouvel onglet`}
    >
      <span className={styles.mark} aria-hidden="true">
        {icon ? <Image src={icon} alt="" width={32} height={32} sizes="32px" /> : <><i /><i /><i /></>}
      </span>
      <span className={styles.copy}><strong>{name}</strong>{compact ? null : <small>{platformDescription(name)}</small>}</span>
      <span className={styles.termination}><ExternalLinkIcon className={styles.arrow} /></span>
    </a>
  );
}
