import { officialLinks, siteConfig } from "@/data/site";

export type ReleaseKind = "album" | "single" | "project";

export type Release = {
  readonly slug: string;
  readonly title: string;
  readonly kind: ReleaseKind;
  readonly artist: typeof siteConfig.name;
  readonly trackCount?: number;
  readonly featured?: boolean;
  readonly artwork?: string;
  readonly primaryUrl: string;
};

const artist = siteConfig.name;
const spotify = officialLinks.spotify;

export const releases: readonly Release[] = [
  {
    slug: "jai-adopte-un-humain",
    title: "J’ai adopté un humain",
    kind: "single",
    artist,
    featured: true,
    primaryUrl: officialLinks.featuredRelease,
  },
  { slug: "bienvenue-dans-le-bordel-familial", title: "Bienvenue dans le bordel familial", kind: "album", artist, trackCount: 18, primaryUrl: spotify },
  { slug: "jai-adopte", title: "J’ai adopté", kind: "album", artist, trackCount: 13, primaryUrl: spotify },
  { slug: "jai-adopte-un-humain-album", title: "J’ai adopté un humain", kind: "album", artist, trackCount: 16, primaryUrl: spotify },
  { slug: "les-comptines-version-adulte-v2", title: "Les comptines (version adulte) V2", kind: "album", artist, trackCount: 20, primaryUrl: spotify },
  { slug: "chaos-canin", title: "Chaos canin", kind: "album", artist, trackCount: 21, primaryUrl: spotify },
  { slug: "les-merdes-du-quotidien", title: "Les merdes du quotidien", kind: "album", artist, trackCount: 31, primaryUrl: spotify },
  { slug: "les-comptines-version-adulte", title: "Les comptines (version adulte)", kind: "album", artist, trackCount: 27, primaryUrl: spotify },
  { slug: "le-collegue-ambiance-toxique", title: "Le collègue « ambiance toxique »", kind: "album", artist, trackCount: 13, primaryUrl: spotify },
  { slug: "avant-vs-maintenant", title: "Avant vs maintenant", kind: "album", artist, trackCount: 16, primaryUrl: spotify },
  { slug: "les-employes-du-bureau", title: "Les employés du bureau", kind: "album", artist, trackCount: 25, primaryUrl: spotify },
  { slug: "ca-va-lfaire", title: "Ça va l’faire", kind: "single", artist, primaryUrl: spotify },
  { slug: "jai-adopte-un-bebe", title: "J’ai adopté un bébé", kind: "single", artist, primaryUrl: spotify },
  { slug: "jai-adopte-une-femme", title: "J’ai adopté une femme", kind: "single", artist, primaryUrl: spotify },
  { slug: "jai-adopte-un-homme", title: "J’ai adopté un homme", kind: "single", artist, primaryUrl: spotify },
  { slug: "jprefere-le-carton", title: "J’préfère le carton", kind: "single", artist, primaryUrl: spotify },
  { slug: "mon-humain-me-parle-bizarre", title: "Mon humain me parle bizarre", kind: "single", artist, primaryUrl: spotify },
  { slug: "la-galette-des-rois", title: "La galette des rois", kind: "single", artist, primaryUrl: spotify },
  { slug: "madame-piecettes", title: "Madame Piécettes", kind: "single", artist, primaryUrl: spotify },
] as const;

export const albums = releases.filter((release) => release.kind === "album");
export const singles = releases.filter((release) => release.kind === "single" && !release.featured);
