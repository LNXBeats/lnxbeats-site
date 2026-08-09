export const officialLinks = {
  featuredRelease: "https://youtu.be/TzhsaAotKWY",
  spotify: "https://open.spotify.com/artist/4Qqg1iO2aKxcV0e64Hkg5R",
  youtube: "https://youtube.com/@lnxbeats",
  appleMusic: "https://music.apple.com/fr/artist/lnx-beats/1856898446",
  deezer: "https://link.deezer.com/s/343dUyN0Jo0qIXG4hR6X2",
  amazonMusic: "https://music.amazon.fr/artists/B09VNR4Y3W",
  tiktok: "https://www.tiktok.com/@lnx.beats",
  instagram: "https://www.instagram.com/lnxbeats",
  distroKid: "https://direct.distrokid.com/lnxbeats2/",
  etsy: "https://lnxbeats.etsy.com/listing/4528037390",
} as const;

export const siteConfig = {
  name: "LNX Beats",
  url: "https://lnxbeats.fr",
  email: "lnx.beats.pro@gmail.com",
  featuredRelease: {
    title: "J’ai adopté un humain",
    url: officialLinks.featuredRelease,
  },
  platforms: [
    { name: "Spotify", url: officialLinks.spotify },
    { name: "YouTube", url: officialLinks.youtube },
    { name: "Apple Music", url: officialLinks.appleMusic },
    { name: "Deezer", url: officialLinks.deezer },
    { name: "Amazon Music", url: officialLinks.amazonMusic },
  ],
  social: [
    { name: "TikTok", url: officialLinks.tiktok },
    { name: "Instagram", url: officialLinks.instagram },
  ],
  shops: [
    { name: "DistroKid Direct", url: officialLinks.distroKid },
    { name: "Etsy", url: officialLinks.etsy },
  ],
} as const;

export const navigation = [
  { label: "Accueil", href: "/" },
  { label: "Discographie", href: "/discographie" },
  { label: "Commander une musique", href: "/commander" },
  { label: "Boutique", href: "/boutique" },
  { label: "À propos", href: "/a-propos" },
  { label: "Contact", href: "/contact" },
] as const;
