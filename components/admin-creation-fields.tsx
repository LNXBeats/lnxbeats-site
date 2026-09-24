type CreationFieldValues = {
  slug?: string;
  title?: string;
  summary?: string | null;
  description?: string | null;
  collaborator?: string | null;
  credits?: string | null;
  category?: string | null;
  primaryMedia?: string | null;
  position?: number;
  seoTitle?: string | null;
  seoDescription?: string | null;
};

export function AdminCreationFields({
  values = {},
  slugReadOnly = false,
}: {
  values?: CreationFieldValues;
  slugReadOnly?: boolean;
}) {
  return <div className="admin-field-grid">
    <label>
      <span>Titre</span>
      <input name="title" defaultValue={values.title ?? ""} maxLength={240} required />
    </label>
    <label className={slugReadOnly ? undefined : "admin-advanced-slug"}>
      <span>{slugReadOnly ? "Adresse publique stable" : "Adresse personnalisée (facultatif)"}</span>
      <input
        name="slug"
        defaultValue={values.slug ?? ""}
        maxLength={160}
        pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
        readOnly={slugReadOnly}
        aria-readonly={slugReadOnly || undefined}
        required={slugReadOnly}
      />
      <small className="admin-field-help">{slugReadOnly ? "Une création publiée conserve son adresse quand son titre change." : "Vide : adresse créée automatiquement depuis le titre."}</small>
    </label>
    <label>
      <span>Catégorie</span>
      <input name="category" defaultValue={values.category ?? ""} maxLength={120} placeholder="Collaboration, clip, création…" />
    </label>
    <label>
      <span>Mention courte héritée</span>
      <input name="collaborator" defaultValue={values.collaborator ?? ""} maxLength={240} />
      <small className="admin-field-help">Utilisez ensuite la section Collaborateurs pour les profils et liens officiels structurés.</small>
    </label>
    <label>
      <span>Média principal</span>
      <select name="primaryMedia" defaultValue={values.primaryMedia ?? ""}>
        <option value="">À définir</option>
        <option value="COVER">Visuel</option>
        <option value="AUDIO">Audio</option>
        <option value="VIDEO">Vidéo</option>
      </select>
      <small className="admin-field-help">Détermine la présentation initiale, sans lecture automatique.</small>
    </label>
    <label>
      <span>Ordre d’affichage</span>
      <input name="position" type="number" min={0} max={1_000_000} step={1} defaultValue={values.position ?? 0} required />
    </label>
    <label style={{ gridColumn: "1 / -1" }}>
      <span>Résumé</span>
      <textarea name="summary" defaultValue={values.summary ?? ""} maxLength={1000} rows={3} />
      <small className="admin-field-help">Obligatoire avant publication.</small>
    </label>
    <label style={{ gridColumn: "1 / -1" }}>
      <span>Description</span>
      <textarea name="description" defaultValue={values.description ?? ""} maxLength={50_000} rows={8} />
    </label>
    <label style={{ gridColumn: "1 / -1" }}>
      <span>Crédits</span>
      <textarea name="credits" defaultValue={values.credits ?? ""} maxLength={20_000} rows={5} />
      <small className="admin-field-help">Texte libre, sans donnée inventée.</small>
    </label>
    <label>
      <span>Titre SEO</span>
      <input name="seoTitle" defaultValue={values.seoTitle ?? ""} maxLength={240} />
    </label>
    <label>
      <span>Description SEO</span>
      <textarea name="seoDescription" defaultValue={values.seoDescription ?? ""} maxLength={1000} rows={4} />
    </label>
  </div>;
}
