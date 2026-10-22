"use client";
import { useEffect, useId, useRef, useState } from "react";
import { T, useSiteLanguage } from "@/components/site-language";
import styles from "./premiere-vote.module.css";

export type PremiereVoteChoice = "UP" | "DOWN" | null;
export type PremiereVoteSnapshot = { choice: PremiereVoteChoice; up: number; down: number };
type VoteError = "session" | "changed" | "unavailable" | null;
const voteFailure = (failure: unknown): VoteError => {
  const status = failure && typeof failure === "object" && "status" in failure ? Number(failure.status) : null;
  return status === 409 ? "changed" : status === 401 || status === 403 ? "session" : "unavailable";
};

/** Only server-confirmed choices and aggregate counts are displayed. */
export function readPremiereVoteSnapshot(raw: unknown): PremiereVoteSnapshot {
  if (!raw || typeof raw !== "object") throw Error("Invalid vote response");
  const result = raw as Record<string, unknown>;
  if (result.ok !== true || ![null, "UP", "DOWN"].includes(result.choice as PremiereVoteChoice)
    || typeof result.up !== "number" || !Number.isSafeInteger(result.up) || result.up < 0
    || typeof result.down !== "number" || !Number.isSafeInteger(result.down) || result.down < 0) throw Error("Invalid vote response");
  return { choice: result.choice as PremiereVoteChoice, up: result.up, down: result.down };
}

export function PremiereVoteView({ snapshot, loaded, pending, error, onChoice, onRetry }: {
  snapshot: PremiereVoteSnapshot; loaded: boolean; pending: boolean; error: VoteError;
  onChoice: (choice: PremiereVoteChoice) => void; onRetry: () => void;
}) {
  const id = useId(), { t } = useSiteLanguage();
  return <section className={styles.vote} aria-labelledby={id} aria-busy={pending}>
    <h3 id={id}><T text="Souhaitez-vous une sortie sur les plateformes ?" /></h3>
    <p className={styles.help}><T text="Un avis par compte, modifiable. Votre vote ne déclenche ni achat ni publication." /></p>
    <fieldset className={styles.choices} disabled={!loaded || pending || error === "changed"}>
      <legend className="sr-only"><T text="Votre avis sur cette avant-première" /></legend>
      <button className={styles.up} type="button" aria-pressed={loaded && snapshot.choice === "UP"} onClick={() => onChoice("UP")}><span aria-hidden="true">👍</span> <T text="Plutôt oui" /></button>
      <button className={styles.down} type="button" aria-pressed={loaded && snapshot.choice === "DOWN"} onClick={() => onChoice("DOWN")}><span aria-hidden="true">👎</span> <T text="Pas encore" /></button>
    </fieldset>
    {loaded && snapshot.choice && error !== "changed" ? <div className={styles.result}>
      <p role="status"><T text="Votre avis est enregistré." /> <T text="Plutôt oui : {up} · Pas encore : {down}" values={{ up: snapshot.up, down: snapshot.down }} /></p>
      <button type="button" className={styles.remove} disabled={pending} onClick={() => onChoice(null)}><T text="Retirer mon avis" /></button>
    </div> : null}
    {pending ? <p role="status"><T text="Enregistrement de votre avis…" /></p> : !loaded && !error ? <p role="status"><T text="Chargement de votre avis…" /></p> : null}
    {error ? <div className={styles.error}><p role="alert">{t(error === "changed" ? "Cette avant-première a changé. Rechargez la page et écoutez cette version avant de donner votre avis." : error === "session" ? "Reconnectez-vous avec un compte membre vérifié pour voter." : "Votre avis n’a pas pu être enregistré ou chargé. Aucun nouveau vote n’est confirmé.")}</p>
      {error === "changed" ? <button type="button" onClick={onRetry}><T text="Recharger cette avant-première" /></button> : !loaded ? <button type="button" onClick={onRetry}><T text="Réessayer de charger mon avis" /></button> : null}</div> : null}
  </section>;
}

export function PremiereVote({ projectId, binding }: { projectId: string; binding: string }) {
  const [snapshot, setSnapshot] = useState<PremiereVoteSnapshot>({ choice: null, up: 0, down: 0 });
  const [loadedFor, setLoadedFor] = useState<string | null>(null), [pending, setPending] = useState(false), [error, setError] = useState<VoteError>(null);
  const [revision, setRevision] = useState(0), inFlight = useRef(false), saveController = useRef<AbortController | null>(null);
  const versionKey = `${projectId}:${binding}`;
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/account/premiere-votes?projet=${encodeURIComponent(projectId)}&version=${encodeURIComponent(binding)}`, { cache: "no-store", credentials: "same-origin", signal: controller.signal }).then(async response => {
      if (!response.ok) throw Object.assign(Error(), { status: response.status });
      const result = readPremiereVoteSnapshot(await response.json());
      if (!controller.signal.aborted) { setSnapshot(result); setLoadedFor(versionKey); setError(null); setPending(false); }
    }).catch((failure: unknown) => {
      if (!controller.signal.aborted) setError(voteFailure(failure));
    });
    return () => { controller.abort(); saveController.current?.abort(); inFlight.current = false; };
  }, [projectId, binding, versionKey, revision]);
  async function vote(choice: PremiereVoteChoice) {
    if (inFlight.current || loadedFor !== versionKey || error === "changed" || choice === snapshot.choice) return;
    const controller = new AbortController(); saveController.current = controller;
    inFlight.current = true; setPending(true); setError(null);
    try {
      const response = await fetch("/api/account/premiere-votes", { method: "PATCH", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId, binding, choice }), signal: controller.signal });
      if (!response.ok) throw Object.assign(Error(), { status: response.status });
      const result = readPremiereVoteSnapshot(await response.json());
      if (!controller.signal.aborted) setSnapshot(result);
    } catch (failure) {
      if (!controller.signal.aborted) setError(voteFailure(failure));
    } finally { if (!controller.signal.aborted) { inFlight.current = false; setPending(false); } }
  }
  return <PremiereVoteView snapshot={snapshot} loaded={loadedFor === versionKey} pending={pending} error={error} onChoice={choice => void vote(choice)} onRetry={() => { if (error === "changed") { window.location.reload(); return; } setError(null); setRevision(value => value + 1); }} />;
}
