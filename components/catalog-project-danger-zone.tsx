"use client";

import { useId, useRef, useState } from "react";

import { archiveCatalogProjectAction, deleteCatalogProjectAction, hideCatalogProjectAction } from "@/app/admin/catalogue/actions";
import { CatalogSubmitButton } from "@/components/catalog-edit-guard";

export function CatalogProjectDangerZone({
  project,
  deletionEligible,
  deletionReason,
}: {
  project: { id: string; slug: string; title: string; publicVisible: boolean; status: string };
  deletionEligible: boolean;
  deletionReason: string;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [confirmation, setConfirmation] = useState("");
  const identity = <><input type="hidden" name="projectId" value={project.id} /><input type="hidden" name="slug" value={project.slug} /></>;

  return <>
    <div className="admin-project-management-actions">
      {project.publicVisible ? <form action={hideCatalogProjectAction}>{identity}<CatalogSubmitButton pendingLabel="Masquage…">Masquer du site</CatalogSubmitButton></form> : <p>Le projet est déjà masqué du site.</p>}
      {project.status !== "ARCHIVED" ? <form action={archiveCatalogProjectAction}>{identity}<CatalogSubmitButton pendingLabel="Archivage…">Archiver et masquer</CatalogSubmitButton></form> : <p>Projet archivé : modifiez son statut plus haut pour le restaurer.</p>}
    </div>
    <div className="admin-project-delete-panel">
      <div><h2>Suppression définitive</h2><p>Cette action retire le projet et ses données associées. Elle ne peut pas être annulée.</p></div>
      <button ref={trigger} type="button" className="admin-danger-action" disabled={!deletionEligible} onClick={() => { setConfirmation(""); dialog.current?.showModal(); }}>Supprimer définitivement</button>
      {!deletionEligible ? <p className="admin-action-reason">{deletionReason}</p> : null}
    </div>
    <dialog
      ref={dialog}
      className="admin-confirm-dialog"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      onCancel={(event) => { event.preventDefault(); dialog.current?.close(); }}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        dialog.current?.close();
      }}
      onClose={() => trigger.current?.focus()}
    >
      <h2 id={titleId}>Supprimer définitivement ce projet ?</h2>
      <p id={descriptionId}>Le projet, sa tracklist, ses crédits, ses liens et ses médias exclusivement rattachés seront supprimés. Les médias partagés seront conservés. Saisissez <strong>{project.slug}</strong> pour confirmer.</p>
      <form action={deleteCatalogProjectAction}>
        {identity}
        <label><span>Slug du projet</span><input name="confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" required /></label>
        <div className="admin-dialog-actions"><button type="button" onClick={() => dialog.current?.close()}>Conserver le projet</button><CatalogSubmitButton className="admin-danger-action" disabled={confirmation !== project.slug} pendingLabel="Suppression…">Supprimer définitivement</CatalogSubmitButton></div>
      </form>
    </dialog>
  </>;
}
