"use client";
import { useEffect, useState, type FormEvent } from "react";
import { useSiteLanguage } from "@/components/site-language";
import { DEFAULT_RELEASE_ALERT_CHOICES, type ReleaseAlertChoices } from "@/lib/release-notifications/domain";
import { releaseAlertCopy } from "@/lib/release-notifications/messages";

export function ReleaseAlertPreferences() {
  const { locale } = useSiteLanguage(), copy = releaseAlertCopy(locale);
  const [choices, setChoices] = useState<ReleaseAlertChoices>(DEFAULT_RELEASE_ALERT_CHOICES);
  const [loaded, setLoaded] = useState(false), [pending, setPending] = useState(false), [message, setMessage] = useState<"saved" | "error" | null>(null);
  useEffect(() => {
    let active = true;
    void fetch("/api/account/release-alerts", { cache: "no-store" }).then(async response => {
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error();
      if (active) { setChoices(result.preferences); setLoaded(true); }
    }).catch(() => { if (active) setMessage("error"); });
    return () => { active = false; };
  }, []);
  async function save(event: FormEvent) {
    event.preventDefault(); if (!loaded || pending) return; setPending(true); setMessage(null);
    try {
      const response = await fetch("/api/account/release-alerts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...choices, locale }) });
      const result = await response.json(); if (!response.ok || !result.ok) throw new Error();
      setChoices(result.preferences); setMessage("saved");
    } catch { setMessage("error"); } finally { setPending(false); }
  }
  return <section className="account-card" aria-labelledby="release-alert-heading">
    <h2 id="release-alert-heading">{copy.heading}</h2><p>{copy.intro}</p>
    {!loaded && !message ? <p role="status">{copy.loading}</p> : null}
    <form className="auth-form" onSubmit={save}><fieldset disabled={!loaded || pending} style={{ border: 0, padding: 0, display: "grid", gap: "1rem" }}>
      <legend className="sr-only">{copy.heading}</legend>
      {(["music", "shop", "editorial"] as const).map(category => <label key={category} style={{ display: "flex", gap: ".75rem", alignItems: "start" }}><input type="checkbox" checked={choices[category]} onChange={event => setChoices(current => ({ ...current, [category]: event.target.checked }))} /><span>{copy[category]}</span></label>)}
      <p>{copy.privacy}</p><button className="auth-submit auth-submit--secondary" type="submit">{pending ? copy.saving : copy.save}</button>
    </fieldset>{message ? <p className={message === "error" ? "auth-form__error" : "auth-form__success"} role={message === "error" ? "alert" : "status"}>{copy[message]}</p> : null}</form>
  </section>;
}
