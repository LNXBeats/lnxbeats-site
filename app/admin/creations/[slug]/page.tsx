import type { Metadata } from "next";
import { notFound } from "next/navigation";

import {
  archiveCreationAction,
  createCreationExternalLinkAction,
  deleteCreationExternalLinkAction,
  publishCreationAction,
  unpublishCreationAction,
  updateCreationAction,
  updateCreationExternalLinkAction,
} from "@/app/admin/creations/actions";
import { AdminBackLink } from "@/components/admin-back-link";
import { AdminCreationFields } from "@/components/admin-creation-fields";
import { AdminCreationMediaManager } from "@/components/admin-creation-media-manager";
import { requireAdmin } from "@/lib/auth/session";
import { CREATION_ACTION_CONFIRMATIONS, getCreationPublicationBlockers } from "@/lib/creations/domain";
import { getAdminCreation } from "@/lib/creations/service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Création · Administration" };

const STATUS_LABELS = { DRAFT: "Brouillon", PUBLISHED: "Publié", ARCHIVED: "Archivé" } as const;
const BLOCKER_LABELS: Record<string, string> = {
  TITLE_MISSING: "titre manquant",
  SUMMARY_MISSING: "résumé manquant",
  PRIMARY_MEDIA_MISSING: "média principal non choisi",
  MEDIA_MISSING: "aucun média attaché",
  MEDIA_NOT_PUBLIC_OR_CLEARED: "média privé, incohérent ou droits non validés",
  PLAYABLE_MEDIA_MISSING: "audio ou vidéo public manquant",
  PRIMARY_MEDIA_ASSET_MISSING: "fichier du média principal manquant",
};

function Feedback({ state }: { state?: string }) {
  const message = state === "creation-creee" ? "Le brouillon a été créé."
    : state === "creation-enregistree" ? "La fiche a été enregistrée."
      : state === "creation-publiee" ? "La création est publiée."
        : state === "creation-depubliee" ? "La création est revenue en brouillon."
          : state === "creation-archivee" ? "La création a été archivée."
            : state === "lien-ajoute" ? "Le lien externe a été ajouté."
              : state === "lien-enregistre" ? "Le lien externe a été enregistré."
                : state === "lien-supprime" ? "Le lien externe a été supprimé."
                  : state === "conflit" ? "La fiche a changé dans un autre onglet. Rechargez la page."
                    : state === "slug-immuable" ? "Le slug d’une création existante est immuable."
                      : state === "publication-incomplete" ? "Publication refusée : la fiche ou les médias sont incomplets."
                        : state === "depublication-requise" ? "Dépubliez la création avant de l’archiver."
                          : state === "lien-existant" ? "Ce lien est déjà associé à la création."
                            : state === "confirmation-requise" ? "La confirmation explicite est requise."
                              : state === "operation-refusee" ? "L’opération a été refusée sans modifier la création."
                                : null;
  const success = state && [
    "creation-creee",
    "creation-enregistree",
    "creation-publiee",
    "creation-depubliee",
    "creation-archivee",
    "lien-ajoute",
    "lien-enregistre",
    "lien-supprime",
  ].includes(state);
  return message ? <p className="admin-feedback" role={success ? "status" : "alert"}>{message}</p> : null;
}

export default async function AdminCreationPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ etat?: string }>;
}) {
  await requireAdmin();
  const [{ slug }, { etat }] = await Promise.all([params, searchParams]);
  const creation = await getAdminCreation(slug);
  if (!creation) notFound();
  const editable = creation.status !== "ARCHIVED";
  const blockers = getCreationPublicationBlockers(creation);

  return <div className="admin-main admin-rights-detail">
    <AdminBackLink href="/admin/creations">Retour aux créations</AdminBackLink>
    <header className="admin-page-heading">
      <div><p className="admin-kicker">Création · {STATUS_LABELS[creation.status]}</p><h1>{creation.title}</h1></div>
      <p>{creation.collaborator ?? "Sans collaborateur renseigné"} · position {creation.position} · version {creation.lockVersion}</p>
    </header>
    <Feedback state={etat} />

    <section className="admin-panel">
      <div className="admin-panel__heading"><h2>Fiche éditoriale</h2></div>
      {editable ? <form action={updateCreationAction} className="admin-rights-detail">
        <input type="hidden" name="creationId" value={creation.id} />
        <input type="hidden" name="lockVersion" value={creation.lockVersion} />
        <AdminCreationFields values={creation} slugReadOnly />
        <p className="admin-work-note">La version de fiche protège les sauvegardes concurrentes. Le slug reste immuable après création.</p>
        <button className="admin-button" type="submit">Enregistrer la fiche</button>
      </form> : <p className="admin-alert">Cette création est archivée et conservée en lecture seule.</p>}
    </section>

    <section className="admin-panel">
      <div className="admin-panel__heading"><h2>Médias attachés</h2></div>
      <p className="admin-work-note">Les fichiers validés sont diffusés par le stockage média existant. Une création en brouillon reste absente des routes publiques.</p>
      <AdminCreationMediaManager
        creationId={creation.id}
        slug={creation.slug}
        title={creation.title}
        lockVersion={creation.lockVersion}
        status={creation.status}
        initialState={etat}
        media={creation.assets.map((relation) => ({
          role: relation.role,
          id: relation.asset.id,
          filename: relation.asset.filename,
          mimeType: relation.asset.mimeType,
          sizeBytes: relation.asset.sizeBytes.toString(),
          width: relation.asset.width,
          height: relation.asset.height,
          durationMs: relation.asset.durationMs,
          alt: relation.asset.alt,
          updatedAt: relation.asset.updatedAt.toISOString(),
        }))}
      />
    </section>

    <section className="admin-panel">
      <div className="admin-panel__heading"><h2>Liens externes</h2></div>
      {creation.externalLinks.length ? <div className="admin-rights-detail">
        {creation.externalLinks.map((link) => editable ? <div className="admin-panel" key={link.id}>
          <form className="admin-inline-form" action={updateCreationExternalLinkAction}>
            <input type="hidden" name="creationId" value={creation.id} />
            <input type="hidden" name="externalLinkId" value={link.id} />
            <input type="hidden" name="lockVersion" value={creation.lockVersion} />
            <label><span>Libellé</span><input name="label" defaultValue={link.label} maxLength={180} required /></label>
            <label><span>URL HTTPS</span><input name="url" type="url" defaultValue={link.url} maxLength={2048} pattern="https://.*" required /></label>
            <label><span>Position</span><input name="position" type="number" min={0} max={1_000_000} defaultValue={link.position} required /></label>
            <button className="admin-button" type="submit">Enregistrer le lien</button>
          </form>
          <form className="admin-inline-form" action={deleteCreationExternalLinkAction}>
            <input type="hidden" name="creationId" value={creation.id} />
            <input type="hidden" name="externalLinkId" value={link.id} />
            <input type="hidden" name="lockVersion" value={creation.lockVersion} />
            <label className="admin-check">
              <input type="checkbox" name="confirmation" value={CREATION_ACTION_CONFIRMATIONS.deleteExternalLink} required />
              <span>Je confirme la suppression de ce lien.</span>
            </label>
            <button className="admin-button admin-button--danger" type="submit">Supprimer</button>
          </form>
        </div> : <p key={link.id}><strong>{link.label}</strong> · {link.url}</p>)}
      </div> : <p className="admin-work-note">Aucun lien externe.</p>}
      {editable ? <form className="admin-inline-form" action={createCreationExternalLinkAction}>
        <input type="hidden" name="creationId" value={creation.id} />
        <input type="hidden" name="lockVersion" value={creation.lockVersion} />
        <label><span>Libellé</span><input name="label" maxLength={180} required /></label>
        <label><span>URL HTTPS</span><input name="url" type="url" maxLength={2048} pattern="https://.*" required /></label>
        <label><span>Position</span><input name="position" type="number" min={0} max={1_000_000} defaultValue={creation.externalLinks.length} required /></label>
        <button className="admin-button" type="submit">Ajouter le lien</button>
      </form> : null}
    </section>

    <section className="admin-panel">
      <div className="admin-panel__heading"><h2>Publication</h2></div>
      <p className="admin-work-note">Publier rend la création éligible aux pages publiques. Les médias doivent être publics, cohérents et aux droits validés.</p>
      {blockers.length ? <p className="admin-alert" role="status">Publication fermée : {blockers.map((blocker) => BLOCKER_LABELS[blocker] ?? "fiche incomplète").join(" · ")}</p> : null}
      {editable ? <div className="admin-action-row">
        {creation.status === "DRAFT" ? <form action={publishCreationAction}>
          <input type="hidden" name="creationId" value={creation.id} />
          <input type="hidden" name="lockVersion" value={creation.lockVersion} />
          <label className="admin-check">
            <input type="checkbox" name="confirmation" value={CREATION_ACTION_CONFIRMATIONS.publish} required />
            <span>Je confirme la publication de cette création.</span>
          </label>
          <button className="admin-button" type="submit" disabled={blockers.length > 0}>Publier</button>
        </form> : <form action={unpublishCreationAction}>
          <input type="hidden" name="creationId" value={creation.id} />
          <input type="hidden" name="lockVersion" value={creation.lockVersion} />
          <label className="admin-check">
            <input type="checkbox" name="confirmation" value={CREATION_ACTION_CONFIRMATIONS.unpublish} required />
            <span>Je confirme le retrait de cette création des pages publiques.</span>
          </label>
          <button className="admin-button admin-button--quiet" type="submit">Dépublier</button>
        </form>}
        {creation.status === "DRAFT" ? <form action={archiveCreationAction}>
          <input type="hidden" name="creationId" value={creation.id} />
          <input type="hidden" name="lockVersion" value={creation.lockVersion} />
          <label className="admin-check">
            <input type="checkbox" name="confirmation" value={CREATION_ACTION_CONFIRMATIONS.archive} required />
            <span>Je confirme l’archivage définitif de cette fiche.</span>
          </label>
          <button className="admin-button admin-button--danger" type="submit">Archiver</button>
        </form> : null}
      </div> : null}
    </section>
  </div>;
}
