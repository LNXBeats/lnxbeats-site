"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { isValidPassword } from "@/lib/auth/input";
import { authClient } from "@/lib/auth/client";

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const data = new FormData(event.currentTarget);
    const password = String(data.get("password") ?? "");
    const confirmation = String(data.get("passwordConfirmation") ?? "");

    if (!isValidPassword(password)) {
      setError("Le mot de passe doit contenir entre 12 et 128 caractères.");
      return;
    }
    if (password !== confirmation) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }

    setPending(true);
    try {
      const result = await authClient.resetPassword({ newPassword: password, token });
      if (result.error) {
        setError("Ce lien n’est plus utilisable. Demandez-en un nouveau.");
        return;
      }
      router.replace("/reinitialiser-mot-de-passe?etat=confirme");
      router.refresh();
    } catch {
      setError("Ce lien n’est plus utilisable. Demandez-en un nouveau.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit} aria-describedby={error ? "reset-error" : "reset-password-help"}>
      <div className="auth-field">
        <label htmlFor="reset-password">Nouveau mot de passe</label>
        <input id="reset-password" name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} />
        <p className="auth-field__help" id="reset-password-help">12 caractères minimum. Les phrases de passe sont acceptées.</p>
      </div>
      <div className="auth-field">
        <label htmlFor="reset-password-confirmation">Confirmer le mot de passe</label>
        <input id="reset-password-confirmation" name="passwordConfirmation" type="password" autoComplete="new-password" required minLength={12} maxLength={128} />
      </div>
      {error ? <p className="auth-form__error" id="reset-error" role="alert">{error}</p> : null}
      <button className="auth-submit" type="submit" disabled={pending}>
        <span>{pending ? "Mise à jour…" : "Choisir ce mot de passe"}</span>
        <span aria-hidden="true">→</span>
      </button>
    </form>
  );
}
