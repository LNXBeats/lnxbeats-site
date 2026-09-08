"use client";

import { useMemo, useState } from "react";

import { executeAdminCleanupAction } from "@/app/admin/nettoyage/actions";
import { ADMIN_CLEANUP_CONFIRMATION, type AdminCleanupCandidate } from "@/lib/admin/cleanup-contract";

const LABELS = {
  DELETE_SAFE: "Supprimable définitivement",
  ARCHIVE_REQUIRED: "À archiver",
  KEEP_ACTION_REQUIRED: "À conserver",
} as const;

export function AdminCleanupForm({ candidates }: { candidates: readonly AdminCleanupCandidate[] }) {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirmed, setConfirmed] = useState(false);
  const summary = useMemo(() => {
    const values = { deleted: 0, archived: 0, ignored: 0 };
    for (const item of candidates) {
      if (!selected.has(`${item.type}:${item.id}`)) continue;
      if (item.classification === "DELETE_SAFE") values.deleted += 1;
      else if (item.classification === "ARCHIVE_REQUIRED") values.archived += 1;
      else values.ignored += 1;
    }
    return values;
  }, [candidates, selected]);

  return <form action={executeAdminCleanupAction} className="admin-cleanup-form">
    <div className="admin-cleanup-summary" aria-live="polite">
      <strong>{summary.deleted} supprimé{summary.deleted === 1 ? "" : "s"} définitivement</strong>
      <strong>{summary.archived} archivé{summary.archived === 1 ? "" : "s"}</strong>
      <strong>{summary.ignored} ignoré{summary.ignored === 1 ? "" : "s"} / bloqué{summary.ignored === 1 ? "" : "s"}</strong>
    </div>
    <ul className="admin-cleanup-list">
      {candidates.filter((item) => !item.archived).map((item) => {
        const key = `${item.type}:${item.id}`;
        return <li key={key} data-classification={item.classification}>
          <label>
            <input
              type="checkbox"
              name="targets"
              value={`${key}:${item.classification}`}
              checked={selected.has(key)}
              onChange={(event) => {
                setConfirmed(false);
                setSelected((current) => {
                  const next = new Set(current);
                  if (event.target.checked) next.add(key); else next.delete(key);
                  return next;
                });
              }}
            />
            <span><strong>{item.reference}</strong><small>{item.label} · {item.status}</small></span>
          </label>
          <span className={`admin-action-badge admin-action-badge--${item.classification.toLowerCase()}`}>{LABELS[item.classification]}</span>
          <p>{item.reason}</p>
        </li>;
      })}
    </ul>
    <fieldset disabled={!selected.size}>
      <legend>Confirmation finale</legend>
      <label className="admin-confirmation-check">
        <input
          required
          type="checkbox"
          name="confirmation"
          value={ADMIN_CLEANUP_CONFIRMATION}
          checked={confirmed}
          onChange={(event) => setConfirmed(event.target.checked)}
        />
        <span>Je confirme ce plan exact. Le serveur recalculera chaque classification dans la transaction.</span>
      </label>
      <button className="admin-button" type="submit" disabled={!confirmed}>APPLIQUER LE PLAN SÉLECTIONNÉ</button>
    </fieldset>
  </form>;
}
