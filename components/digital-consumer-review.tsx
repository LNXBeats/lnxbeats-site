"use client";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
export function DigitalConsumerReview({ requestId, updatedAt, matched }: { requestId: string; updatedAt: string; matched: boolean }) {
  const [decision, setDecision] = useState("UNDER_REVIEW"), [basis, setBasis] = useState("HUMAN_REVIEW"), [reason, setReason] = useState(""), [pending, setPending] = useState(false), [message, setMessage] = useState("");
  const router = useRouter();
  const attempt = useRef<{ signature: string; idempotencyKey: string } | null>(null);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (pending) return; setPending(true); setMessage("");
    try {
      const signature = JSON.stringify({ requestId, expectedUpdatedAt: updatedAt, decision, basis, reason });
      if (attempt.current?.signature !== signature) attempt.current = { signature, idempotencyKey: crypto.randomUUID() };
      const response = await fetch("/api/admin/digital/consumer-requests", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestId, expectedUpdatedAt: updatedAt, idempotencyKey: attempt.current.idempotencyKey, decision, basis, reason }) });
      if (!response.ok) throw new Error("Revue non enregistrée. Rechargez et vérifiez l’identité, les preuves et la motivation. Aucun remboursement n’a été lancé.");
      setMessage("Décision enregistrée. Aucune opération financière ni modification des accès."); router.refresh();
    } catch (e) { setMessage(e instanceof Error ? e.message : "Revue indisponible."); } finally { setPending(false); }
  }
  return <form method="post" action="/api/admin/digital/consumer-requests" onSubmit={submit}><label>Décision humaine <select value={decision} onChange={e => setDecision(e.target.value)}><option value="UNDER_REVIEW">Prise en revue</option>{matched ? <><option value="ACCEPTED">Demande retenue après revue</option><option value="REJECTED">Demande non retenue après revue</option></> : null}</select></label>
    <label>Fondement <select value={basis} onChange={e => setBasis(e.target.value)}><option value="HUMAN_REVIEW">Revue humaine motivée (qualification et information vérifiées)</option><option value="DIGITAL_EXCEPTION">Exception numérique — quatre preuves cumulatives obligatoires</option></select></label>
    <label>Motivation privée de la décision <textarea required minLength={20} maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} /></label>
    <p>Ne pas rejeter sur la seule base de deux cases ou du délai apparent. La demande de geste commercial et la non-conformité restent distinctes. Retenir une demande ne lance pas le remboursement et ne révoque aucun téléchargement.</p>
    <button type="submit" disabled={pending}>{pending ? "Enregistrement…" : "Enregistrer uniquement ma revue"}</button>{message ? <p role="status">{message}</p> : null}</form>;
}
