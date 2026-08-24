"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { PaymentCheckoutActions } from "@/components/payment-checkout-actions";
import { useOrderJourneyMemory } from "@/components/order-journey-provider";
import { orderOffer } from "@/data/order-offer";
import { personalUseTerms } from "@/data/rights-offer";
import {
  calculateOrderPrice,
  formatEuro,
  orderTextLimits,
  type OrderDraftInput,
  validateOrderForSubmission,
} from "@/lib/orders/domain";
import type { SerializedOrder, SerializedOrderPhoto } from "@/lib/orders/types";
import type { PaymentProviderAvailability } from "@/lib/payments/availability";

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

const steps = ["Projet", "Histoire", "Options", "Références", "Compte", "Récapitulatif & paiement"] as const;
const stepQueryValues = ["projet", "histoire", "options", "references", "compte", "recap"] as const;

type AccountState =
  | { authenticated: false }
  | { authenticated: true; name: string; email: string };

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
    wordsToInclude: "",
    avoid: "",
    pronunciationNotes: "",
    coverIncluded: order.coverIncluded,
    priorityProcessing: order.priorityProcessing,
  };
}

async function responsePayload(response: Response) {
  return response.json().catch(() => ({})) as Promise<{
    order?: SerializedOrder;
    error?: string;
    code?: string;
    field?: string;
  }>;
}

export function MusicOrderForm({
  account,
  initialDraft,
  initialStep = 0,
  paymentProviders,
}: {
  account: AccountState;
  initialDraft: SerializedOrder | null;
  initialStep?: number;
  paymentProviders: PaymentProviderAvailability;
}) {
  const router = useRouter();
  const journey = useOrderJourneyMemory();
  const remembered = journey.memory;
  const [step, setStep] = useState(() => Math.min(Math.max(remembered?.step ?? initialStep, 0), steps.length - 1));
  const [form, setForm] = useState<OrderDraftInput>(() => remembered?.form ?? draftFromOrder(initialDraft));
  const [orderNumber, setOrderNumber] = useState(initialDraft?.orderNumber ?? "");
  const [orderStatus, setOrderStatus] = useState<SerializedOrder["status"] | null>(initialDraft?.status ?? null);
  const [photos, setPhotos] = useState<SerializedOrderPhoto[]>(initialDraft?.photos ?? []);
  const [pendingFiles, setPendingFiles] = useState<File[]>(() => remembered?.pendingFiles ?? []);
  const [photoRightsConfirmed, setPhotoRightsConfirmed] = useState(remembered?.photoRightsConfirmed ?? false);
  const [summaryConfirmed, setSummaryConfirmed] = useState(false);
  const [contentConfirmed, setContentConfirmed] = useState(false);
  const [personalUseTermsConfirmed, setPersonalUseTermsConfirmed] = useState(false);
  const [finalizedOrder, setFinalizedOrder] = useState<SerializedOrder | null>(null);
  const [saveState, setSaveState] = useState<"saved" | "dirty" | "saving" | "error">(initialDraft ? "saved" : "dirty");
  const [message, setMessage] = useState(remembered ? "Votre brief et vos références ont été restaurés après la connexion." : initialDraft ? `Commande ${initialDraft.orderNumber} reprise.` : "");
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
    setFinalizedOrder(null);
    setSaveState("dirty");
    setMessage("");
    setError("");
  }

  function preserveAndNavigate(destination: "/connexion" | "/inscription") {
    journey.preserve({
      form,
      step: 4,
      pendingFiles,
      photoRightsConfirmed,
    });
    const returnTo = "/commander?reprendre=1&etape=compte";
    router.push(`${destination}?retour=${encodeURIComponent(returnTo)}`);
  }

  function moveToStep(next: number, persistedOrderNumber = orderNumber) {
    const bounded = Math.min(Math.max(next, 0), steps.length - 1);
    setStep(bounded);
    if (persistedOrderNumber) {
      router.replace(
        `/commander?brouillon=${encodeURIComponent(persistedOrderNumber)}&etape=${stepQueryValues[bounded]}`,
        { scroll: false },
      );
    }
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
    if (step === 3 && pendingFiles.length && !photoRightsConfirmed) {
      setError("Confirmez que vous avez le droit de communiquer les photos sélectionnées.");
      return false;
    }
    if (step === 4 && !account.authenticated) {
      setError("Connectez-vous ou créez un compte vérifié pour conserver et payer cette commande.");
      return false;
    }
    setError("");
    return true;
  }

  async function nextStep() {
    if (!validateCurrentStep()) return;
    let persistedOrderNumber = orderNumber;
    if (step === 4 && account.authenticated) {
      const saved = await saveDraft();
      if (!saved) return;
      persistedOrderNumber = saved.orderNumber;
      if (pendingFiles.length) {
        const uploaded = await uploadPhotos(saved.orderNumber);
        if (!uploaded) return;
      }
    }
    moveToStep(step + 1, persistedOrderNumber);
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
      setOrderStatus(payload.order.status);
      setPhotos(payload.order.photos);
      setSaveState("saved");
      setMessage(`Enregistré — ${payload.order.orderNumber}`);
      journey.clear();
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

  async function uploadPhotos(targetOrderNumber?: string) {
    if (!pendingFiles.length) {
      setError("Choisissez au moins une photo.");
      return null;
    }
    if (!photoRightsConfirmed) {
      setError("Confirmez que vous avez le droit de communiquer ces photos.");
      return null;
    }
    const current = targetOrderNumber ? { orderNumber: targetOrderNumber } : orderNumber ? { orderNumber } : await saveDraft();
    if (!current) return null;

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
      return payload.order;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Les photos n’ont pas pu être ajoutées.");
      setMessage("");
      return null;
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
      setMessage("Photo supprimée de la commande.");
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
    if (!summaryConfirmed || !contentConfirmed || !personalUseTermsConfirmed) {
      setError("Confirmez le récapitulatif, l’usage personnel et les règles de contenu avant de continuer.");
      return;
    }
    if (!account.authenticated) {
      setError("Connectez-vous avec un compte vérifié avant de créer la commande.");
      return;
    }
    const current = orderNumber ? { orderNumber } : await saveDraft();
    if (!current) return;
    if (pendingFiles.length) {
      const uploaded = await uploadPhotos(current.orderNumber);
      if (!uploaded) return;
    }
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(current.orderNumber)}/finalize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, personalUseTermsAccepted: true }),
      });
      const payload = await responsePayload(response);
      if (!response.ok || !payload.order) throw new Error(payload.error ?? "La commande n’a pas pu être préparée.");
      setOrderNumber(payload.order.orderNumber);
      setOrderStatus(payload.order.status);
      setFinalizedOrder(payload.order);
      setSaveState("saved");
      setMessage("Commande enregistrée. Le paiement sécurisé peut maintenant être ouvert.");
      journey.clear();
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "La commande n’a pas pu être préparée.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteDraft() {
    if (!orderNumber || orderStatus !== "DRAFT" || !window.confirm("Supprimer définitivement ce brouillon et ses références privées ?")) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(orderNumber)}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = await responsePayload(response);
        throw new Error(payload.error ?? "Le brouillon n’a pas pu être supprimé.");
      }
      setForm(emptyDraft);
      setOrderNumber("");
      setOrderStatus(null);
      setPhotos([]);
      setPendingFiles([]);
      setStep(0);
      setSaveState("dirty");
      setMessage("Brouillon supprimé.");
      journey.clear();
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
      <div className="order-progress" aria-label="Progression de la commande">
        {steps.map((label, index) => (
          <button
            key={label}
            type="button"
            className={`order-progress__item ${index <= step ? "is-active" : ""}`}
            aria-current={index === step ? "step" : undefined}
            onClick={() => { if (index < step) moveToStep(index); }}
            disabled={busy || index > step}
          >
            {String(index + 1).padStart(2, "0")} <span>· {label}</span>
          </button>
        ))}
      </div>

      <div className="order-savebar" aria-live="polite">
        <div>
          <strong>{orderNumber || "Nouvelle commande"}</strong>
          <span>{saveState === "saving" ? "Enregistrement…" : saveState === "saved" ? "Enregistrée" : saveState === "error" ? "Échec de l’enregistrement" : "Modifications en mémoire"}</span>
        </div>
        {account.authenticated && !finalizedOrder ? <button type="button" className="form-button" onClick={() => void saveDraft()} disabled={busy}>Enregistrer</button> : null}
      </div>

      <div className="form-step" key={step}>
        {step === 0 ? (
          <>
            <p className="eyebrow">Étape 1 sur 6</p>
            <h2 ref={headingRef} tabIndex={-1}>Donnez un repère à cette histoire.</h2>
            <p className="form-step__intro">Ce nom vous aidera à retrouver la commande. Il ne devient pas automatiquement le titre du morceau.</p>
            <div className="field">
              <label htmlFor="order-title">Nom du projet <span>(facultatif)</span></label>
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
            <p className="eyebrow">Étape 2 sur 6</p>
            <h2 ref={headingRef} tabIndex={-1}>Racontez ce qui ne doit pas être perdu.</h2>
            <p className="form-step__intro">Vous apportez l’histoire et les intentions. LNX Beats choisit les mots, écrit et construit la création musicale.</p>
            <div className="field">
              <label htmlFor="order-brief">Histoire principale *</label>
              <textarea id="order-brief" required minLength={orderTextLimits.briefMin} maxLength={orderTextLimits.brief} value={form.brief} onChange={(event) => setField("brief", event.target.value)} />
              <span className="field__hint">{form.brief.length.toLocaleString("fr-FR")} / {orderTextLimits.brief.toLocaleString("fr-FR")} caractères · minimum {orderTextLimits.briefMin}</span>
            </div>
            <div className="field">
              <label htmlFor="order-details">Détails importants</label>
              <textarea id="order-details" maxLength={orderTextLimits.importantDetails} value={form.importantDetails} onChange={(event) => setField("importantDetails", event.target.value)} />
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <p className="eyebrow">Étape 3 sur 6</p>
            <h2 ref={headingRef} tabIndex={-1}>Choisissez la couleur et les options.</h2>
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
            <div className="order-total order-total--compact"><span>Total actualisé</span><strong>{formatEuro(pricing.totalCents)}</strong><small>Calculé côté serveur au moment de l’enregistrement.</small></div>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <p className="eyebrow">Étape 4 sur 6</p>
            <h2 ref={headingRef} tabIndex={-1}>Ajoutez vos références privées.</h2>
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
                <span>Je dispose du droit de communiquer ces photos à LNX Beats pour cette commande.</span>
              </label>
              {account.authenticated ? <button type="button" className="form-button" onClick={() => void uploadPhotos()} disabled={busy || !pendingFiles.length}>Enregistrer les photos</button> : <p className="field__hint">Les photos sélectionnées restent uniquement en mémoire jusqu’à votre connexion.</p>}
              {pendingFiles.length ? <p className="field__hint" role="status">{pendingFiles.length} photo{pendingFiles.length === 1 ? "" : "s"} sélectionnée{pendingFiles.length === 1 ? "" : "s"}.</p> : null}
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
              ) : <p className="field__hint">Aucune photo enregistrée. Cette étape reste facultative.</p>}
            </section>
          </>
        ) : null}

        {step === 4 ? (
          <>
            <p className="eyebrow">Étape 5 sur 6</p>
            <h2 ref={headingRef} tabIndex={-1}>{account.authenticated ? "Votre compte vérifié est prêt." : "Protégez votre brief avant le paiement."}</h2>
            {account.authenticated ? (
              <div className="order-auth-note order-auth-note--verified">
                <p><strong>{account.name}</strong></p><p>{account.email}</p>
                <p>Cette commande, ses références privées et son paiement seront rattachés uniquement à ce compte.</p>
              </div>
            ) : (
              <div className="order-auth-note">
                <p><strong>Votre brief et vos photos sélectionnées restent en mémoire pendant ce parcours de connexion.</strong></p>
                <p>Aucune histoire, référence privée ou donnée sensible n’est placée dans l’URL, le localStorage ou le sessionStorage.</p>
                <div className="order-auth-actions">
                  <button className="form-button form-button--primary" type="button" onClick={() => preserveAndNavigate("/connexion")}>Me connecter</button>
                  <button className="form-button" type="button" onClick={() => preserveAndNavigate("/inscription")}>Créer mon compte</button>
                </div>
              </div>
            )}
          </>
        ) : null}

        {step === 5 ? (
          <>
            <p className="eyebrow">Étape 6 sur 6</p>
            <h2 ref={headingRef} tabIndex={-1}>{finalizedOrder ? "Votre commande est prête à être payée." : "Relisez avant le paiement."}</h2>
            <dl className="summary order-summary">
              <div><dt>Projet</dt><dd>{form.title || "Sans titre de repère"}</dd></div>
              <div><dt>Histoire pour</dt><dd>{form.recipient}{form.occasion ? ` · ${form.occasion}` : ""}</dd></div>
              <div><dt>Histoire</dt><dd className="summary__long">{form.brief}</dd></div>
              {form.importantDetails ? <div><dt>Détails importants</dt><dd className="summary__long">{form.importantDetails}</dd></div> : null}
              <div><dt>Direction</dt><dd>{form.musicalDirection}{form.emotion ? ` · ${form.emotion}` : ""}</dd></div>
              <div><dt>Usage compris</dt><dd>Personnel</dd></div>
              <div><dt>Options</dt><dd>{[form.coverIncluded ? "Cover +10 €" : "", form.priorityProcessing ? "Priorité +30 €" : ""].filter(Boolean).join(" · ") || "Aucune"}</dd></div>
              <div><dt>Photos privées</dt><dd>{photos.length + pendingFiles.length}{pendingFiles.length ? " sélectionnée(s), en attente d’enregistrement" : " enregistrée(s)"}</dd></div>
              <div><dt>Compte</dt><dd>{account.authenticated ? `${account.name} · ${account.email}` : "Connexion requise"}</dd></div>
              <div><dt>Délai indicatif</dt><dd>{orderOffer.indicativeDelay}</dd></div>
            </dl>
            <div className="order-total" aria-live="polite">
              <span>Total de la création</span><strong>{formatEuro(pricing.totalCents)}</strong>
              <small>Base 50 €{form.coverIncluded ? " + cover 10 €" : ""}{form.priorityProcessing ? " + priorité 30 €" : ""} · aucun montant n’est accepté depuis le navigateur.</small>
            </div>

            {!finalizedOrder ? (
              <>
                <label className="choice choice--full">
                  <input type="checkbox" checked={summaryConfirmed} onChange={(event) => setSummaryConfirmed(event.target.checked)} />
                  <span>J’ai relu le brief, les options et le total de cette commande.</span>
                </label>
                <label className="choice choice--full">
                  <input type="checkbox" checked={contentConfirmed} onChange={(event) => setContentConfirmed(event.target.checked)} />
                  <span>Je comprends que LNX Beats peut refuser une demande illégale, haineuse, diffamatoire, harcelante ou portant atteinte aux droits d’un tiers.</span>
                </label>
                <label className="choice choice--full">
                  <input type="checkbox" checked={personalUseTermsConfirmed} onChange={(event) => setPersonalUseTermsConfirmed(event.target.checked)} />
                  <span><strong>Usage personnel.</strong> {personalUseTerms.text}</span>
                </label>
                <button className="form-button form-button--primary order-create-button" type="button" onClick={() => void finalize()} disabled={busy || !summaryConfirmed || !contentConfirmed || !personalUseTermsConfirmed}>Enregistrer et passer au paiement</button>
              </>
            ) : paymentProviders.stripe || paymentProviders.paypal ? (
              <div className="order-checkout-panel">
                <p>Vous allez quitter temporairement LNX Studio pour le prestataire de paiement choisi. Le retour navigateur ne confirme jamais seul le paiement.</p>
                <PaymentCheckoutActions orderNumber={finalizedOrder.orderNumber} amountCents={finalizedOrder.totalCents} providers={paymentProviders} />
              </div>
            ) : (
              <div className="order-checkout-panel"><p><strong>Commande enregistrée.</strong> Les paiements sont fermés dans cet environnement. Retrouvez la commande dans votre espace sans perdre le brief.</p><Link className="form-button" href={`/compte/commandes/${encodeURIComponent(finalizedOrder.orderNumber)}`}>Voir ma commande</Link></div>
            )}
          </>
        ) : null}

        {error ? <p className="form-message form-message--error" role="alert">{error}</p> : null}
        {message ? <p className="form-message" role="status">{message}</p> : null}

        <div className="form-navigation">
          {step > 0 && !finalizedOrder ? <button className="form-button" type="button" onClick={() => moveToStep(step - 1)} disabled={busy}>← Étape précédente</button> : <span />}
          {step < steps.length - 1 ? <button className="form-button form-button--primary" type="button" onClick={() => void nextStep()} disabled={busy}>Étape suivante →</button> : null}
        </div>
        {orderNumber && orderStatus === "DRAFT" ? <button className="order-delete-draft" type="button" onClick={() => void deleteDraft()} disabled={busy}>Supprimer ce brouillon</button> : null}
      </div>
    </form>
  );
}
