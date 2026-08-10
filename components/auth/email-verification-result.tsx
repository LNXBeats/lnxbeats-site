"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

type VerificationState = "checking" | "confirmed" | "invalid";

export function EmailVerificationResult() {
  const started = useRef(false);
  const [state, setState] = useState<VerificationState>("checking");

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const token = new URLSearchParams(window.location.hash.slice(1)).get("token") ?? "";
    window.history.replaceState(null, "", window.location.pathname);
    if (!token) {
      void Promise.resolve().then(() => setState("invalid"));
      return;
    }

    void fetch("/api/auth/verification-email", {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token }),
    })
      .then((response) => response.ok ? response.json() as Promise<{ verified?: boolean }> : { verified: false })
      .then((result) => setState(result.verified ? "confirmed" : "invalid"))
      .catch(() => setState("invalid"));
  }, []);

  const confirmed = state === "confirmed";
  const checking = state === "checking";

  return (
    <>
      <div className="auth-intro">
        <p className="eyebrow">Vérification</p>
        <h1>{checking ? "Le lien est vérifié…" : confirmed ? "L’adresse est confirmée." : "Le lien s’est refermé."}</h1>
        <p>{checking ? "Un instant suffit pour confirmer cette adresse." : confirmed ? "Votre espace membre est maintenant actif. La première connexion peut commencer." : "Ce lien est invalide, expiré ou a déjà été utilisé."}</p>
      </div>
      <div className="auth-panel auth-panel--minimal" aria-live="polite">
        <p className="auth-panel__label">Étape suivante</p>
        {checking ? (
          <p role="status">Vérification en cours…</p>
        ) : (
          <p>{confirmed ? <Link className="auth-inline-link" href="/connexion">Entrer dans mon espace →</Link> : <Link className="auth-inline-link" href="/renvoyer-verification">Demander un nouveau message →</Link>}</p>
        )}
      </div>
    </>
  );
}
