"use client";
import Link from "next/link";
import { useState } from "react";
import { useSiteLanguage } from "@/components/site-language";
import { releaseAlertCopy } from "@/lib/release-notifications/messages";
export function ReleaseUnsubscribeForm({ token }: { token: string }) {
  const { locale } = useSiteLanguage(), copy = releaseAlertCopy(locale);
  const [state, setState] = useState<"idle" | "pending" | "done" | "error">("idle");
  return <div className="auth-card"><h1>{copy.unsubscribe}</h1>
    {state === "done" ? <p role="status">{copy.unsubscribed}</p> : <><p>{copy.privacy}</p><button className="auth-submit" disabled={!token || state === "pending"} onClick={async () => {
      setState("pending"); try { const response = await fetch("/api/release-alerts/unsubscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token }) }); setState(response.ok ? "done" : "error"); } catch { setState("error"); }
    }}>{copy.unsubscribeConfirm}</button></>}
    {!token || state === "error" ? <p role="alert">{copy.invalid}</p> : null}<p><Link href="/compte">{copy.account}</Link></p></div>;
}
