"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { orderOffer } from "@/data/order-offer";
import {
  calculateOrderPrice,
  formatEuro,
  orderTextLimits,
  type OrderDraftInput,
  validateOrderForSubmission,
} from "@/lib/orders/domain";
import type { SerializedOrder, SerializedOrderPhoto } from "@/lib/orders/types";

const musicalDirections = [
  "Rap français",
  "Boom bap",
  "Rap moderne",
  "Pop",
  "Soul / R&B",
  "Rock",
  "Électro",
  "Acoustique",
  "Chanson / variété",
  "Cinématographique",
  "Je laisse LNX Beats choisir",
] as const;

const emptyDraft: OrderDraftInput = {
  title: "",
  recipient: "",
  occasion: "",
  brief: "",
  musicalDirection: "",
  emotion: "",
  importantDetails: "",
  wordsToInclude: "",
  avoid: "",
  pronunciationNotes: "",
  coverIncluded: false,
  priorityProcessing: false,
};

const steps = ["Le repère", "L’histoire", "La création", "Récapitulatif"] as const;

type AccountState = { authenticated: false } | { authenticated: true; name: string };

function draftFromOrder(order: SerializedOrder | null): OrderDraftInput {
  if (!order) return emptyDraft;
  return {
    title: order.title,
    recipient: order.recipient,
    occasion: order.occasion,
    brief: order.brief,
    musicalDirection: order.musicalDirection,
    emotion: order.emotion,
    importantDetails: order.importantDetails,
    wordsToInclude: order.wordsToInclude,
    avoid: order.avoid,
    pronunciationNotes: order.pronunciationNotes,
    coverIncluded: order.coverIncluded,
    priorityProcessing: order.priorityProcessing,
  };
}

async function responsePayload(response: Response) {
  return response.json().catch(() => ({})) as Promise<{ order?: SerializedOrder; error?: string; field?: string }>;
}

export function MusicOrderForm({ account, initialDraft }: { account: AccountState; initialDraft: SerializedOrder | null }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<OrderDraftInput>(() => draftFromOrder(initialDraft));
  const [orderNumber, setOrderNumber] = useState(initialDraft?.orderNumber ?? "");
  const [photos, setPhotos] = useState<SerializedOrderPhoto[]>(initialDraft?.photos ?? []);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [photoRightsConfirmed, setPhotoRightsConfirmed] = useState(false);
  const [summaryConfirmed, setSummaryConfirmed] = useState(false);
  const [contentConfirmed, setContentConfirmed] = useState(false);
  const [saveState, setSaveState] = useState<"saved" | "dirty" | "saving" | "error">(initialDraft ? "saved" : "dirty");
  const [message, setMessage] = useState(initialDraft ? `Brouillon ${initialDraft.orderNumber} repris.` : "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const previousStep = useRef(step);

  const pricing = calculateOrderPrice(form);

  useEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    headingRef.current?.focus();
  }, [step]);

  function setField<K extends keyof OrderDraftInput>(field: K, value: OrderDraftInput[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    setSaveState("dirty");
    setMessage("");
    setError("");
  }

  function validateCurrentStep() {
    if (step === 0 && !form.recipient.trim()) {
      setError("Indiquez à qui ou à quoi cette histoire est destinée.");
      document.getElementById("order-recipient")?.focus();
      return false;
    }
    if (step === 1 && form.brief.trim().length < orderTextLimits.briefMin) {
      setError(`Racontez l’histoire en au moins ${orderTextLimits.briefMin} caractères.`);
      document.getElementById("order-brief")?.focus();
      return false;
    }
    if (step === 2 && !form.musicalDirection) {
      setError("Choisissez une direction musicale ou confiez ce choix à LNX Beats.");
      document.getElementById("order-musical-direction")?.focus();
      return false;
    }
    setError("");
    return true;
  }

  function nextStep() {
    if (!validateCurrentStep()) return;
    setStep((current) => Math.min(current + 1, steps.length - 1));
  }

  async function saveDraft() {
    if (!account.authenticated) {
      setError("Connectez-vous ou créez un compte vérifié avant la première sauvegarde.");
      return null;
    }
    setBusy(true);
    setSaveState("saving");
    setError("");
    try {
      const response = await fetch(orderNumber ? `/api/orders/${encodeURIComponent(orderNumber)}` : "/api/orders/drafts", {
        method: orderNumber ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload = await responsePayload(response);
      if (!response.ok || !payload.order) throw new Error(payload.error ?? "Le brouillon n’a pas pu être enregistré.");
      setOrderNumber(payload.order.orderNumber);
      setPhotos(payload.order.photos);
      setSaveState("saved");
      setMessage(`Enregistré — ${payload.order.orderNumber}`);
      router.refresh();
      return payload.order;
    } catch (caught) {
      setSaveState("error");
      setError(caught instanceof Error ? caught.message : "Le brouillon n’a pas pu être enregistré.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function uploadPhotos() {
    if (!pendingFiles.length) return setError("Choisissez au moins une photo.");
    if (!photoRightsConfirmed) return setError("Confirmez que vous avez le droit de communiquer ces photos.");
    const current = orderNumber ? { orderNumber } : await saveDraft();
    if (!current) return;

    setBusy(true);
    setError("");
    setMessage("Normalisation et enregistrement des photos…");
    try {
      const body = new FormData();
      pendingFiles.forEach((file) => body.append("files", file));
      body.set("rightsConfirmed", "true");
      const response = await fetch(`/api/orders/${encodeURIComponent(current.orderNumber)}/photos`, { method: "POST", body });
      const payload = await responsePayload(response);
      if (!response.ok || !payload.order) throw new Error(payload.error ?? "Les photos n’ont pas pu être ajoutées.");
      setPhotos(payload.order.photos);
      setPendingFiles([]);
      setPhotoRightsConfirmed(false);
      setMessage("Photos privées enregistrées et métadonnées retirées.");
      const input = document.getElementById("order-photos");
      if (input instanceof HTMLInputElement) input.value = "";
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Les photos n’ont pas pu être ajoutées.");
      setMessage("");
    } finally {
      setBusy(false);
    }
  }

  async function removePhoto(assetId: string) {
    if (!orderNumber) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(orderNumber)}/photos/${encodeURIComponent(assetId)}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = await responsePayload(response);
        throw new Error(payload.error ?? "La photo n’a pas pu être supprimée.");
      }
      setPhotos((current) => current.filter((photo) => photo.id !== assetId));
      setMessage("Photo supprimée du brouillon.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "La photo n’a pas pu être supprimée.");
    } finally {
      setBusy(false);
    }
  }

  async function finalize() {
    const validation = validateOrderForSubmission(form);
    if (!validation.ok) {
      setError(validation.message);
      return;
    }
    if (!summaryConfirmed || !contentConfirmed) {
      setError("Confirmez le récapitulatif et les règles de contenu avant de créer la demande.");
      return;
    }
    if (!account.authenticated) {
      setError("Connectez-vous avec un compte vérifié avant de créer la demande.");
      return;
    }
    const current = orderNumber ? { orderNumber } : await saveDraft();
    if (!current) return;

    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(current.orderNumber)}/finalize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const payload = await responsePayload(response);
      if (!response.ok || !payload.order) throw new Error(payload.error ?? "La demande n’a pas pu être créée.");
      router.push(`/compte/commandes/${encodeURIComponent(payload.order.orderNumber)}`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "La demande n’a pas pu être créée.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteDraft() {
    if (!orderNumber || !window.confirm("Supprimer définitivement ce brouillon et ses photos ?")) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(orderNumber)}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = await responsePayload(response);
        throw new Error(payload.error ?? "Le brouillon n’a pas pu être supprimé.");
      }
      setForm(emptyDraft);
      setOrderNumber("");
      setPhotos([]);
      setStep(0);
      setSaveState("dirty");
      setMessage("Brouillon supprimé.");
      router.replace("/commander");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Le brouillon n’a pas pu être supprimé.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="order-form order-form--connected" onSubmit={(event) => event.preventDefault()}>
      <div className="order-progress" aria-label="Progression du brief">
        {steps.map((label, index) => (
          <div key={label} className={`order-progress__item ${index <= step ? "is-active" : ""}`} aria-current={index === step ? "step" : undefined}>
            {String(index + 1).padStart(2, "0")} <span>· {label}</span>
          </div>
        ))}
      </div>

      <div className="order-savebar" aria-live="polite">
        <div>
          <strong>{orderNumber || "Nouveau brief"}</strong>
          <span>{saveState === "saving" ? "Enregistrement…" : saveState === "saved" ? "Enregistré" : saveState === "error" ? "Échec de l’enregistrement" : "Modifications non enregistrées"}</span>
        </div>
        <button type="button" className="form-button" onClick={() => void saveDraft()} disabled={busy}>Enregistrer le brouillon</button>
      </div>

      {!account.authenticated ? (
        <div className="order-auth-note">
          <p><strong>Votre brief reste dans cette page tant qu’il n’est pas sauvegardé.</strong> Pour protéger son contenu, aucune donnée sensible n’est placée dans le stockage du navigateur.</p>
          <p><Link href="/connexion?retour=%2Fcommander">Se connecter</Link> ou <Link href="/inscription">créer un compte</Link> avant la sauvegarde.</p>
        </div>
      ) : <p className="order-auth-note">Connecté en tant que <strong>{account.name}</strong>. Ce brouillon n’est accessible qu’à votre compte.</p>}

      <div className="form-step" key={step}>
        {step === 0 ? (
          <>
            <p className="eyebrow">Étape 1 sur 4</p>
            <h2 ref={headingRef} tabIndex={-1}>Donnez un repère à cette histoire.</h2>
            <p className="form-step__intro">Ce nom vous aidera à retrouver la demande. Il ne devient pas automatiquement le titre du morceau.</p>
            <div className="field">
              <label htmlFor="order-title">Nom de repère <span>(facultatif)</span></label>
              <input id="order-title" maxLength={orderTextLimits.title} value={form.title} placeholder="Anniversaire de Julie" onChange={(event) => setField("title", event.target.value)} />
            </div>
            <div className="field-grid">
              <div className="field">
                <label htmlFor="order-recipient">Personne ou situation concernée *</label>
                <input id="order-recipient" required maxLength={orderTextLimits.recipient} value={form.recipient} onChange={(event) => setField("recipient", event.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="order-occasion">Occasion ou contexte</label>
                <input id="order-occasion" maxLength={orderTextLimits.occasion} value={form.occasion} onChange={(event) => setField("occasion", event.target.value)} />
              </div>
            </div>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <p className="eyebrow">Étape 2 sur 4</p>
            <h2 ref={headingRef} tabIndex={-1}>Racontez ce qui ne doit pas être perdu.</h2>
            <p className="form-step__intro">Le client apporte l’histoire et les intentions. LNX Beats choisit les mots, écrit et construit la création musicale.</p>
            <div className="field">
              <label htmlFor="order-brief">Histoire principale *</label>
              <textarea id="order-brief" required minLength={orderTextLimits.briefMin} maxLength={orderTextLimits.brief} value={form.brief} onChange={(event) => setField("brief", event.target.value)} />
              <span className="field__hint">{form.brief.length.toLocaleString("fr-FR")} / {orderTextLimits.brief.toLocaleString("fr-FR")} caractères · minimum {orderTextLimits.briefMin}</span>
            </div>
            <div className="field">
              <label htmlFor="order-details">Détails importants</label>
              <textarea id="order-details" maxLength={orderTextLimits.importantDetails} value={form.importantDetails} onChange={(event) => setField("importantDetails", event.target.value)} />
            </div>
            <div className="field-grid">
              <div className="field">
                <label htmlFor="order-words">Mots ou expressions à préserver</label>
                <textarea id="order-words" maxLength={orderTextLimits.wordsToInclude} value={form.wordsToInclude} onChange={(event) => setField("wordsToInclude", event.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="order-avoid">Éléments à éviter</label>
                <textarea id="order-avoid" maxLength={orderTextLimits.avoid} value={form.avoid} onChange={(event) => setField("avoid", event.target.value)} />
              </div>
            </div>
            <div className="field">
              <label htmlFor="order-pronunciation">Prononciations ou noms particuliers</label>
              <textarea id="order-pronunciation" maxLength={orderTextLimits.pronunciationNotes} value={form.pronunciationNotes} onChange={(event) => setField("pronunciationNotes", event.target.value)} />
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <p className="eyebrow">Étape 3 sur 4</p>
            <h2 ref={headingRef} tabIndex={-1}>Choisissez la couleur de la création.</h2>
            <p className="form-step__intro">Cette première commande couvre une création à usage personnel. Une extension de droits distincte pourra être demandée depuis votre espace après la livraison.</p>
            <fieldset className="fieldset" id="order-musical-direction" tabIndex={-1}>
              <legend>Direction musicale *</legend>
              <div className="choice-grid">
                {musicalDirections.map((direction) => (
                  <label className="choice" key={direction}>
                    <input type="radio" name="musicalDirection" checked={form.musicalDirection === direction} onChange={() => setField("musicalDirection", direction)} />
                    <span>{direction}</span>
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="field">
              <label htmlFor="order-emotion">Ce que la musique doit faire ressentir</label>
              <input id="order-emotion" maxLength={orderTextLimits.emotion} value={form.emotion} placeholder="Tendre, drôle, nostalgique…" onChange={(event) => setField("emotion", event.target.value)} />
            </div>

            <fieldset className="fieldset">
              <legend>Options</legend>
              <div className="choice-grid">
                <label className="choice">
                  <input type="checkbox" checked={form.coverIncluded} onChange={(event) => setField("coverIncluded", event.target.checked)} />
                  <span><strong>Cover personnalisée +10 €</strong><small>Option commandée, sans génération automatique.</small></span>
                </label>
                <label className="choice">
                  <input type="checkbox" checked={form.priorityProcessing} onChange={(event) => setField("priorityProcessing", event.target.checked)} />
                  <span><strong>Traitement prioritaire +30 €</strong><small>{orderOffer.priorityDelay}</small></span>
                </label>
              </div>
            </fieldset>

            <section className="order-photo-panel" aria-labelledby="order-photo-title">
              <div>
                <p className="auth-panel__label">Photos de référence privées</p>
                <h3 id="order-photo-title">Quelques images, jamais un dossier public.</h3>
                <p>JPEG, PNG ou WebP · 10 Mo maximum par photo · 10 photos maximum. Chaque image est vérifiée, réencodée et débarrassée de ses métadonnées.</p>
              </div>
              <div className="field">
                <label htmlFor="order-photos">Choisir des photos</label>
                <input id="order-photos" type="file" multiple accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" onChange={(event) => setPendingFiles(Array.from(event.target.files ?? []))} />
              </div>
              <label className="choice choice--full">
                <input type="checkbox" checked={photoRightsConfirmed} onChange={(event) => setPhotoRightsConfirmed(event.target.checked)} />
                <span>Je dispose du droit de communiquer ces photos à LNX Beats pour cette demande.</span>
              </label>
              <button type="button" className="form-button" onClick={() => void uploadPhotos()} disabled={busy || !pendingFiles.length}>Ajouter les photos au brouillon</button>
              {photos.length ? (
                <ul className="order-photo-list">
                  {photos.map((photo) => (
                    <li key={photo.id}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/orders/${encodeURIComponent(orderNumber)}/photos/${photo.id}`} alt={`Photo de référence ${photo.position + 1}`} />
                      <span>{photo.width} × {photo.height} · {Math.ceil(photo.sizeBytes / 1024)} Ko</span>
                      <button type="button" onClick={() => void removePhoto(photo.id)} disabled={busy}>Supprimer</button>
                    </li>
                  ))}
                </ul>
              ) : <p className="field__hint">Aucune photo enregistrée.</p>}
            </section>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <p className="eyebrow">Étape 4 sur 4</p>
            <h2 ref={headingRef} tabIndex={-1}>Relisez avant de créer la demande.</h2>
            <dl className="summary order-summary">
              <div><dt>Repère</dt><dd>{form.title || "Sans titre de repère"}</dd></div>
              <div><dt>Histoire pour</dt><dd>{form.recipient}{form.occasion ? ` · ${form.occasion}` : ""}</dd></div>
              <div><dt>Histoire</dt><dd className="summary__long">{form.brief}</dd></div>
              <div><dt>Direction</dt><dd>{form.musicalDirection}</dd></div>
              <div><dt>Usage compris</dt><dd>Personnel</dd></div>
              <div><dt>Options</dt><dd>{[form.coverIncluded ? "Cover" : "", form.priorityProcessing ? "Priorité" : ""].filter(Boolean).join(" · ") || "Aucune"}</dd></div>
              <div><dt>Photos</dt><dd>{photos.length}</dd></div>
              <div><dt>Livraison future</dt><dd>WAV · disponible 6 mois à compter de la livraison</dd></div>
              <div><dt>Retour inclus</dt><dd>1 retour pour corriger un écart avec le brief initial</dd></div>
              <div><dt>Délai indicatif</dt><dd>{orderOffer.indicativeDelay} · point de départ confirmé lors de la prise en charge</dd></div>
            </dl>

            <div className="order-total" aria-live="polite">
              <span>Total de la création</span><strong>{formatEuro(pricing.totalCents)}</strong>
              <small>De 50 € à 90 € avec les options · les droits d’exploitation ne font pas partie de cette commande · paiement non encore disponible.</small>
            </div>

            <label className="choice choice--full">
              <input type="checkbox" checked={summaryConfirmed} onChange={(event) => setSummaryConfirmed(event.target.checked)} />
              <span>J’ai relu le brief. Les droits, l’annulation et le remboursement seront détaillés dans les CGV applicables avant activation du paiement.</span>
            </label>
            <label className="choice choice--full">
              <input type="checkbox" checked={contentConfirmed} onChange={(event) => setContentConfirmed(event.target.checked)} />
              <span>Je comprends que LNX Beats peut refuser une demande illégale, haineuse, diffamatoire, harcelante ou portant atteinte aux droits d’un tiers.</span>
            </label>
            <button className="form-button form-button--primary order-create-button" type="button" onClick={() => void finalize()} disabled={busy || !summaryConfirmed || !contentConfirmed}>Créer ma demande</button>
          </>
        ) : null}

        {error ? <p className="form-message form-message--error" role="alert">{error}</p> : null}
        {message ? <p className="form-message" role="status">{message}</p> : null}

        <div className="form-navigation">
          {step > 0 ? <button className="form-button" type="button" onClick={() => setStep((current) => current - 1)} disabled={busy}>← Étape précédente</button> : <span />}
          {step < steps.length - 1 ? <button className="form-button form-button--primary" type="button" onClick={nextStep} disabled={busy}>Étape suivante →</button> : null}
        </div>
        {orderNumber ? <button className="order-delete-draft" type="button" onClick={() => void deleteDraft()} disabled={busy}>Supprimer ce brouillon</button> : null}
      </div>
    </form>
  );
}
