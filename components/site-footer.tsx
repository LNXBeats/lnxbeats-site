import Link from "next/link";
import { Container } from "@/components/container";
import { navigation, siteConfig } from "@/data/site";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <Container>
        <div className="site-footer__top">
          <div className="site-footer__statement">
            <p className="eyebrow">LNX Beats</p>
            <p>Des histoires vécues.<br />Des morceaux qui restent.</p>
          </div>

          <div className="site-footer__columns">
            <div>
              <h2>Navigation</h2>
              {navigation.map((item) => <Link key={item.href} href={item.href}>{item.label}</Link>)}
            </div>
            <div>
              <h2>Écouter</h2>
              {siteConfig.platforms.map((platform) => (
                <a key={platform.name} href={platform.url} target="_blank" rel="noopener noreferrer">{platform.name}</a>
              ))}
            </div>
            <div>
              <h2>Suivre & acheter</h2>
              {[...siteConfig.social, ...siteConfig.shops].map((item) => (
                <a key={item.name} href={item.url} target="_blank" rel="noopener noreferrer">{item.name}</a>
              ))}
              <a href={`mailto:${siteConfig.email}`}>E-mail</a>
            </div>
          </div>
        </div>

        <div className="site-footer__bottom">
          <p>© {new Date().getFullYear()} LNX Beats. Tous droits réservés.</p>
          <nav aria-label="Informations légales">
            <Link href="/mentions-legales">Mentions légales</Link>
            <Link href="/confidentialite">Confidentialité</Link>
            <Link href="/cgv">CGV</Link>
          </nav>
        </div>
      </Container>
    </footer>
  );
}
