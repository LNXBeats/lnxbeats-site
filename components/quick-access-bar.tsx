"use client";

import Image from "next/image";
import { usePathname } from "next/navigation";

import { quickAccessPlatforms } from "@/data/site";
import { isQuickAccessRoute } from "@/lib/navigation/quick-access";

export function QuickAccessBar() {
  const pathname = usePathname();

  if (!isQuickAccessRoute(pathname)) return null;

  return (
    <div className="quick-access-slot" data-quick-access="true">
      <nav className="quick-access" aria-label="Accès rapide aux plateformes officielles">
        <div className="quick-access__heading" aria-hidden="true">
          <strong>Accès rapide</strong>
          <span>Écouter et suivre</span>
        </div>
        <ul className="quick-access__rail">
          {quickAccessPlatforms.map((platform) => (
            <li key={platform.name}>
              <a
                className={`quick-access__link quick-access__link--${platform.tone}`}
                href={platform.url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`${platform.name} — ouvrir le profil officiel dans un nouvel onglet`}
              >
                <span className="quick-access__icon" aria-hidden="true">
                  <Image src={platform.icon} alt="" width={24} height={24} sizes="24px" />
                </span>
                <span>{platform.name}</span>
              </a>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}
