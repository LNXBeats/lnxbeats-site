"use client";

import Link from "next/link";
import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  validateRegistrationCode,
  validateRegistrationEmail,
  validateRegistrationPassword,
} from "@/lib/auth/input";

type Stage = "email" | "code" | "password" | "existing" | "complete";

type ApiPayload = {
  attemptId?: string;
  attemptsRemaining?: number;
  completed?: boolean;
  error?: string;
  maskedEmail?: string;
  message?: string;
  next?: "code" | "password" | "login";
  stage?: "email" | "password";
};

async function readPayload(response: Response) {
  try {
    return await response.json() as ApiPayload;
  } catch {
    return {};
  }
}

export function RegistrationForm() {
  const [stage, setStage] = useState<Stage>("email");
  const [email, setEmail] = useState("");
  const [attemptId, setAttemptId] = useState("");
  const [maskedEmail, setMaskedEmail] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const firstFieldRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/auth/registration/state", { cache: "no-store" })
      .then(readPayload)
      .then((payload) => {
        if (!active || payload.stage !== "password") return;
        setMaskedEmail(payload.maskedEmail ?? "votre adresse vérifiée");
        setStage("password");
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, [stage]);

  function resetFeedback() {
    setError("");
    setMessage("");
  }

  async function requestCode(requestedEmail: string) {
    const response = await fetch("/api/auth/registration/code", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: requestedEmail }),
    });
    const payload = await readPayload(response);
    if (!response.ok || !payload.attemptId) throw new Error(payload.error || "Le code n’a pas pu être préparé.");
    setAttemptId(payload.attemptId);
    setMessage(payload.message ?? "Si cette adresse peut être utilisée, un code a été préparé.");
    setStage("code");
  }

  async function handleEmail(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetFeedback();
    const form = new FormData(event.currentTarget);
    const validation = validateRegistrationEmail(String(form.get("email") ?? ""));
    if (!validation.ok) return setError(validation.message);
    setPending(true);
    setEmail(validation.value);
    try {
      await requestCode(validation.value);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Le code n’a pas pu être préparé.");
    } finally {
      setPending(false);
    }
  }

  async function handleCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetFeedback();
    const form = new FormData(event.currentTarget);
    const validation = validateRegistrationCode(String(form.get("code") ?? ""));
    if (!validation.ok) return setError(validation.message);
    if (!attemptId) return setError("Demandez un nouveau code pour continuer.");
    setPending(true);
    try {
      const response = await fetch("/api/auth/registration/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ attemptId, code: validation.value }),
      });
      const payload = await readPayload(response);
      if (!response.ok) throw new Error(payload.error || "Ce code ne peut pas être validé.");
      if (payload.next === "login") {
        setMessage(payload.message ?? "Cette adresse possède déjà un espace.");
        setStage("existing");
        return;
      }
      if (payload.next !== "password") throw new Error("Ce code ne peut pas être validé.");
      setMaskedEmail(payload.maskedEmail ?? email);
      setStage("password");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Ce code ne peut pas être validé.");
    } finally {
      setPending(false);
    }
  }

  async function handlePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    resetFeedback();
    const form = new FormData(event.currentTarget);
    const password = String(form.get("password") ?? "");
    const passwordConfirmation = String(form.get("passwordConfirmation") ?? "");
    const validation = validateRegistrationPassword({ password, passwordConfirmation });
    if (!validation.ok) return setError(validation.message);
    setPending(true);
    try {
      const response = await fetch("/api/auth/registration/complete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password, passwordConfirmation }),
      });
      const payload = await readPayload(response);
      if (!response.ok || !payload.completed) throw new Error(payload.error || "Votre espace n’a pas pu être finalisé.");
      setMessage(payload.message ?? "Votre espace est prêt.");
      setStage("complete");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Votre espace n’a pas pu être finalisé.");
    } finally {
      setPending(false);
    }
  }

  async function handleResend() {
    resetFeedback();
    if (!email) {
      setStage("email");
      return;
    }
    setPending(true);
    try {
      await requestCode(email);
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Le code n’a pas pu être préparé.");
    } finally {
      setPending(false);
    }
  }

  if (stage === "complete") {
    return (
      <div className="auth-form" aria-live="polite">
        <p className="auth-form__success">{message}</p>
        <Link className="auth-submit" href="/connexion"><span>Me connecter</span><span aria-hidden="true">→</span></Link>
      </div>
    );
  }

  if (stage === "existing") {
    return (
      <div className="auth-form" aria-live="polite">
        <p className="auth-form__success">{message}</p>
        <Link className="auth-submit" href="/connexion"><span>Revenir à la connexion</span><span aria-hidden="true">→</span></Link>
        <p className="auth-panel__note"><Link href="/mot-de-passe-oublie">Mot de passe oublié&nbsp;?</Link></p>
      </div>
    );
  }

  if (stage === "code") {
    return (
      <form className="auth-form" onSubmit={handleCode} aria-describedby={error ? "registration-error" : undefined}>
        <div className="auth-form__heading">
          <h2>Entrez le code reçu.</h2>
          <p>Six chiffres, valables dix minutes. Le dernier envoi remplace les précédents.</p>
        </div>
        <div className="auth-field auth-field--code">
          <label htmlFor="registration-code">Code de vérification</label>
          <input key="registration-code" ref={firstFieldRef} id="registration-code" name="code" type="text" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required />
        </div>
        {error ? <p className="auth-form__error" id="registration-error" role="alert">{error}</p> : null}
        {message ? <p className="auth-form__success" role="status">{message}</p> : null}
        <button className="auth-submit" type="submit" disabled={pending}><span>{pending ? "Vérification…" : "Valider le code"}</span><span aria-hidden="true">→</span></button>
        <div className="auth-form__secondary-actions">
          <button type="button" onClick={handleResend} disabled={pending}>Recevoir un nouveau code</button>
          <button type="button" onClick={() => { resetFeedback(); setStage("email"); }} disabled={pending}>Changer d’adresse</button>
        </div>
      </form>
    );
  }

  if (stage === "password") {
    return (
      <form className="auth-form" onSubmit={handlePassword} aria-describedby={error ? "registration-error" : "registration-password-help"}>
        <div className="auth-form__heading">
          <h2>Votre adresse est vérifiée.</h2>
          <p>{maskedEmail}. Il reste à protéger votre espace.</p>
        </div>
        <div className="auth-field">
          <label htmlFor="registration-password">Mot de passe</label>
          <input key="registration-password" ref={firstFieldRef} id="registration-password" name="password" type="password" autoComplete="new-password" required minLength={12} maxLength={128} />
          <p className="auth-field__help" id="registration-password-help">12 à 128 caractères. Une phrase de passe est acceptée.</p>
        </div>
        <div className="auth-field">
          <label htmlFor="registration-password-confirmation">Confirmer le mot de passe</label>
          <input id="registration-password-confirmation" name="passwordConfirmation" type="password" autoComplete="new-password" required minLength={12} maxLength={128} />
        </div>
        {error ? <p className="auth-form__error" id="registration-error" role="alert">{error}</p> : null}
        <button className="auth-submit" type="submit" disabled={pending}><span>{pending ? "Création…" : "Créer mon espace"}</span><span aria-hidden="true">→</span></button>
      </form>
    );
  }

  return (
    <form className="auth-form" onSubmit={handleEmail} aria-describedby={error ? "registration-error" : "registration-email-help"}>
      <div className="auth-form__heading">
        <h2>Commençons par votre adresse.</h2>
        <p id="registration-email-help">Aucun compte n’est créé avant sa vérification.</p>
      </div>
      <div className="auth-field">
        <label htmlFor="registration-email">Adresse email</label>
        <input key="registration-email" ref={firstFieldRef} id="registration-email" name="email" type="email" autoComplete="email" required maxLength={320} defaultValue={email} />
      </div>
      {error ? <p className="auth-form__error" id="registration-error" role="alert">{error}</p> : null}
      <button className="auth-submit" type="submit" disabled={pending}><span>{pending ? "Préparation…" : "Recevoir mon code"}</span><span aria-hidden="true">→</span></button>
    </form>
  );
}
