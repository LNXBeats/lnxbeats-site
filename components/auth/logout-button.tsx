"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { authClient } from "@/lib/auth/client";

export function LogoutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  async function logout() {
    setPending(true);
    setError("");
    try {
      const result = await authClient.signOut();
      if (result.error) {
        setError("La session n’a pas pu être fermée. Réessayez.");
        return;
      }
      router.replace("/connexion");
      router.refresh();
    } catch {
      setError("La session n’a pas pu être fermée. Réessayez.");
    } finally {
      setPending(false);
    }
  }

  return (
    <span className="auth-logout">
      <button className="auth-text-button" type="button" onClick={logout} disabled={pending}>
        {pending ? "Fermeture…" : "Fermer la session"}
      </button>
      {error ? <span className="auth-form__error" role="alert">{error}</span> : null}
    </span>
  );
}
