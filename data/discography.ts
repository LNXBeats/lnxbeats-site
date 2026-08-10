import { officialLinks } from "@/data/site";

export type ProjectKind = "album" | "single" | "project";
export type ProjectStatus = "published" | "in-development" | "archive";
export type TrackStatus = "released" | "announced" | "unlisted";
export type ArtworkTone = "gold" | "wine" | "graphite" | "bronze" | "ivory";
export type PlatformId = "spotify" | "appleMusic" | "deezer" | "youtube" | "distroKid";
export type DataConfidence = "confirmed" | "partial" | "placeholder" | "unknown";
export type CreditRole = "artist" | "writer" | "composer" | "producer" | "featuring" | "other";

export type ProjectTrack = {
  readonly number: number;
  readonly title: string;
  readonly duration?: string;
  readonly status?: TrackStatus;
};

export type ProjectPlatform = {
  readonly platform: PlatformId;
  readonly label: string;
  readonly url: string;
  readonly scope: "release" | "artist" | "store";
};

export type ProjectCredit = {
  readonly name: string;
  readonly role: CreditRole;
  readonly detail?: string;
};

export type ProjectDataConfidence = {
  readonly overall: DataConfidence;
  readonly identity: DataConfidence;
  readonly editorial: DataConfidence;
  readonly release: DataConfidence;
  readonly artwork: DataConfidence;
  readonly tracklist: DataConfidence;
  readonly platforms: DataConfidence;
  readonly genres: DataConfidence;
  readonly credits: DataConfidence;
  readonly seo: DataConfidence;
};

export type Project = {
  readonly slug: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly type: ProjectKind;
  readonly year: number | null;
  readonly releaseDate: string | null;
  readonly description: string;
  readonly shortDescription: string;
  readonly cover: string | null;
  readonly coverAlt?: string;
  readonly featured: boolean;
  readonly status: ProjectStatus;
  readonly genres: readonly string[];
  readonly credits: readonly ProjectCredit[];
  readonly tracks: readonly ProjectTrack[];
  readonly trackCount: number | null;
  readonly platforms: readonly ProjectPlatform[];
  readonly seo: {
    readonly title?: string;
    readonly description: string;
  };
  readonly artworkTone: ArtworkTone;
  readonly dataConfidence: ProjectDataConfidence;
};

const artistPlatforms: readonly ProjectPlatform[] = [
  { platform: "spotify", label: "Suivre LNX Beats sur Spotify", url: officialLinks.spotify, scope: "artist" },
  { platform: "appleMusic", label: "Suivre LNX Beats sur Apple Music", url: officialLinks.appleMusic, scope: "artist" },
  { platform: "deezer", label: "Suivre LNX Beats sur Deezer", url: officialLinks.deezer, scope: "artist" },
];

const featuredPlatforms: readonly ProjectPlatform[] = [
  { platform: "youtube", label: "Écouter le titre sur YouTube", url: officialLinks.featuredRelease, scope: "release" },
  ...artistPlatforms,
];

const publishedConfidence: ProjectDataConfidence = {
  overall: "partial",
  identity: "confirmed",
  editorial: "confirmed",
  release: "partial",
  artwork: "placeholder",
  tracklist: "unknown",
  platforms: "partial",
  genres: "unknown",
  credits: "unknown",
  seo: "partial",
};

const developmentConfidence: ProjectDataConfidence = {
  overall: "placeholder",
  identity: "confirmed",
  editorial: "placeholder",
  release: "partial",
  artwork: "placeholder",
  tracklist: "unknown",
  platforms: "unknown",
  genres: "unknown",
  credits: "unknown",
  seo: "partial",
};

type PublishedProjectArtwork =
  | { readonly cover: string; readonly coverAlt: string }
  | { readonly cover?: undefined; readonly coverAlt?: undefined };

const published = (
  project: Omit<
    Project,
    | "year"
    | "releaseDate"
    | "cover"
    | "coverAlt"
    | "status"
    | "genres"
    | "credits"
    | "tracks"
    | "trackCount"
    | "platforms"
    | "seo"
    | "dataConfidence"
  > &
    PublishedProjectArtwork &
    Partial<Pick<Project, "year" | "releaseDate" | "genres" | "credits" | "tracks" | "trackCount" | "platforms">>,
): Project => {
  const tracks = project.tracks ?? [];
  const trackCount = project.trackCount ?? null;
  const platforms = project.platforms ?? artistPlatforms;
  const hasConfirmedReleaseLink = platforms.some((platform) => platform.scope === "release");

  return {
    year: null,
    releaseDate: null,
    cover: null,
    coverAlt: undefined,
    status: "published",
    genres: [],
    credits: [],
    tracks,
    trackCount,
    platforms,
    ...project,
    seo: { description: `${project.title} : fiche éditoriale LNX Beats et état actuellement documenté du projet.` },
    dataConfidence: {
      ...publishedConfidence,
      release: project.year || project.releaseDate ? "confirmed" : "partial",
      artwork: project.cover ? "confirmed" : "placeholder",
      tracklist: tracks.length > 0 ? "confirmed" : trackCount ? "partial" : "unknown",
      platforms: hasConfirmedReleaseLink ? "confirmed" : "partial",
      genres: project.genres && project.genres.length > 0 ? "confirmed" : "unknown",
      credits: project.credits && project.credits.length > 0 ? "confirmed" : "unknown",
    },
  };
};

const inDevelopment = (
  project: Pick<Project, "slug" | "title" | "subtitle" | "type" | "shortDescription" | "description" | "artworkTone">,
): Project => ({
  ...project,
  year: null,
  releaseDate: null,
  cover: null,
  featured: false,
  status: "in-development",
  genres: [],
  credits: [],
  tracks: [],
  trackCount: null,
  platforms: [],
  seo: { description: `${project.title} : le nom est posé, l’univers musical de LNX Beats reste encore hors champ.` },
  dataConfidence: developmentConfidence,
});

export const projects: readonly Project[] = [
  published({
    slug: "jai-adopte-un-humain",
    title: "J’ai adopté un humain",
    subtitle: "Un récit musical entre deux mondes",
    type: "single",
    description: "Un humain entre dans le cadre, mais le regard vient d’ailleurs. « J’ai adopté un humain » déplace le point de vue pour laisser parler le lien, l’étrangeté et ce qui rapproche.",
    shortDescription: "Quand l’humain devient celui que l’on observe.",
    featured: true,
    artworkTone: "gold",
    tracks: [{ number: 1, title: "J’ai adopté un humain", status: "released" }],
    trackCount: 1,
    platforms: featuredPlatforms,
  }),
  published({ slug: "bienvenue-dans-le-bordel-familial", title: "Bienvenue dans le bordel familial", subtitle: "Chroniques d’un équilibre impossible", type: "album", description: "Une maison, plusieurs voix, et cet équilibre qui tient jusqu’au moment où un détail déborde. La famille devient ici un décor vivant, tendre et impossible à ranger.", shortDescription: "Quand le désordre familial devient un monde à part entière.", featured: true, trackCount: 18, artworkTone: "wine" }),
  published({ slug: "jai-adopte", title: "J’ai adopté", subtitle: "Histoires, liens et points de vue", type: "album", description: "Tout commence par un lien. Puis le regard change, les places bougent et une même idée ouvre plusieurs histoires : adopter, c’est aussi apprendre à voir autrement.", shortDescription: "Des liens racontés depuis l’endroit où le regard bascule.", featured: true, trackCount: 13, artworkTone: "bronze" }),
  published({ slug: "jai-adopte-un-humain-album", title: "J’ai adopté un humain", subtitle: "L’album", type: "album", description: "Le point de vue s’inverse et l’humain passe de l’autre côté du regard. Cet album prolonge l’univers de « J’ai adopté un humain » en seize chapitres encore à nommer ici.", shortDescription: "Seize chapitres pour regarder l’humain depuis l’autre côté.", featured: false, trackCount: 16, artworkTone: "graphite" }),
  published({ slug: "les-comptines-version-adulte-v2", title: "Les comptines (version adulte) V2", type: "album", description: "Les airs de l’enfance reviennent après la nuit. Les mots ont grandi, les ombres aussi, et la comptine trouve une nouvelle manière de résonner.", shortDescription: "Les souvenirs d’enfance reviennent avec une autre voix.", featured: false, trackCount: 20, artworkTone: "ivory" }),
  published({ slug: "chaos-canin", title: "Chaos canin", type: "album", description: "Le quotidien canin entre dans le cadre avec son désordre, ses élans et sa logique bien à lui. Ici, le chaos n’est pas un accident : c’est le point de vue.", shortDescription: "Le désordre quotidien vu à hauteur de truffe.", featured: true, trackCount: 21, artworkTone: "gold" }),
  published({ slug: "les-merdes-du-quotidien", title: "Les merdes du quotidien", type: "album", description: "Ce sont de petites choses. Jusqu’à ce qu’elles prennent toute la place. Le quotidien livre ses accrocs, ses absurdités et cette comédie que l’on reconnaît trop bien.", shortDescription: "Les petits désastres ordinaires prennent enfin la parole.", featured: false, trackCount: 31, artworkTone: "wine" }),
  published({ slug: "les-comptines-version-adulte", title: "Les comptines (version adulte)", type: "album", description: "Une mélodie familière revient, mais quelque chose a changé. L’enfance reste au loin tandis que les mots prennent une couleur plus adulte.", shortDescription: "La comptine a grandi. Son reflet n’est plus tout à fait le même.", featured: false, trackCount: 27, artworkTone: "bronze" }),
  published({ slug: "le-collegue-ambiance-toxique", title: "Le collègue « ambiance toxique »", type: "album", description: "Il suffit parfois d’une présence pour changer l’air d’une pièce. Le bureau devient une scène, et le malaise, un personnage que tout le monde connaît déjà.", shortDescription: "Au bureau, certaines présences changent toute l’atmosphère.", featured: false, trackCount: 13, artworkTone: "graphite" }),
  published({ slug: "avant-vs-maintenant", title: "Avant vs maintenant", type: "album", description: "Deux époques se regardent sans toujours se comprendre. Entre ce qui a disparu et ce qui a pris sa place, le contraste devient matière à raconter.", shortDescription: "Deux époques face à face, et tout ce qui a changé entre elles.", featured: false, trackCount: 16, artworkTone: "ivory" }),
  published({ slug: "les-employes-du-bureau", title: "Les employés du bureau", type: "album", description: "Chaque porte cache une habitude, une tension ou un personnage. Le bureau se transforme en galerie vivante, observée scène après scène.", shortDescription: "Derrière chaque bureau, un personnage attend son histoire.", featured: false, trackCount: 25, artworkTone: "gold" }),
  published({ slug: "ca-va-lfaire", title: "Ça va l’faire", type: "single", description: "Une phrase courte, presque lancée pour tenir debout. « Ça va l’faire » laisse cette énergie prendre le micro et avancer malgré le reste.", shortDescription: "Une phrase pour avancer quand le doute reste dans la pièce.", featured: false, artworkTone: "wine" }),
  published({ slug: "jai-adopte-un-bebe", title: "J’ai adopté un bébé", type: "single", description: "Un nouveau lien entre dans l’univers « J’ai adopté ». Le regard se déplace encore pour raconter ce que cette rencontre change.", shortDescription: "Un nouveau lien, raconté depuis un regard inattendu.", featured: false, artworkTone: "bronze" }),
  published({ slug: "jai-adopte-une-femme", title: "J’ai adopté une femme", type: "single", description: "Le titre ouvre une nouvelle porte dans l’univers « J’ai adopté ». Une relation, un regard et tout ce qui se transforme quand les places s’inversent.", shortDescription: "Une relation observée depuis l’autre côté du regard.", featured: false, artworkTone: "graphite" }),
  published({ slug: "jai-adopte-un-homme", title: "J’ai adopté un homme", type: "single", description: "Un homme entre dans l’univers « J’ai adopté » et le point de vue se déplace avec lui. Le reste appartient à l’écoute.", shortDescription: "Un nouveau point de vue dans la constellation « J’ai adopté ».", featured: false, artworkTone: "ivory" }),
  published({ slug: "jprefere-le-carton", title: "J’préfère le carton", type: "single", description: "Le titre a déjà choisi son camp. Entre ce que l’on attend et ce que l’on préfère vraiment, « J’préfère le carton » ouvre un récit au pas de côté.", shortDescription: "Le choix le plus simple peut cacher le meilleur point de vue.", featured: false, artworkTone: "gold" }),
  published({ slug: "mon-humain-me-parle-bizarre", title: "Mon humain me parle bizarre", type: "single", description: "Quelqu’un parle. Quelqu’un d’autre essaie de comprendre. Le décalage suffit à faire naître une scène où l’humain redevient l’étrange personnage.", shortDescription: "Quand la voix humaine devient la chose la plus étrange de la pièce.", featured: false, artworkTone: "wine" }),
  published({ slug: "la-galette-des-rois", title: "La galette des rois", type: "single", description: "Un rituel familier entre dans la lumière. Autour de la galette, le quotidien trouve une nouvelle scène à raconter.", shortDescription: "Un rituel familier, déplacé juste assez pour devenir récit.", featured: false, artworkTone: "bronze" }),
  published({ slug: "madame-piecettes", title: "Madame Piécettes", type: "single", description: "D’abord un nom. Puis une silhouette. « Madame Piécettes » entre dans le catalogue comme un personnage dont la présence suffit à ouvrir l’histoire.", shortDescription: "Un nom, une silhouette, et déjà le début d’une scène.", featured: false, artworkTone: "graphite" }),
  inDevelopment({ slug: "miss-click", title: "Miss Click", subtitle: "Projet en développement", type: "project", description: "Le nom est apparu. Son histoire reste hors champ. « Miss Click » attend encore le moment où sa voix et sa forme pourront être révélées.", shortDescription: "Un nom dans la lumière, une histoire encore hors champ.", artworkTone: "gold" }),
  inDevelopment({ slug: "le-dernier-age-dor", title: "Le Dernier Âge d’Or", subtitle: "Projet en développement", type: "project", description: "Le titre ressemble déjà à la fin d’une époque. Pour l’instant, aucune date ni aucun chapitre ne vient troubler ce silence.", shortDescription: "Le titre d’une époque dont le récit reste encore silencieux.", artworkTone: "wine" }),
  inDevelopment({ slug: "lado", title: "L’ADO", subtitle: "Projet en développement", type: "project", description: "Un titre court, une présence immédiate. « L’ADO » demeure en coulisses jusqu’à ce que son identité musicale puisse entrer dans la lumière.", shortDescription: "Une présence se dessine, encore à l’abri des regards.", artworkTone: "bronze" }),
  inDevelopment({ slug: "good-vibe", title: "Good Vibe", subtitle: "Projet en développement", type: "project", description: "Le titre donne une couleur, pas encore une histoire. Le projet reste ouvert, sans date ni forme annoncée.", shortDescription: "Une couleur annoncée, un récit qui cherche encore sa forme.", artworkTone: "ivory" }),
  inDevelopment({ slug: "les-pires-voisins", title: "Les pires voisins", subtitle: "Projet en développement", type: "project", description: "Une porte, un mur trop fin, peut-être une histoire de trop. Le titre est posé ; tout ce qui l’entoure reste encore à écrire officiellement.", shortDescription: "Derrière le mur, un futur récit attend de faire du bruit.", artworkTone: "graphite" }),
  inDevelopment({ slug: "laboratoire-narratif", title: "Laboratoire narratif", subtitle: "Expérimentations en développement", type: "project", description: "Ici, rien n’est encore figé. Les voix, les formes et les idées peuvent se rencontrer sans annoncer une parution qui n’existe pas encore.", shortDescription: "L’endroit où les futurs récits essaient leur première voix.", artworkTone: "gold" }),
] as const;

export const publishedProjects = projects.filter((project) => project.status === "published");
export const projectsInDevelopment = projects.filter((project) => project.status === "in-development");
export const featuredProjects = projects.filter((project) => project.featured && project.status === "published");
export const albums = publishedProjects.filter((project) => project.type === "album");
export const singles = publishedProjects.filter((project) => project.type === "single");

export function getProjectBySlug(slug: string) {
  return projects.find((project) => project.slug === slug);
}

export function getProjectKindLabel(type: ProjectKind) {
  return type === "album" ? "Album" : type === "single" ? "Single" : "Projet";
}

export function getProjectStatusLabel(status: ProjectStatus) {
  if (status === "published") return "Publié";
  if (status === "in-development") return "En développement";
  return "Archive";
}

export function getProjectConfidenceLabel(confidence: DataConfidence) {
  if (confidence === "confirmed") return "Informations confirmées";
  if (confidence === "partial") return "Informations partielles";
  if (confidence === "placeholder") return "Présentation provisoire";
  return "Informations non documentées";
}

export function getCreditRoleLabel(role: CreditRole) {
  if (role === "artist") return "Artiste";
  if (role === "writer") return "Auteur";
  if (role === "composer") return "Compositeur";
  if (role === "producer") return "Production";
  if (role === "featuring") return "Featuring";
  return "Autre crédit";
}
