"use client";

import { useState, type FormEvent } from "react";

import { authClient } from "@/lib/auth/client";

const GENERIC_MESSAGE = "Si un compte correspond à cette adresse, un message a été préparé.";

export function EmailRequestForm({ kind }: { kind: "verification" | "password-reset" }) {
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setPending(true);
    setMessage("");
    const data = new FormData(form);
    const email = String(data.get("email") ?? "").trim().toLowerCase();

    try {
      if (kind === "verification") {
        await authClient.sendVerificationEmail({ email, callbackURL: "/verifier-email" });
      } else {
        await authClient.requestPasswordReset({ email, redirectTo: "/reinitialiser-mot-de-passe" });
      }
    } catch {
      // The public response is intentionally identical for existing and unknown accounts.
    } finally {
      form.reset();
      setMessage(GENERIC_MESSAGE);
      setPending(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <div className="auth-field">
        <label htmlFor={`${kind}-email`}>Adresse email</label>
        <input id={`${kind}-email`} name="email" type="email" autoComplete="email" required maxLength={320} />
      </div>
      {message ? <p className="auth-form__success" role="status">{message}</p> : null}
      <button className="auth-submit" type="submit" disabled={pending}>
        <span>{pending ? "Envoi…" : kind === "verification" ? "Renvoyer le message" : "Recevoir un lien"}</span>
        <span aria-hidden="true">→</span>
      </button>
    </form>
  );
}
