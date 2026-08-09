export const siteConfig = {
  name: "LNX Beats",
  studioName: "LNX Studio",
  url: "https://lnxbeats.fr",
  email: "lnx.beats.pro@gmail.com",
  featuredRelease: {
    title: "J’ai adopté un humain",
    url: "https://youtu.be/TzhsaAotKWY",
  },
  platforms: [
    { name: "Spotify", url: "https://open.spotify.com/artist/4Qqg1iO2aKxcV0e64Hkg5R" },
    { name: "YouTube", url: "https://youtube.com/@lnxbeats" },
    { name: "Apple Music", url: "https://music.apple.com/fr/artist/lnx-beats/1856898446" },
    { name: "Deezer", url: "https://link.deezer.com/s/343dUyN0Jo0qIXG4hR6X2" },
    { name: "Amazon Music", url: "https://music.amazon.fr/artists/B09VNR4Y3W" },
  ],
  social: [
    { name: "TikTok", url: "https://www.tiktok.com/@lnx.beats" },
    { name: "Instagram", url: "https://www.instagram.com/lnxbeats" },
  ],
  shops: [
    { name: "DistroKid Direct", url: "https://direct.distrokid.com/lnxbeats2/" },
    { name: "Etsy", url: "https://lnxbeats.etsy.com/listing/4528037390" },
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
