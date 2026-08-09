import { officialLinks } from "@/data/site";

export type ProjectKind = "album" | "single" | "project";
export type ProjectStatus = "published" | "in-development" | "archive";
export type TrackStatus = "released" | "announced" | "unlisted";
export type ArtworkTone = "gold" | "wine" | "graphite" | "bronze" | "ivory";
export type PlatformId = "spotify" | "appleMusic" | "deezer" | "youtube" | "distroKid";

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

export type Project = {
  readonly slug: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly type: ProjectKind;
  readonly year: number | null;
  readonly description: string;
  readonly shortDescription: string;
  readonly cover: string | null;
  readonly coverAlt?: string;
  readonly featured: boolean;
  readonly status: ProjectStatus;
  readonly genres: readonly string[];
  readonly tracks: readonly ProjectTrack[];
  readonly trackCount?: number;
  readonly platforms: readonly ProjectPlatform[];
  readonly seo: {
    readonly title?: string;
    readonly description: string;
  };
  readonly artworkTone: ArtworkTone;
};

const artistPlatforms: readonly ProjectPlatform[] = [
  { platform: "spotify", label: "Profil Spotify", url: officialLinks.spotify, scope: "artist" },
  { platform: "appleMusic", label: "Profil Apple Music", url: officialLinks.appleMusic, scope: "artist" },
  { platform: "deezer", label: "Profil Deezer", url: officialLinks.deezer, scope: "artist" },
];

const featuredPlatforms: readonly ProjectPlatform[] = [
  { platform: "youtube", label: "Voir le titre sur YouTube", url: officialLinks.featuredRelease, scope: "release" },
  ...artistPlatforms,
];

const published = (
  project: Omit<Project, "year" | "cover" | "status" | "genres" | "tracks" | "platforms" | "seo"> &
    Partial<Pick<Project, "year" | "cover" | "genres" | "tracks" | "platforms">>,
): Project => ({
  year: null,
  cover: null,
  status: "published",
  genres: [],
  tracks: [],
  platforms: artistPlatforms,
  ...project,
  seo: { description: `${project.title}, un projet musical de LNX Beats. Informations et liens officiels.` },
});

const inDevelopment = (
  project: Pick<Project, "slug" | "title" | "subtitle" | "type" | "shortDescription" | "description" | "artworkTone">,
): Project => ({
  ...project,
  year: null,
  cover: null,
  featured: false,
  status: "in-development",
  genres: [],
  tracks: [],
  platforms: [],
  seo: { description: `${project.title}, un projet en développement dans l’univers artistique de LNX Beats.` },
});

export const projects: readonly Project[] = [
  published({
    slug: "jai-adopte-un-humain",
    title: "J’ai adopté un humain",
    subtitle: "Un récit musical entre deux mondes",
    type: "single",
    description: "Un titre narratif mis en lumière dans le catalogue LNX Beats. Son écoute officielle est disponible sur YouTube ; les autres liens renvoient vers les profils artiste vérifiés.",
    shortDescription: "Un titre narratif entre regard décalé, récit et émotion.",
    featured: true,
    artworkTone: "gold",
    tracks: [{ number: 1, title: "J’ai adopté un humain", status: "released" }],
    platforms: featuredPlatforms,
  }),
  published({ slug: "bienvenue-dans-le-bordel-familial", title: "Bienvenue dans le bordel familial", subtitle: "Chroniques d’un équilibre impossible", type: "album", description: "Un album du catalogue LNX Beats consacré aux dynamiques familiales et à leurs contrastes. Le détail éditorial sera enrichi lorsque les informations officielles seront disponibles.", shortDescription: "Un univers familial observé avec recul, rythme et contraste.", featured: true, trackCount: 18, artworkTone: "wine" }),
  published({ slug: "jai-adopte", title: "J’ai adopté", subtitle: "Histoires, liens et points de vue", type: "album", description: "Un album publié dans l’univers LNX Beats. La liste complète des titres et les informations de parution seront ajoutées à partir des sources officielles.", shortDescription: "Une collection de récits reliés par une même idée d’adoption.", featured: true, trackCount: 13, artworkTone: "bronze" }),
  published({ slug: "jai-adopte-un-humain-album", title: "J’ai adopté un humain", subtitle: "L’album", type: "album", description: "La déclinaison album de l’univers « J’ai adopté un humain ». Les données détaillées seront complétées sans extrapolation à partir des informations officielles.", shortDescription: "L’univers narratif de « J’ai adopté un humain » au format album.", featured: false, trackCount: 16, artworkTone: "graphite" }),
  published({ slug: "les-comptines-version-adulte-v2", title: "Les comptines (version adulte) V2", type: "album", description: "Un album publié du catalogue LNX Beats. Le contenu détaillé sera documenté lorsque les titres et crédits officiels seront confirmés.", shortDescription: "Une nouvelle variation autour de l’univers des comptines adultes.", featured: false, trackCount: 20, artworkTone: "ivory" }),
  published({ slug: "chaos-canin", title: "Chaos canin", type: "album", description: "Un album publié dans le catalogue LNX Beats. Les informations disponibles sont volontairement limitées aux éléments confirmés.", shortDescription: "Un projet narratif consacré au désordre du quotidien canin.", featured: true, trackCount: 21, artworkTone: "gold" }),
  published({ slug: "les-merdes-du-quotidien", title: "Les merdes du quotidien", type: "album", description: "Un album du catalogue LNX Beats centré sur les situations ordinaires. Les titres complets seront intégrés à partir d’une source officielle.", shortDescription: "Le quotidien, ses accrocs et ses absurdités passés au filtre LNX.", featured: false, trackCount: 31, artworkTone: "wine" }),
  published({ slug: "les-comptines-version-adulte", title: "Les comptines (version adulte)", type: "album", description: "Un album publié du catalogue LNX Beats. Aucune information de piste ou de date n’est ajoutée sans confirmation.", shortDescription: "L’imaginaire de la comptine déplacé dans un registre adulte.", featured: false, trackCount: 27, artworkTone: "bronze" }),
  published({ slug: "le-collegue-ambiance-toxique", title: "Le collègue « ambiance toxique »", type: "album", description: "Un album publié dans l’univers LNX Beats. La présentation reste factuelle en attendant les données éditoriales officielles.", shortDescription: "Une chronique musicale des tensions et personnages du bureau.", featured: false, trackCount: 13, artworkTone: "graphite" }),
  published({ slug: "avant-vs-maintenant", title: "Avant vs maintenant", type: "album", description: "Un album publié du catalogue LNX Beats construit autour d’un contraste entre les époques. Les détails seront complétés depuis les sources officielles.", shortDescription: "Deux époques mises en regard dans un même terrain narratif.", featured: false, trackCount: 16, artworkTone: "ivory" }),
  published({ slug: "les-employes-du-bureau", title: "Les employés du bureau", type: "album", description: "Un album publié dans le catalogue LNX Beats. Les informations de piste ne sont pas affichées tant qu’elles ne sont pas confirmées.", shortDescription: "Une galerie de personnages et de scènes venues du bureau.", featured: false, trackCount: 25, artworkTone: "gold" }),
  published({ slug: "ca-va-lfaire", title: "Ça va l’faire", type: "single", description: "Un single publié par LNX Beats. Les informations complémentaires seront ajoutées à partir de données officielles.", shortDescription: "Un single du catalogue officiel LNX Beats.", featured: false, artworkTone: "wine" }),
  published({ slug: "jai-adopte-un-bebe", title: "J’ai adopté un bébé", type: "single", description: "Un single publié dans l’univers « J’ai adopté ». Les liens proposés mènent aux profils artiste officiels.", shortDescription: "Un chapitre de l’univers narratif « J’ai adopté ».", featured: false, artworkTone: "bronze" }),
  published({ slug: "jai-adopte-une-femme", title: "J’ai adopté une femme", type: "single", description: "Un single publié dans l’univers « J’ai adopté ». Les données de parution seront précisées lorsqu’elles seront confirmées.", shortDescription: "Un chapitre de l’univers narratif « J’ai adopté ».", featured: false, artworkTone: "graphite" }),
  published({ slug: "jai-adopte-un-homme", title: "J’ai adopté un homme", type: "single", description: "Un single publié dans l’univers « J’ai adopté ». Cette fiche ne présente que les informations actuellement confirmées.", shortDescription: "Un chapitre de l’univers narratif « J’ai adopté ».", featured: false, artworkTone: "ivory" }),
  published({ slug: "jprefere-le-carton", title: "J’préfère le carton", type: "single", description: "Un single publié par LNX Beats. L’écoute passe par les profils officiels de l’artiste.", shortDescription: "Un single du catalogue officiel LNX Beats.", featured: false, artworkTone: "gold" }),
  published({ slug: "mon-humain-me-parle-bizarre", title: "Mon humain me parle bizarre", type: "single", description: "Un single publié par LNX Beats. Les informations complémentaires ne seront ajoutées qu’après confirmation.", shortDescription: "Un récit musical au point de vue décalé.", featured: false, artworkTone: "wine" }),
  published({ slug: "la-galette-des-rois", title: "La galette des rois", type: "single", description: "Un single publié dans le catalogue LNX Beats. La fiche sera enrichie depuis les données officielles disponibles.", shortDescription: "Un single narratif du catalogue LNX Beats.", featured: false, artworkTone: "bronze" }),
  published({ slug: "madame-piecettes", title: "Madame Piécettes", type: "single", description: "Un single publié par LNX Beats. Les liens présents pointent vers les profils officiels de l’artiste.", shortDescription: "Un personnage et son histoire dans l’univers LNX Beats.", featured: false, artworkTone: "graphite" }),
  inDevelopment({ slug: "miss-click", title: "Miss Click", subtitle: "Projet en développement", type: "project", description: "Projet identifié dans l’univers LNX Beats. Sa forme, ses titres et sa date seront précisés lors de son annonce officielle.", shortDescription: "Un futur projet dont les détails restent à révéler.", artworkTone: "gold" }),
  inDevelopment({ slug: "le-dernier-age-dor", title: "Le Dernier Âge d’Or", subtitle: "Projet en développement", type: "project", description: "Projet identifié dans l’univers LNX Beats. Aucune date, piste ou promesse de publication n’est affichée avant confirmation.", shortDescription: "Un futur récit musical en cours de définition.", artworkTone: "wine" }),
  inDevelopment({ slug: "lado", title: "L’ADO", subtitle: "Projet en développement", type: "project", description: "Projet identifié dans l’univers LNX Beats. Son identité éditoriale sera documentée au moment de sa présentation officielle.", shortDescription: "Un futur projet de l’univers LNX Beats.", artworkTone: "bronze" }),
  inDevelopment({ slug: "good-vibe", title: "Good Vibe", subtitle: "Projet en développement", type: "project", description: "Projet identifié dans l’univers LNX Beats. Les informations musicales et éditoriales restent volontairement ouvertes.", shortDescription: "Un futur projet dont les contours restent à annoncer.", artworkTone: "ivory" }),
  inDevelopment({ slug: "les-pires-voisins", title: "Les pires voisins", subtitle: "Projet en développement", type: "project", description: "Projet identifié dans l’univers LNX Beats. Son contenu sera précisé à partir d’éléments officiels, sans extrapolation.", shortDescription: "Un futur terrain de récit dans le catalogue LNX Beats.", artworkTone: "graphite" }),
  inDevelopment({ slug: "laboratoire-narratif", title: "Laboratoire narratif", subtitle: "Expérimentations en développement", type: "project", description: "Un espace réservé aux recherches narratives et expérimentales de LNX Beats. Il ne constitue pas l’annonce d’une parution déterminée.", shortDescription: "Un espace pour les formes narratives et expérimentales à venir.", artworkTone: "gold" }),
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
