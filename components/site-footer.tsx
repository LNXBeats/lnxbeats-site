
import { T } from "@/components/site-language";
import { OriginalName } from "@/components/original-name";
import { LocalizedEditorial } from "@/components/localized-editorial";
import { getSiteLocale, serverT } from "@/lib/i18n/server";
import Link from "next/link";
import { BrandMotionToggle, BrandSignature } from "@/components/brand-signature";
import { Container } from "@/components/container";
import { ExternalLinkIcon } from "@/components/link-icons";
import { navigation, siteConfig } from "@/data/site";
import { isSupportEnabled } from "@/lib/support/config";

export async function SiteFooter() {
  const locale = await getSiteLocale();
  const t = (source: string, values?: Record<string, string | number>) => serverT(locale, source, values);
  return (
    <footer className="site-footer" lang={locale === "zh" ? "zh-Hans" : locale}>
      <Container>
        <div className="site-footer__signature" aria-hidden="true">
          <BrandSignature />
        </div>
        <div className="site-footer__top">
          <div className="site-footer__statement">
            <p className="eyebrow"><OriginalName>LNX Beats</OriginalName></p>
            <p><T text="Chaque histoire mérite sa musique." /></p>
          </div>

          <div className="site-footer__navigation">
            <div className="site-footer__columns site-footer__columns--desktop">
              <div>
                <h2><T text="Les portes"/></h2>
                {navigation.map((item) => <Link key={item.href} href={item.href}><T text={item.label}/></Link>)}
              </div>
              <div>
                <h2><T text="Les voix"/></h2>
                {siteConfig.platforms.map((platform) => (
                  <a key={platform.name} href={platform.url} target="_blank" rel="noopener noreferrer" aria-label={t("{name} — nouvel onglet", { name: platform.name })}><OriginalName>{platform.name}</OriginalName></a>
                ))}
              </div>
              <div>
                <h2><T text="Prolonger l’histoire"/></h2>
                {[...siteConfig.social, ...siteConfig.shops].map((item) => (
                  <a
                    key={item.name}
                    className={siteConfig.shops.some((shop) => shop.url === item.url) ? "site-footer__shop-link" : undefined}
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={t("{name} — nouvel onglet", { name: t(item.name) })}
                  >
                    <LocalizedEditorial text={item.name} names={["DistroKid", "TikTok", "Instagram"]}/>
                    {siteConfig.shops.some((shop) => shop.url === item.url) ? <ExternalLinkIcon className="site-footer__external-icon" /> : null}
                  </a>
                ))}
                <a href={`mailto:${siteConfig.email}`}><T text="E-mail"/></a>
                {isSupportEnabled() ? <Link href="/soutenir"><T text="Soutenir LNX Beats"/></Link> : null}
              </div>
            </div>
            <div className="site-footer__columns site-footer__columns--mobile">
              <details className="site-footer__group">
                <summary><T text="Les portes"/></summary>
                <div className="site-footer__group-links">
                  {navigation.map((item) => <Link key={item.href} href={item.href}><T text={item.label}/></Link>)}
                </div>
              </details>
              <details className="site-footer__group">
                <summary><T text="Les voix"/></summary>
                <div className="site-footer__group-links">
                  {siteConfig.platforms.map((platform) => (
                    <a key={platform.name} href={platform.url} target="_blank" rel="noopener noreferrer" aria-label={t("{name} — nouvel onglet", { name: platform.name })}><OriginalName>{platform.name}</OriginalName></a>
                  ))}
                </div>
              </details>
              <details className="site-footer__group">
                <summary><T text="Prolonger l’histoire"/></summary>
                <div className="site-footer__group-links">
                  {[...siteConfig.social, ...siteConfig.shops].map((item) => (
                    <a
                      key={item.name}
                      className={siteConfig.shops.some((shop) => shop.url === item.url) ? "site-footer__shop-link" : undefined}
                      href={item.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={t("{name} — nouvel onglet", { name: t(item.name) })}
                    >
                      <LocalizedEditorial text={item.name} names={["DistroKid", "TikTok", "Instagram"]}/>
                      {siteConfig.shops.some((shop) => shop.url === item.url) ? <ExternalLinkIcon className="site-footer__external-icon" /> : null}
                    </a>
                  ))}
                  <a href={`mailto:${siteConfig.email}`}><T text="E-mail"/></a>
                  {isSupportEnabled() ? <Link href="/soutenir"><T text="Soutenir LNX Beats"/></Link> : null}
                </div>
              </details>
            </div>
          </div>
        </div>

        <div className="site-footer__bottom">
          <p>© {new Date().getFullYear()} <OriginalName>LNX Beats</OriginalName>. <T text="Tous droits réservés." /></p>
          <nav aria-label={t("Informations légales")}>
            <Link href="/mentions-legales"><T text="Mentions légales"/></Link>
            <Link href="/confidentialite"><T text="Confidentialité"/></Link>
            <Link href="/cgv"><T text="CGV"/></Link>
            <Link href="/retractation"><T text="Rétractation"/></Link>
            <Link href="/contact"><T text="Contact"/></Link>
            <a href="https://www.cm2c.net/" target="_blank" rel="noopener noreferrer"><T text="Médiation CM2C"/></a>
            <BrandMotionToggle />
          </nav>
        </div>
      </Container>
    </footer>
  );
}
