import type { Metadata } from "next";

export function createPublicPageMetadata(input: Readonly<{
  title: string;
  description: string;
  pathname: string;
  socialTitle?: string;
  image?: string;
  imageAlt?: string;
}>): Metadata {
  const socialTitle = input.socialTitle ?? `${input.title} — LNX Beats`;
  const image = input.image ?? "/og.png";
  const imageAlt = input.imageAlt ?? "LNX Beats — Chaque histoire mérite sa musique.";
  return {
    title: input.title,
    description: input.description,
    alternates: { canonical: input.pathname },
    openGraph: {
      type: "website",
      url: input.pathname,
      title: socialTitle,
      description: input.description,
      images: [{ url: image, width: 1200, height: 630, alt: imageAlt }],
    },
    twitter: { card: "summary_large_image", title: socialTitle, description: input.description, images: [image] },
  };
}
