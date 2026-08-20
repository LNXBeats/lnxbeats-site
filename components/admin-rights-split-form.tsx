"use client";

import { useState } from "react";

import { saveSplitProposalAction } from "@/app/admin/droits/actions";

export function AdminRightsSplitForm({ requestNumber }: { requestNumber: string }) {
  const [clientShare, setClientShare] = useState("");
  const [lnxShare, setLnxShare] = useState("");
  return (
    <form className="admin-contract-form" action={saveSplitProposalAction}>
      <input type="hidden" name="requestNumber" value={requestNumber} />
      <div className="admin-field-grid">
        <label>Part client (%)<input type="number" name="clientSharePercent" min="0" max="100" required value={clientShare} onChange={(event) => setClientShare(event.target.value)} /></label>
        <label>Part LNX Beats (%)<input type="number" name="lnxSharePercent" min="0" max="100" required value={lnxShare} onChange={(event) => setLnxShare(event.target.value)} /></label>
        <label>Nature de la proposition<input name="nature" required maxLength={200} /></label>
      </div>
      <label>Justification par contributions<textarea name="contributionRationale" required maxLength={6000} /></label>
      <label>Rôles envisagés, séparés par virgules<input name="proposedRoles" maxLength={1000} /></label>
      <label>Commentaire<textarea name="comment" maxLength={4000} /></label>
      <button className="admin-button" type="submit">ENREGISTRER LA PROPOSITION</button>
      <button className="admin-button admin-button--quiet" type="button" onClick={() => { setClientShare("70"); setLnxShare("30"); }}>PRÉREMPLIR 70 / 30</button>
    </form>
  );
}
