"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function ContractAcceptanceForm({ requestNumber, expectedName, documentId, documentVersion, hashShort }: { requestNumber: string; expectedName: string; documentId: string; documentVersion: number; hashShort: string }) {
  const router = useRouter();
  const [viewed, setViewed] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [typedFullName, setTypedFullName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit() {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/rights/${encodeURIComponent(requestNumber)}/accept`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ typedFullName, password, accepted }) });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error ?? "L’acceptation n’a pas pu être enregistrée.");
      router.refresh();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "L’acceptation n’a pas pu être enregistrée."); }
    finally { setBusy(false); }
  }
  return <section className="rights-acceptance" aria-labelledby="rights-acceptance-title"><p className="eyebrow">Acceptation électronique</p><h2 id="rights-acceptance-title">Vérifiez puis acceptez le projet.</h2><p>Il ne s’agit pas d’une signature électronique qualifiée. Votre compte vérifié, la réauthentification, l’empreinte du document et l’heure serveur seront archivés.</p><dl className="order-detail__facts"><div><dt>Document</dt><dd>Version {documentVersion}</dd></div><div><dt>Empreinte</dt><dd>{hashShort}</dd></div><div><dt>Identité attendue</dt><dd>{expectedName}</dd></div></dl><a className="form-button" href={`/api/rights/documents/${documentId}`} target="_blank" rel="noreferrer" onClick={() => setViewed(true)}>LIRE LE DOCUMENT INTÉGRAL</a><label className="choice rights-acceptance__check"><input type="checkbox" checked={viewed} onChange={(event) => setViewed(event.target.checked)} /><span>J’ai affiché et vérifié l’intégralité du document, sa version et ses paramètres.</span></label><label className="choice rights-acceptance__check"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} /><span>J’accepte les Conditions particulières présentées. Je comprends qu’aucun droit ni paiement n’est actif dans cette version.</span></label><div className="field"><label htmlFor="contract-full-name">Saisissez votre nom complet exactement comme ci-dessus</label><input id="contract-full-name" autoComplete="name" maxLength={200} value={typedFullName} onChange={(event) => setTypedFullName(event.target.value)} /></div><div className="field"><label htmlFor="contract-password">Confirmez votre mot de passe</label><input id="contract-password" type="password" autoComplete="current-password" maxLength={128} value={password} onChange={(event) => setPassword(event.target.value)} /></div><button type="button" className="form-button form-button--primary" disabled={busy || !viewed || !accepted || !typedFullName.trim() || !password} onClick={() => void submit()}>{busy ? "ACCEPTATION…" : "J’ACCEPTE LES CONDITIONS PARTICULIÈRES"}</button>{error ? <p className="form-message form-message--error" role="alert">{error}</p> : null}</section>;
}
