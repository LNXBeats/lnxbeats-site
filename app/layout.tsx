import type { Metadata, Viewport } from "next";
import { QuickAccessBar } from "@/components/quick-access-bar";
import { OrderJourneyProvider } from "@/components/order-journey-provider";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";
import { siteConfig } from "@/data/site";
import "./globals.css";
import "./visual-phase2.css";
import "./visual-phase3.css";
import "./v064-quick-access.css";
import "./v072-rights.css";
import "./v084-commander.css";

const siteUrl = process.env.SITE_URL ?? siteConfig.url;
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
  const structuredData = {
    "@context": "https://schema.org",
    "@type": "MusicGroup",
    name: siteConfig.name,
    url: siteUrl,
    sameAs: [...siteConfig.platforms, ...siteConfig.social].map((item) => item.url),
  };
  const serializedStructuredData = JSON.stringify(structuredData).replace(/</g, "\\u003c");

  return (
    <html lang="fr">
      <body>
        <a className="skip-link" href="#contenu">Aller au contenu</a>
        <OrderJourneyProvider>
          <SiteHeader />
          <QuickAccessBar />
          <main id="contenu">{children}</main>
          <SiteFooter />
        </OrderJourneyProvider>
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializedStructuredData }} />
      </body>
    </html>
  );
}
