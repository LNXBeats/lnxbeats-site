"use client";

import { useState } from "react";

import { createCatalogProjectAction } from "@/app/admin/catalogue/actions";
import { CatalogProjectFields } from "@/components/catalog-project-fields";
import { CatalogSubmitButton } from "@/components/catalog-edit-guard";
import { normalizeCatalogSlug } from "@/lib/catalog/lifecycle";

export function CatalogCreateForm() {
  const [slugTouched, setSlugTouched] = useState(false);

  return <form className="admin-catalogue-form" action={createCatalogProjectAction} onChange={(event) => {
    if (!(event.target instanceof HTMLInputElement)) return;
    if (event.target.name === "slug") setSlugTouched(true);
    if (event.target.name === "title" && !slugTouched) {
      const slug = event.currentTarget.elements.namedItem("slug");
      if (slug instanceof HTMLInputElement) slug.value = normalizeCatalogSlug(event.target.value);
    }
  }}>
    <CatalogProjectFields mode="create" autoFocusTitle values={{ status: "draft", publicVisible: false, jukeboxPlacement: "none" }} />
    <p className="admin-form-note">Le projet sera enregistré sans cover, sans extrait, sans piste et sans mise en avant. Ces éléments se complètent ensuite depuis sa fiche.</p>
    <CatalogSubmitButton pendingLabel="Création…">Créer le projet</CatalogSubmitButton>
  </form>;
}
