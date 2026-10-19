"use client";

import { T } from "@/components/site-language";
import { useState, type FormEvent } from "react";

import { authClient } from "@/lib/auth/client";
import { isValidPassword } from "@/lib/auth/input";

export function ChangePasswordForm() {
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setError("");
    const form = event.currentTarget;
    const data = new FormData(form);
    const currentPassword = String(data.get("currentPassword") ?? "");
    const newPassword = String(data.get("newPassword") ?? "");
    const confirmation = String(data.get("passwordConfirmation") ?? "");

    if (!isValidPassword(newPassword)) {
      setError("Le nouveau mot de passe doit contenir entre 12 et 128 caractères.");
      return;
    }
    if (newPassword !== confirmation) {
      setError("Les deux nouveaux mots de passe ne correspondent pas.");
      return;
    }

    setPending(true);
    try {
      const result = await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true });
      if (result.error) {
        setError("Le mot de passe n’a pas pu être modifié. Vérifiez le mot de passe actuel.");
        return;
      }
      form.reset();
      setMessage("Mot de passe modifié. Les autres sessions ont été fermées.");
    } catch {
      setError("Le mot de passe n’a pas pu être modifié. Réessayez.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <div className="auth-field">
        <label htmlFor="current-password"><T text="Mot de passe actuel" /></label>
        <input id="current-password" name="currentPassword" type="password" autoComplete="current-password" required maxLength={128} />
      </div>
      <div className="auth-field">
        <label htmlFor="new-password"><T text="Nouveau mot de passe" /></label>
        <input id="new-password" name="newPassword" type="password" autoComplete="new-password" required minLength={12} maxLength={128} aria-describedby="change-password-help" />
        <p className="auth-field__help" id="change-password-help"><T text="12 caractères minimum." /></p>
      </div>
      <div className="auth-field">
        <label htmlFor="new-password-confirmation"><T text="Confirmer le nouveau mot de passe" /></label>
        <input id="new-password-confirmation" name="passwordConfirmation" type="password" autoComplete="new-password" required minLength={12} maxLength={128} />
      </div>
      {error ? <p className="auth-form__error" role="alert">{<T text={error} />}</p> : null}
      {message ? <p className="auth-form__success" role="status">{<T text={message} />}</p> : null}
      <button className="auth-submit auth-submit--secondary" type="submit" disabled={pending}>
        <span>{pending ? "Modification…" : <T text="Modifier le mot de passe" />}</span>
        <span aria-hidden="true">→</span>
      </button>
    </form>
  );
}
