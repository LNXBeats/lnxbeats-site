"use client";
import { T } from "@/components/site-language";


import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { ResetPasswordForm } from "@/components/auth/reset-password-form";

export function ResetPasswordEntry({ confirmed }: { confirmed: boolean }) {
  const started = useRef(false);
  const [token, setToken] = useState<string | null | undefined>(confirmed ? null : undefined);

  useEffect(() => {
    if (confirmed || started.current) return;
    started.current = true;
    const candidate = new URLSearchParams(window.location.hash.slice(1)).get("token");
    window.history.replaceState(null, "", window.location.pathname);
    void Promise.resolve().then(() => {
      setToken(candidate && candidate.length >= 20 && candidate.length <= 512 && !/\s/.test(candidate) ? candidate : null);
    });
  }, [confirmed]);

  if (confirmed) {
    return <p className="auth-form__success" role="status"><T text="Le changement est confirmé."/> <Link href="/connexion"><T text="Vous pouvez vous reconnecter"/></Link>.</p>;
  }
  if (token === undefined) return <p role="status"><T text="Vérification du lien…"/></p>;
  if (token) return <ResetPasswordForm token={token} />;
  return <p className="auth-form__error" role="alert"><T text="Ce lien n’est plus utilisable."/> <Link href="/mot-de-passe-oublie"><T text="Demandez-en un nouveau"/></Link>.</p>;
}
