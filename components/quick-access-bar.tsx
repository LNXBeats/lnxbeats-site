"use client";
import { T, useSiteLanguage } from "@/components/site-language";


import Image from "next/image";
import { usePathname } from "next/navigation";

import { quickAccessPlatforms } from "@/data/site";
import { isQuickAccessRoute } from "@/lib/navigation/quick-access";

export function QuickAccessBar() {
  const { t } = useSiteLanguage();
  const pathname = usePathname();

  if (!isQuickAccessRoute(pathname)) return null;

  return (
    <div className="quick-access-slot" data-quick-access="true">
      <nav className="quick-access" aria-label={t("Accès rapide aux plateformes officielles")}>
        <div className="quick-access__heading" aria-hidden="true">
          <strong><T text="Accès rapide"/></strong>
          <span><T text="Écouter et suivre"/></span>
        </div>
        <ul className="quick-access__rail">
          {quickAccessPlatforms.map((platform) => (
            <li key={platform.name}>
              <a
                className={`quick-access__link quick-access__link--${platform.tone}`}
                href={platform.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={t("{platform} — ouvrir le profil officiel dans un nouvel onglet", { platform: platform.name })}
              >
                <span className="quick-access__icon" aria-hidden="true">
                  <Image src={platform.icon} alt="" width={24} height={24} sizes="24px" />
                </span>
                <span translate="no" className="notranslate">{platform.name}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
