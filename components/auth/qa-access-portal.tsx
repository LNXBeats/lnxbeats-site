"use client";

import { useState } from "react";

type QaProfile = "member" | "admin";

const destinations: Record<QaProfile, string> = {
  member: "/compte",
  admin: "/admin",
};

export function QaAccessPortal() {
  const [secret, setSecret] = useState("");
  const [pending, setPending] = useState<QaProfile | null>(null);
  const [message, setMessage] = useState("");

  async function login(profile: QaProfile) {
    if (pending) return;
    setPending(profile);
    setMessage("");
    try {
      const response = await fetch("/api/internal/qa/auth/login", {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          "x-lnx-qa-access-secret": secret,
        },
        body: JSON.stringify({ profile }),
      });
      if (!response.ok) {
        throw new Error(response.status === 429
          ? "Trop de tentatives. Patientez avant de réessayer."
          : "Accès QA refusé. Vérifiez le secret et réessayez.");
      }
      setSecret("");
      window.location.assign(destinations[profile]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Accès QA temporairement indisponible.");
      setPending(null);
    }
  }

  return (
    <div className="qa-access">
      <div className="qa-access__secret">
        <label htmlFor="qa-access-secret">Secret d’accès QA</label>
        <input
          id="qa-access-secret"
          name="qaAccessSecret"
          type="password"
          autoComplete="off"
          minLength={32}
          maxLength={1024}
          value={secret}
          onChange={(event) => setSecret(event.target.value)}
          aria-describedby="qa-access-help"
        />
        <small id="qa-access-help">Le secret est transmis uniquement à l’action serveur staging via HTTPS. Il n’est ni conservé dans le navigateur ni placé dans l’URL.</small>
      </div>
      <div className="qa-access__profiles">
        <article>
          <p className="auth-panel__label">Utilisateur QA</p>
          <h2>Parcours client</h2>
          <p>Profil MEMBER pour Commander, les paiements sandbox et le suivi du Compte.</p>
          <button className="form-button form-button--primary" type="button" disabled={pending !== null || secret.length < 32} onClick={() => void login("member")}>
            {pending === "member" ? "CONNEXION…" : "SE CONNECTER EN UTILISATEUR QA"}
          </button>
        </article>
        <article>
          <p className="auth-panel__label">Administrateur QA</p>
          <h2>Contrôle du staging</h2>
          <p>Profil ADMIN pour les commandes, paiements, notifications et validations administratives.</p>
          <button className="form-button" type="button" disabled={pending !== null || secret.length < 32} onClick={() => void login("admin")}>
            {pending === "admin" ? "CONNEXION…" : "SE CONNECTER EN ADMINISTRATEUR QA"}
          </button>
        </article>
      </div>
      {message ? <p className="form-message form-message--error" role="alert">{message}</p> : null}
    </div>
  );
}
