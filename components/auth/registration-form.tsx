"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";

import { validateRegistrationInput } from "@/lib/auth/input";
import { authClient } from "@/lib/auth/client";

const GENERIC_CONFIRMATION = "Si cette inscription peut être créée, un message de confirmation a été préparé.";

export function RegistrationForm() {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setError("");
    setMessage("");

    const data = new FormData(form);
    const validation = validateRegistrationInput({
      email: String(data.get("email") ?? ""),
      password: String(data.get("password") ?? ""),
      passwordConfirmation: String(data.get("passwordConfirmation") ?? ""),
      displayName: String(data.get("displayName") ?? ""),
    });
    if (!validation.ok) {
      setError(validation.message);
      return;
    }

    setPending(true);
    try {
      await authClient.signUp.email({
        email: validation.value.email,
        password: validation.value.password,
        name: validation.value.displayName,
        callbackURL: "/verifier-email",
      });
      form.reset();
      setMessage(GENERIC_CONFIRMATION);
    } catch {
      setMessage(GENERIC_CONFIRMATION);
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <form className="auth-form" onSubmit={handleSubmit} aria-describedby={error ? "registration-error" : undefined}>
        <div className="auth-field">
          <label htmlFor="registration-name">Nom d’affichage <span>(facultatif)</span></label>
          <input id="registration-name" name="displayName" type="text" autoComplete="nickname" maxLength={120} />
        </div>
        <div className="auth-field">
          <label htmlFor="registration-email">Adresse email</label>
          <input id="registration-email" name="email" type="email" autoComplete="email" required maxLength={320} />
        </div>
        <div className="auth-field">
          <label htmlFor="registration-password">Mot de passe</label>
          <input id="registration-password" name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} aria-describedby="registration-password-help" />
          <p className="auth-field__help" id="registration-password-help">12 caractères minimum. Les phrases de passe sont acceptées.</p>
        </div>
        <div className="auth-field">
          <label htmlFor="registration-password-confirmation">Confirmer le mot de passe</label>
          <input id="registration-password-confirmation" name="passwordConfirmation" type="password" autoComplete="new-password" required minLength={12} maxLength={128} />
        </div>
        {error ? <p className="auth-form__error" id="registration-error" role="alert">{error}</p> : null}
        {message ? <p className="auth-form__success" role="status">{message}</p> : null}
        <button className="auth-submit" type="submit" disabled={pending}>
          <span>{pending ? "Création…" : "Créer mon espace"}</span>
          <span aria-hidden="true">→</span>
        </button>
      </form>
      <p className="auth-panel__note">Déjà membre ? <Link href="/connexion">Reprendre votre espace</Link>.</p>
    </>
  );
}
