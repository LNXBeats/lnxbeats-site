"use client";

import { useId, useRef, useState } from "react";

import { deleteOrderAction, transitionOrderAction } from "@/app/admin/actions";

type Transition = {
  to: string;
  label: string;
  sensitive?: boolean;
};

export function AdminOrderActions({ orderNumber, transitions, deletionEligible, deletionReason, emptyReason }: {
  orderNumber: string;
  transitions: readonly Transition[];
  deletionEligible: boolean;
  deletionReason: string;
  emptyReason?: string;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const transitionDialog = useRef<HTMLDialogElement>(null);
  const deletionDialog = useRef<HTMLDialogElement>(null);
  const lastTrigger = useRef<HTMLButtonElement | null>(null);
  const [selectedTransition, setSelectedTransition] = useState<Transition | null>(null);
  const [confirmation, setConfirmation] = useState("");

  function openTransition(transition: Transition, trigger: HTMLButtonElement) {
    lastTrigger.current = trigger;
    setSelectedTransition(transition);
    transitionDialog.current?.showModal();
  }
  function openDeletion(trigger: HTMLButtonElement) {
    lastTrigger.current = trigger;
    setConfirmation("");
    deletionDialog.current?.showModal();
  }
  function restoreFocus() {
    lastTrigger.current?.focus();
  }

  return <>
    {transitions.length || deletionEligible ? <div className="admin-actions">
      {transitions.map((transition) => transition.sensitive ? (
        <button key={transition.to} type="button" onClick={(event) => openTransition(transition, event.currentTarget)}>{transition.label}</button>
      ) : (
        <form key={transition.to} action={transitionOrderAction}><input type="hidden" name="orderNumber" value={orderNumber} /><input type="hidden" name="targetStatus" value={transition.to} /><button type="submit">{transition.label} <span aria-hidden="true">→</span></button></form>
      ))}
      {deletionEligible ? <button type="button" className="admin-danger-action" onClick={(event) => openDeletion(event.currentTarget)}>Supprimer définitivement</button> : null}
    </div> : <p>{emptyReason ?? "Aucune transition métier disponible depuis ce statut."}</p>}
    {!deletionEligible && (transitions.length === 0) && !emptyReason ? <p className="admin-action-reason">{deletionReason}</p> : null}

    <dialog ref={transitionDialog} className="admin-confirm-dialog" aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={(event) => { event.preventDefault(); transitionDialog.current?.close(); }} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); transitionDialog.current?.close(); } }} onClose={restoreFocus}>
      <h2 id={titleId}>{selectedTransition?.to === "CANCELLED" ? "Confirmer l’annulation de cette commande ?" : selectedTransition?.to === "DELIVERED" ? "Confirmer la livraison au client ?" : `Confirmer : ${selectedTransition?.label ?? "cette action"} ?`}</h2>
      <p id={descriptionId}>{selectedTransition?.to === "DELIVERED" ? "Tous les livrables enregistrés deviendront accessibles au client et une notification unique sera préparée." : "Cette action modifiera le statut et sera inscrite une seule fois dans l’historique."}</p>
      <div className="admin-dialog-actions">
        <button type="button" onClick={() => transitionDialog.current?.close()}>Conserver la commande</button>
        {selectedTransition ? <form action={transitionOrderAction}><input type="hidden" name="orderNumber" value={orderNumber} /><input type="hidden" name="targetStatus" value={selectedTransition.to} /><button type="submit" className="admin-danger-action">Confirmer : {selectedTransition.label}</button></form> : null}
      </div>
    </dialog>

    <dialog ref={deletionDialog} className="admin-confirm-dialog" aria-labelledby={`${titleId}-delete`} aria-describedby={`${descriptionId}-delete`} onCancel={(event) => { event.preventDefault(); deletionDialog.current?.close(); }} onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); deletionDialog.current?.close(); } }} onClose={restoreFocus}>
      <h2 id={`${titleId}-delete`}>Supprimer définitivement cette commande ?</h2>
      <p id={`${descriptionId}-delete`}>Cette action est irréversible. Les références privées et la timeline associées seront retirées. Saisissez <strong>{orderNumber}</strong> pour confirmer.</p>
      <form action={deleteOrderAction}>
        <input type="hidden" name="orderNumber" value={orderNumber} />
        <label><span>Numéro de commande</span><input name="confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /></label>
        <div className="admin-dialog-actions"><button type="button" onClick={() => deletionDialog.current?.close()}>Conserver la commande</button><button type="submit" className="admin-danger-action" disabled={confirmation !== orderNumber}>Supprimer définitivement</button></div>
      </form>
    </dialog>
  </>;
}
