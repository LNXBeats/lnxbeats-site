"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { useFormStatus } from "react-dom";
import { creationWorkAction } from "@/app/admin/creation-work-actions";
import { AdminOrderActions } from "@/components/admin-order-actions";
import { deadlineGauge, parisDateTime } from "@/lib/admin/creation-work-policy";
import { getAllowedOrderTransitions } from "@/lib/admin/order-machine";
import { orderStatusPresentation, type KnownOrderStatus } from "@/lib/orders/status";

export type CreationWorkView = {
  id: string; orderNumber: string; title: string; status: KnownOrderStatus; updatedAt: string;
  startedAt: string; acceptedAt: string | null; dueAt: string | null; deadlineSource: "INTERNAL_SAVED" | "INDICATIVE_14_DAYS" | "NONE"; deadlineRevision: string; visibilityRevision: string; hidden: boolean;
  deadlineRequestId: string; visibilityRequestId: string;
};

function Submit({ children }: { children: React.ReactNode }) {
  const { pending } = useFormStatus();
  return <button type="submit" disabled={pending}>{pending ? "Enregistrement…" : children}</button>;
}

function FollowUpForm({ item, kind }: { item: CreationWorkView; kind: "DEADLINE" | "HIDE" | "RESTORE" }) {
  const id = useId();
  const requestId = kind === "DEADLINE" ? item.deadlineRequestId : item.visibilityRequestId;
  return <form action={creationWorkAction} className="admin-creation-work__form">
    <input type="hidden" name="kind" value={kind} />
    <input type="hidden" name="orderNumber" value={item.orderNumber} />
    <input type="hidden" name="updatedAt" value={item.updatedAt} />
    <input type="hidden" name="revision" value={kind === "DEADLINE" ? item.deadlineRevision : item.visibilityRevision} />
    <input type="hidden" name="requestId" value={requestId} />
    <fieldset disabled={!requestId}>
      {kind === "DEADLINE" ? <>
        <label htmlFor={id}>Échéance de suivi · heure de Paris</label>
        <input id={id} type="datetime-local" name="deadline" required defaultValue={item.dueAt ? parisDateTime(new Date(item.dueAt)) : ""} />
        <p>Repère interne, sans modification du délai convenu avec le client. Une retouche ne remet pas la jauge à zéro.</p>
        <Submit>Enregistrer l’échéance</Submit>
      </> : kind === "HIDE" ? <>
        <label className="admin-creation-work__check"><input type="checkbox" name="confirmedTest" value="yes" required /> Je confirme : cet essai est personnel.</label>
        <p>Masquer ici uniquement. Commande, paiement, remboursement éventuel et historique restent inchangés. Le dossier réapparaît en cas de nouvelle modification métier.</p>
        <Submit>Masquer du Centre d’action</Submit>
      </> : <Submit>Réafficher ici</Submit>}
    </fieldset>
  </form>;
}

export function AdminCreationWorkCenter({ items, hidden, limited, initialNow, notice }: {
  items: CreationWorkView[]; hidden: CreationWorkView[]; limited: boolean; initialNow: string; notice?: string;
}) {
  const [now, setNow] = useState(() => Date.parse(initialNow));
  useEffect(() => {
    const tick = () => setNow(Date.now());
    tick();
    const timer = setInterval(tick, 60_000);
    return () => clearInterval(timer);
  }, []);
  return <section id="centre-creations" className="admin-creation-work" aria-labelledby="centre-creations-title">
    <header className="admin-creation-work__heading">
      <div><p className="admin-kicker">Centre d’action</p><h2 id="centre-creations-title">Mes créations à traiter <span>{items.length}{limited ? "+" : ""}</span></h2>
        <p>Les demandes de musique, de l’étude du brief à la livraison.</p></div>
      <Link href="/admin/commandes?filtre=active">Toutes les demandes →</Link>
    </header>
    {notice === "enregistre" ? <p className="admin-creation-work__notice" role="status">Suivi enregistré dans l’historique interne.</p> : notice ? <p className="admin-creation-work__notice" role="alert">Le suivi n’a pas été enregistré. Le dossier a pu changer : rechargez cette page, vérifiez votre saisie et réessayez. L’échéance doit être postérieure au début du suivi ; les heures de Paris ambiguës sont refusées.</p> : null}
    {!items.length ? <div className="admin-creation-work__empty"><strong>Aucune création à traiter ici pour le moment.</strong><p>Les prochaines demandes apparaîtront ici. Les essais masqués restent consultables ; aucun paiement ni historique n’est effacé.</p></div> : null}
    <div className="admin-creation-work__list">{items.map((item) => {
      const gauge = deadlineGauge(item.startedAt, item.dueAt, now);
      const path = `/admin/commandes/${encodeURIComponent(item.orderNumber)}`;
      // Irreversible decisions and delivery require reviewing the full dossier.
      // All other buttons use the existing authorized, locked business engine.
      const transitions = getAllowedOrderTransitions(item.status).filter(({ sensitive }) => !sensitive);
      return <article className="admin-creation-work__item" key={item.id} aria-labelledby={`creation-${item.id}`}>
        <div className="admin-creation-work__identity"><small>{item.orderNumber}</small><h3 id={`creation-${item.id}`}>{item.title}</h3><span className="admin-v21-status">{orderStatusPresentation[item.status].label}</span>
          <small>{item.acceptedAt ? `Acceptée le ${new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", dateStyle: "medium", timeStyle: "short" }).format(new Date(item.acceptedAt))}` : "Date d’acceptation non enregistrée"}</small>
          {item.status === "FIRST_VERSION_READY" ? <p>Retour du client attendu avant finalisation.</p> : null}
          <Link href={`${path}#admin-brief-title`}>Lire le brief et ouvrir le dossier →</Link>
        </div>
        <div className="admin-creation-work__deadline" data-tone={gauge.tone}>
          <strong>{gauge.label}</strong>
          <div className="admin-creation-work__gauge" role="meter" aria-label={`Temps écoulé pour ${item.orderNumber}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={gauge.percent} aria-valuetext={gauge.label}><span style={{ width: `${gauge.percent}%` }} /></div>
          {item.dueAt ? <small>{item.deadlineSource === "INDICATIVE_14_DAYS" ? "Livraison estimée" : "Échéance de suivi"} : {new Intl.DateTimeFormat("fr-FR", { timeZone: "Europe/Paris", dateStyle: "medium", timeStyle: "short" }).format(new Date(item.dueAt))} · Paris</small> : <small>Aucun délai précis enregistré : pas de compte à rebours inventé.</small>}
          {item.deadlineSource === "INDICATIVE_14_DAYS" ? <small>Repère indicatif : 14 jours après prise en charge. À ajuster si un autre délai a été convenu ; aucun contrat n’est modifié.</small> : null}
          <details><summary>{item.dueAt ? "Modifier l’échéance" : "Planifier l’échéance"}</summary><FollowUpForm key={item.deadlineRevision} item={item} kind="DEADLINE" /></details>
        </div>
        <div className="admin-creation-work__actions"><AdminOrderActions orderNumber={item.orderNumber} transitions={transitions} emptyReason="La livraison se prépare depuis le dossier." />
          <Link href={`${path}#admin-actions-title`}>Traiter dans le dossier →</Link>
          <details><summary>C’est mon essai personnel</summary><FollowUpForm key={item.visibilityRevision} item={item} kind="HIDE" /></details>
        </div>
      </article>;
    })}</div>
    {limited ? <p className="admin-creation-work__notice">Vue limitée aux 200 premiers dossiers. Consultez toutes les commandes pour la suite.</p> : null}
    {hidden.length ? <details className="admin-creation-work__hidden"><summary>Essais personnels masqués ici ({hidden.length})</summary><p>Les obligations financières restent suivies dans les rubriques d’origine.</p>{hidden.map((item) => <div key={item.id}><Link href={`/admin/commandes/${encodeURIComponent(item.orderNumber)}`}>{item.orderNumber} · {item.title}</Link><FollowUpForm key={item.visibilityRevision} item={item} kind="RESTORE" /></div>)}</details> : null}
  </section>;
}
