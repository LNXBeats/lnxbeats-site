"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { authClient } from "@/lib/auth/client";
import { validateProfileName } from "@/lib/auth/input";

export function ProfileForm({ initialName }: { initialName: string }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setError("");
    const data = new FormData(event.currentTarget);
    const name = validateProfileName(String(data.get("displayName") ?? ""));
    if (!name) {
      setError("Choisissez un nom d’affichage entre 1 et 120 caractères.");
      return;
    }

    setPending(true);
    try {
      const result = await authClient.updateUser({ name });
      if (result.error) {
        setError("La modification n’a pas pu être enregistrée.");
        return;
      }
      setMessage("Nom d’affichage mis à jour.");
      router.refresh();
    } catch {
      setError("La modification n’a pas pu être enregistrée.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit}>
      <div className="auth-field">
        <label htmlFor="profile-display-name">Nom d’affichage</label>
        <input id="profile-display-name" name="displayName" type="text" autoComplete="nickname" required maxLength={120} defaultValue={initialName} />
      </div>
      {error ? <p className="auth-form__error" role="alert">{error}</p> : null}
      {message ? <p className="auth-form__success" role="status">{message}</p> : null}
      <button className="auth-submit auth-submit--secondary" type="submit" disabled={pending}>
        <span>{pending ? "Enregistrement…" : "Enregistrer"}</span>
        <span aria-hidden="true">→</span>
      </button>
    </form>
  );
}
