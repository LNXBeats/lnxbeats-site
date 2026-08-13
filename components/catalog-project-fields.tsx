type ProjectFieldValues = {
  title?: string;
  slug?: string;
  subtitle?: string | null;
  type?: "ALBUM" | "SINGLE" | "PROJECT" | "album" | "single" | "project";
  status?: "DRAFT" | "IN_DEVELOPMENT" | "PUBLISHED" | "ARCHIVED" | "draft" | "in-development" | "published" | "archive";
  releaseDate?: Date | string | null;
  trackCount?: number | string | null;
  publicVisible?: boolean;
  featured?: boolean;
  jukeboxPlacement?: "PUBLISHED" | "DEVELOPMENT" | "published" | "development" | "none" | null;
  jukeboxPosition?: number | string | null;
  catalogPosition?: number | string | null;
  shortDescription?: string | null;
  description?: string | null;
  seoTitle?: string | null;
  seoDescription?: string | null;
};

function projectType(value: ProjectFieldValues["type"]) {
  return typeof value === "string" ? value.toLowerCase() : "project";
}

function projectStatus(value: ProjectFieldValues["status"]) {
  if (value === "IN_DEVELOPMENT") return "in-development";
  if (value === "ARCHIVED") return "archive";
  return typeof value === "string" ? value.toLowerCase() : "draft";
}

function releaseDate(value: ProjectFieldValues["releaseDate"]) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return typeof value === "string" ? value : "";
}

function jukeboxPlacement(value: ProjectFieldValues["jukeboxPlacement"]) {
  if (value === "PUBLISHED") return "published";
  if (value === "DEVELOPMENT") return "development";
  return value ?? "none";
}

export function CatalogProjectFields({
  values = {},
  mode,
  autoFocusTitle = false,
  seoFallbacks,
}: {
  values?: ProjectFieldValues;
  mode: "create" | "edit";
  autoFocusTitle?: boolean;
  seoFallbacks?: { title: string; description: string };
}) {
  return <div className="admin-form-grid">
    {mode === "create" ? <label><span>Slug</span><input name="slug" defaultValue={values.slug ?? ""} maxLength={160} pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="projet-a-venir" required /><small>Proposé depuis le titre, puis vérifié et normalisé par le serveur.</small></label> : <label><span>Slug (non modifiable)</span><input value={values.slug ?? ""} readOnly /><small>L’URL publique reste stable. La modification du slug n’est pas proposée.</small></label>}
    <label><span>Titre</span><input name="title" defaultValue={values.title ?? ""} maxLength={240} required autoFocus={autoFocusTitle} /></label>
    <label><span>Sous-titre</span><input name="subtitle" defaultValue={values.subtitle ?? ""} maxLength={240} /></label>
    <label><span>Type</span><select name="type" defaultValue={projectType(values.type)}><option value="album">Album</option><option value="single">Single</option><option value="project">Projet</option></select></label>
    <label><span>Statut éditorial</span><select name="status" defaultValue={projectStatus(values.status)}><option value="published">Publié</option><option value="in-development">En développement</option><option value="draft">Brouillon</option><option value="archive">Archivé</option></select><small>Le statut ne rend pas le projet visible à lui seul.</small></label>
    <label><span>Date de parution</span><input name="releaseDate" type="date" defaultValue={releaseDate(values.releaseDate)} /></label>
    {mode === "edit" ? <label><span>Nombre de pistes annoncé</span><input name="trackCount" type="number" min="0" max="999" defaultValue={values.trackCount ?? ""} /></label> : null}
    <label className="admin-checkbox"><input name="publicVisible" type="checkbox" defaultChecked={values.publicVisible ?? false} /><span>Visible sur le site</span></label>
    {mode === "edit" ? <label className="admin-checkbox"><input name="featured" type="checkbox" defaultChecked={values.featured ?? false} /><span>Mettre en avant sur l’accueil</span></label> : null}
    <label><span>Afficher dans le jukebox</span><select name="jukeboxPlacement" defaultValue={jukeboxPlacement(values.jukeboxPlacement)}><option value="none">Aucun jukebox</option><option value="published">Jukebox des parutions</option><option value="development">Jukebox des créations en développement</option></select><small>Une cover reste nécessaire pour apparaître dans un jukebox.</small></label>
    <label><span>Position dans le jukebox</span><input name="jukeboxPosition" type="number" min="1" max="999" defaultValue={values.jukeboxPosition ?? ""} /><small>Facultatif : l’ordre du catalogue sert de repli.</small></label>
    {mode === "create" ? <label><span>Position dans le catalogue</span><input name="catalogPosition" type="number" min="1" max="1000000" defaultValue={values.catalogPosition ?? ""} /><small>Facultatif : le projet est ajouté à la fin si ce champ reste vide.</small></label> : null}
    <label className="admin-form-wide"><span>Description courte</span><textarea name="shortDescription" rows={3} maxLength={1000} defaultValue={values.shortDescription ?? ""} /></label>
    <label className="admin-form-wide"><span>Récit / présentation du projet</span><textarea name="description" rows={7} maxLength={10000} defaultValue={values.description ?? ""} /><small>Laissez vide plutôt que d’ajouter une information incertaine.</small></label>
    {mode === "edit" ? <details className="admin-form-wide admin-secondary-fields"><summary>Référencement</summary><div><label><span>Titre SEO personnalisé</span><input name="seoTitle" maxLength={240} defaultValue={values.seoTitle ?? ""} placeholder={seoFallbacks?.title} />{seoFallbacks ? <small>Effectif : {seoFallbacks.title}</small> : null}</label><label><span>Description SEO personnalisée</span><textarea name="seoDescription" rows={3} maxLength={1000} defaultValue={values.seoDescription ?? ""} placeholder={seoFallbacks?.description} />{seoFallbacks ? <small>Effectif : {seoFallbacks.description}</small> : null}</label></div></details> : null}
  </div>;
}
