import Image from "next/image";

import { ExternalLinkIcon } from "@/components/link-icons";
import type { PublicCreationCollaborator } from "@/lib/creations/types";

const PLATFORM_PRESENTATION: Record<string, { label: string; icon?: string }> = {
  YOUTUBE: { label: "YouTube", icon: "/brands/youtube-icon.svg" },
  INSTAGRAM: { label: "Instagram", icon: "/brands/instagram-icon.svg" },
  TIKTOK: { label: "TikTok", icon: "/brands/tiktok-icon.svg" },
  SPOTIFY: { label: "Spotify", icon: "/brands/spotify-icon.svg" },
  APPLE_MUSIC: { label: "Apple Music", icon: "/brands/apple-music-icon.svg" },
  DEEZER: { label: "Deezer", icon: "/brands/deezer-icon.svg" },
  WEBSITE: { label: "Site web" },
  OTHER: { label: "Lien officiel" },
};

export function CreationCollaborators({ collaborators }: { collaborators: readonly PublicCreationCollaborator[] }) {
  if (!collaborators.length) return null;
  return <section className="creation-collaborators" aria-labelledby="creation-collaborators-title">
    <div className="creation-collaborators__heading">
      <p className="creation-detail-content__label">Collaboration</p>
      <h2 id="creation-collaborators-title">Avec celles et ceux qui font vivre le projet.</h2>
    </div>
    <div className="creation-collaborators__grid">
      {collaborators.map((collaborator) => <article className="creation-collaborator" key={collaborator.id}>
        <div>
          <h3>{collaborator.displayName}</h3>
          {collaborator.role ? <p>{collaborator.role}</p> : null}
        </div>
        {collaborator.links.length ? <ul aria-label={`Liens officiels de ${collaborator.displayName}`}>
          {collaborator.links.map((link) => {
            const platform = PLATFORM_PRESENTATION[link.platform] ?? PLATFORM_PRESENTATION.OTHER!;
            const label = link.label || platform.label;
            return <li key={link.id}><a href={link.url} target="_blank" rel="noopener noreferrer" aria-label={`${label} — ${collaborator.displayName}, nouvel onglet`}>
              <span className="creation-collaborator__icon" aria-hidden="true">{platform.icon
                ? <Image src={platform.icon} alt="" width={20} height={20} sizes="20px" />
                : <span>↗</span>}</span>
              <span>{label}</span>
              <ExternalLinkIcon />
            </a></li>;
          })}
        </ul> : null}
      </article>)}
    </div>
  </section>;
}
