"use client";

import { useId, useState } from "react";

import { automaticPlatformLabel, platformName } from "@/lib/catalog/platform-label";
import type { PlatformId } from "@/lib/catalog/types";

const platforms: readonly PlatformId[] = ["spotify", "appleMusic", "deezer", "youtube", "amazonMusic", "distroKid", "other"];

export function CatalogPlatformLinkFields({
  initialPlatform = "youtube",
  initialScope = "release",
  initialUrl = "",
  initialOverride = "",
}: {
  initialPlatform?: PlatformId;
  initialScope?: "release" | "store";
  initialUrl?: string;
  initialOverride?: string;
}) {
  const id = useId();
  const [platform, setPlatform] = useState<PlatformId>(initialPlatform);
  const [scope, setScope] = useState<"release" | "store">(initialScope);
  const [override, setOverride] = useState(initialOverride);
  const automatic = automaticPlatformLabel(platform, scope);
  const preview = override.trim() || automatic;

  return <div className="admin-form-grid admin-platform-fields">
    <label htmlFor={`${id}-platform`}><span>Plateforme</span><select id={`${id}-platform`} name="platform" value={platform} onChange={(event) => setPlatform(event.target.value as PlatformId)}>{platforms.map((value) => <option key={value} value={value}>{platformName(value)}</option>)}</select></label>
    <label htmlFor={`${id}-scope`}><span>Portée</span><select id={`${id}-scope`} name="scope" value={scope} onChange={(event) => setScope(event.target.value as "release" | "store")}><option value="release">Parution</option><option value="store">Boutique</option></select></label>
    <label className="admin-form-wide" htmlFor={`${id}-url`}><span>URL HTTPS</span><input id={`${id}-url`} name="url" type="url" maxLength={2000} defaultValue={initialUrl} required /></label>
    <p className="admin-platform-preview admin-form-wide" aria-live="polite">Le bouton affichera : <strong>{preview}</strong></p>
    <details className="admin-form-wide admin-secondary-fields">
      <summary>Personnaliser le libellé</summary>
      <div><label htmlFor={`${id}-label`}><span>Libellé facultatif</span><input id={`${id}-label`} name="label" maxLength={180} value={override} placeholder={automatic} onChange={(event) => setOverride(event.target.value)} /></label></div>
    </details>
  </div>;
}
