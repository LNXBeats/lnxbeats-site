"use client";
import { useEffect, useRef, useState } from "react";
import type { GroupReviewView } from "@/lib/digital/group-review-service";
import { OWNER_ORIGINAL_CONFIRMATION } from "@/lib/digital/owner-declaration";

/** Personal decisions only. No file upload, inferred consent or fabricated listening. */
export function ExpressVersionReview({ projectId, onSaved, rightsOnPublication = false }: { projectId: string; onSaved: () => Promise<void>; rightsOnPublication?: boolean }) {
  const [project, setProject] = useState<GroupReviewView | null>(null), [selected, setSelected] = useState<string[]>([]);
  const [rights, setRights] = useState(false), [art, setArt] = useState(false), [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  const [pending, setPending] = useState<Record<string, unknown> | null>(null);
  const inFlight = useRef(false);
  async function refresh() {
    const r = await fetch(`/api/admin/digital/group-review?projectId=${projectId}`, { cache: "no-store" });
    const v = await r.json(); if (!r.ok) throw Error(v.error ?? "Revue indisponible");
    setProject(v.project); setRights(false); setArt(false);
  }
  useEffect(() => { let alive = true; void fetch(`/api/admin/digital/group-review?projectId=${projectId}`, { cache: "no-store" }).then(async r => {
    const v = await r.json(); if (!r.ok) throw Error(v.error ?? "Revue indisponible"); if (alive) setProject(v.project);
  }).catch(e => { if (alive) setMessage(e.message); }); return () => { alive = false; }; }, [projectId]);
  const chosen = project?.tracks.filter(t => t.masterId && selected.includes(t.masterId) && t.ready) ?? [];
  const missingRights = chosen.filter(t => t.review?.status !== "APPROVED"), missingArt = chosen.filter(t => t.selection?.status !== "VALIDATED");
  async function submit(operation: "original-rights" | "artistic") {
    if (inFlight.current || !project) return;
    const list = operation === "original-rights" ? missingRights : missingArt;
    if (!pending && (!list.length || (operation === "original-rights" ? !rights : !art))) return;
    const input = pending ?? { operation, projectId, masterIds: list.map(t => t.masterId),
      expectedBindings: list.map(t => ({ masterId: t.masterId, bindingHash: t.bindingHash })), idempotencyKey: crypto.randomUUID(), attested: true,
      ...(operation === "original-rights" ? { facts: { policy: "OWNER_ORIGINAL_CONFIRMATION_V1", confirmed: true }, expectedReviews: list.map(t => ({ masterId: t.masterId, reviewId: t.review?.reviewId ?? null })) }
        : { provenance: "OWNER_DECLARED", expectedSelections: list.map(t => ({ masterId: t.masterId, revisionId: t.selection?.revisionId ?? null })) }) };
    setPending(input); inFlight.current = true; setBusy(true); setMessage("");
    try {
      const r = await fetch("/api/admin/digital/group-review", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
      const v = await r.json(); if (!r.ok) { if (r.status < 500) setPending(null); throw Error(v.code === "GROUP_PARTICULAR_RIGHTS_REQUIRED" ? "Une restriction ou contribution de tiers exige la revue particulière ci-dessous." : v.error ?? "Enregistrement à vérifier"); }
      setPending(null); await refresh(); await onSaved(); setMessage("Décision enregistrée pour les versions sélectionnées. Aucune offre activée ; les validations déjà acquises sont conservées.");
    } catch (e) { setMessage(`${e instanceof Error ? e.message : "Résultat à vérifier"} — si le résultat est incertain, reprenez la même demande sans doublon.`); }
    finally { inFlight.current = false; setBusy(false); }
  }
  return <div><h3>Terminer les versions de cet album</h3><p>Les droits déjà approuvés et les extraits déjà validés ne sont pas redemandés. Sélectionner une version ne l’approuve pas.</p>
    {project ? <><button type="button" disabled={busy || !!pending} onClick={() => { setSelected(project.tracks.filter(t => t.ready).map(t => t.masterId!)); setRights(false); setArt(false); }}>Sélectionner les versions techniquement prêtes</button>
      <ul>{project.tracks.map(t => <li key={t.id}><label><input type="checkbox" checked={!!t.masterId && selected.includes(t.masterId)} disabled={!t.ready || busy || !!pending} onChange={e => { setSelected(s => e.target.checked ? [...s, t.masterId!] : s.filter(id => id !== t.masterId)); setRights(false); setArt(false); }} /> {t.position}. {t.title} — {!t.ready ? "fichier à compléter" : `droits ${t.review?.status === "APPROVED" ? "confirmés" : rightsOnPublication ? "avec la publication (hors restrictions)" : "à confirmer"} · extrait ${t.selection?.status === "VALIDATED" ? "validé" : "à valider"}`}</label></li>)}</ul>
      {!rightsOnPublication ? <><h3>Déclaration personnelle des droits — originaux contrôlés</h3><p>Aucun justificatif externe ni empreinte à recopier. L’Admin, la référence interne, les empreintes et les versions exactes sont conservés automatiquement. Les collaborations, reprises, samples ou restrictions identifiés gardent leur revue particulière.</p>
      <label><input type="checkbox" checked={rights} disabled={busy || !!pending} onChange={e => setRights(e.target.checked)} /> {OWNER_ORIGINAL_CONFIRMATION}</label><p><button type="button" disabled={busy || !rights || !missingRights.length || !!pending} onClick={() => void submit("original-rights")}>Confirmer les droits des {missingRights.length} versions sélectionnées</button></p></> : null}
      {missingArt.length ? <><h3>Extraits déjà vérifiés personnellement</h3><label><input type="checkbox" checked={art} disabled={busy || !!pending} onChange={e => setArt(e.target.checked)} /> J’ai personnellement écouté et vérifié les extraits exacts sélectionnés ; je valide ces passages. Cette validation déclarée ne prétend pas qu’ils ont été joués dans ce lecteur et ne confirme pas les droits de vente.</label><p><button type="button" disabled={busy || !art || !!pending} onClick={() => void submit("artistic")}>Valider ces {missingArt.length} extraits déjà vérifiés</button></p></> : <p>Les extraits sélectionnés sont déjà validés : aucune nouvelle écoute imposée.</p>}
    </> : <p>Chargement des versions actuelles…</p>}
    <p role="status" aria-live="polite">{message}</p>{pending ? <button disabled={busy} onClick={() => void submit(pending.operation as "original-rights" | "artistic")}>Reprendre la même décision</button> : null}
  </div>;
}
