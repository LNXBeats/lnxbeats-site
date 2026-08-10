"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { authClient } from "@/lib/auth/client";

const GENERIC_ERROR = "Connexion impossible. Vérifiez vos identifiants et réessayez.";

export function LoginForm({ returnTo }: { returnTo: string }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError("");

    const data = new FormData(event.currentTarget);
    const email = String(data.get("email") ?? "");
    const password = String(data.get("password") ?? "");

    try {
      const result = await authClient.signIn.email({ email, password, rememberMe: true });
      if (result.error) {
        setError(GENERIC_ERROR);
        return;
      }

      router.replace(returnTo);
      router.refresh();
    } catch {
      setError(GENERIC_ERROR);
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="auth-form" onSubmit={handleSubmit} aria-describedby={error ? "login-error" : undefined}>
      <div className="auth-field">
        <label htmlFor="email">Adresse email</label>
        <input id="email" name="email" type="email" autoComplete="username" required maxLength={320} />
      </div>
      <div className="auth-field">
        <label htmlFor="password">Mot de passe</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required minLength={12} maxLength={128} />
      </div>
      {error ? <p className="auth-form__error" id="login-error" role="alert">{error}</p> : null}
      <button className="auth-submit" type="submit" disabled={pending}>
        <span>{pending ? "Connexion…" : "Entrer dans mon espace"}</span>
        <span aria-hidden="true">→</span>
      </button>
    </form>
  );
}
