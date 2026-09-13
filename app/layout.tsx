import type { Metadata, Viewport } from "next";
import { QuickAccessBar } from "@/components/quick-access-bar";
import { JsonLd } from "@/components/json-ld";
import { OrderJourneyProvider } from "@/components/order-journey-provider";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { SiteMotion } from "@/components/site-motion";
import { CANONICAL_SITE_ORIGIN } from "@/lib/seo/canonical";
import { buildSiteStructuredData } from "@/lib/seo/structured-data";
import "./globals.css";
import "./visual-phase2.css";
import "./visual-phase3.css";
import "./v064-quick-access.css";
import "./v072-rights.css";
import "./v085-mobile-polish.css";
import "./v0854-audio-payment.css";
import "./legal-compliance.css";
import "./v110-chrome-polish.css";
import "./v110-surface-polish.css";
import "./v120-ui-motion-polish.css";
import "./v120-ui-conformance-v2.css";
import "./v120-ui-conformance-v2-reference.css";
import "./v130-ui-refinement.css";
import "./v132-fluid-motion.css";

const siteUrl = CANONICAL_SITE_ORIGIN;
const socialImage = new URL("/og.png", siteUrl).toString();

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "LNX Beats — Site officiel",
    template: "%s — LNX Beats",
  },
  description: "LNX Beats transforme les scènes ordinaires, les souvenirs et les émotions en récits musicaux.",
  applicationName: "LNX Studio",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: "fr_FR",
    url: "/",
    siteName: "LNX Beats",
    title: "LNX Beats — Site officiel",
    description: "Chaque histoire mérite sa musique.",
    images: [{ url: socialImage, width: 1200, height: 630, alt: "LNX Beats — Chaque histoire mérite sa musique." }],
  },
  twitter: {
    card: "summary_large_image",
    title: "LNX Beats — Site officiel",
    description: "Chaque histoire mérite sa musique.",
    images: [socialImage],
  },
};

export const viewport: Viewport = {
  colorScheme: "dark",
  themeColor: "#080808",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body>
        <a className="skip-link" href="#contenu">Aller au contenu</a>
        <OrderJourneyProvider>
          <SiteHeader />
          <QuickAccessBar />
          <main id="contenu">{children}</main>
          <SiteFooter />
          <SiteMotion />
        </OrderJourneyProvider>
        <JsonLd id="lnx-site-identity" data={buildSiteStructuredData()} />
      </body>
    </html>
  );
}
