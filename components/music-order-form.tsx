"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { PaymentCheckoutActions } from "@/components/payment-checkout-actions";
import { useOrderJourneyMemory } from "@/components/order-journey-provider";
import {
  orderIllustrationFormatLabel,
  orderIllustrationFormatOptions,
} from "@/data/order-illustration";
import { orderOffer, orderPricingForVersion } from "@/data/order-offer";
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
  illustrationFormat: null,
  illustrationFormatCustom: "",
  coverIncluded: false,
  priorityProcessing: false,
};

const steps = ["Projet", "Histoire", "Options", "Références", "Compte", "Récapitulatif & paiement"] as const;
const stepQueryValues = ["projet", "histoire", "options", "references", "compte", "recap"] as const;

type AccountState =
  | { authenticated: false }
  | { authenticated: true; name: string; email: string };

type OrderErrorField = keyof OrderDraftInput | "photoRights" | "account" | "confirmations";

const errorFieldElementIds: Partial<Record<OrderErrorField, string>> = {
  recipient: "order-recipient",
  brief: "order-brief",
  musicalDirection: "order-musical-direction",
  illustrationFormat: "order-illustration-format",
  illustrationFormatCustom: "order-illustration-format-custom",
  photoRights: "order-photo-rights",
  account: "order-auth-panel",
};

const errorFieldSteps: Partial<Record<OrderErrorField, number>> = {
  recipient: 0,
  brief: 1,
  musicalDirection: 2,
  illustrationFormat: 2,
  illustrationFormatCustom: 2,
  photoRights: 3,
  account: 4,
  confirmations: 5,
};

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
    illustrationFormat: order.illustrationFormat,
    illustrationFormatCustom: order.illustrationFormatCustom,
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
  resumeJourney = false,
}: {
  account: AccountState;
  initialDraft: SerializedOrder | null;
  initialStep?: number;
  paymentProviders: PaymentProviderAvailability;
  resumeJourney?: boolean;
}) {
  const router = useRouter();
  const journey = useOrderJourneyMemory();
  const remembered = journey.memory;
  const restoringJourney = resumeJourney && remembered !== null;
  const persistedDraft = restoringJourney ? null : initialDraft;
  const [step, setStep] = useState(() => Math.min(Math.max(restoringJourney ? remembered.step : initialStep, 0), steps.length - 1));
  const [form, setForm] = useState<OrderDraftInput>(() => restoringJourney ? remembered.form : draftFromOrder(persistedDraft));
  const [allowLegacyMissingIllustrationFormat, setAllowLegacyMissingIllustrationFormat] = useState(
    Boolean(persistedDraft?.coverIncluded && !persistedDraft.illustrationFormat),
  );
  const [orderNumber, setOrderNumber] = useState(persistedDraft?.orderNumber ?? "");
  const [orderStatus, setOrderStatus] = useState<SerializedOrder["status"] | null>(persistedDraft?.status ?? null);
  const [photos, setPhotos] = useState<SerializedOrderPhoto[]>(persistedDraft?.photos ?? []);
  const [pendingFiles, setPendingFiles] = useState<File[]>(() => restoringJourney ? remembered.pendingFiles : []);
  const [photoRightsConfirmed, setPhotoRightsConfirmed] = useState(restoringJourney ? remembered.photoRightsConfirmed : false);
  const [summaryConfirmed, setSummaryConfirmed] = useState(false);
  const [contentConfirmed, setContentConfirmed] = useState(false);
  const [personalUseTermsConfirmed, setPersonalUseTermsConfirmed] = useState(false);
  const [finalizedOrder, setFinalizedOrder] = useState<SerializedOrder | null>(null);
  const [activePricingVersion, setActivePricingVersion] = useState(
    persistedDraft?.pricingVersion ?? orderOffer.pricingVersion,
  );
  const [saveState, setSaveState] = useState<"idle" | "saved" | "dirty" | "saving" | "error">(restoringJourney ? "dirty" : "idle");
  const [message, setMessage] = useState(restoringJourney ? "Votre brief et vos références ont été restaurés après la connexion." : persistedDraft ? `Commande ${persistedDraft.orderNumber} reprise.` : "");
  const [error, setError] = useState("");
  const [errorField, setErrorField] = useState<OrderErrorField | null>(null);
  const [busy, setBusy] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const photoRightsRef = useRef<HTMLInputElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const previousStep = useRef(step);
  const pricing = calculateOrderPrice(form, activePricingVersion);
  const pricingConfiguration = orderPricingForVersion(activePricingVersion) ?? orderOffer;
  const maximumPriceCents = pricingConfiguration.personalBaseCents
    + pricingConfiguration.coverCents
    + pricingConfiguration.priorityCents;
  const hasPaymentProvider = paymentProviders.stripe || paymentProviders.paypal;
  const errorBelongsToCurrentStep = errorField !== null && errorFieldSteps[errorField] === step;
  const liveSummaryContent = (
    <div className="order-aside__content">
      <p className="eyebrow">Récapitulatif en temps réel</p>
      <dl className="order-aside__summary">
        <div><dt>Création personnelle</dt><dd>{formatEuro(pricing.basePriceCents)}</dd></div>
        <div><dt>Illustration personnalisée</dt><dd>{form.coverIncluded ? `+ ${formatEuro(pricing.coverPriceCents)}` : "Non sélectionnée"}</dd></div>
        {form.coverIncluded && form.illustrationFormat ? <div><dt>Format</dt><dd>{orderIllustrationFormatLabel(form.illustrationFormat)}</dd></div> : null}
        <div><dt>Traitement prioritaire</dt><dd>{form.priorityProcessing ? `+ ${formatEuro(pricing.priorityPriceCents)}` : "Non sélectionné"}</dd></div>
      </dl>
      <div className="order-aside__total"><span>Total actualisé</span><strong>{formatEuro(pricing.totalCents)}</strong></div>
      <p className="order-aside__maximum">Total maximum : {formatEuro(maximumPriceCents)}</p>
      <div className="order-aside__assurance">
        <strong>{hasPaymentProvider ? "Paiement sécurisé" : "Données protégées"}</strong>
        <span>{hasPaymentProvider ? "Votre brief et vos références restent protégés." : "Aucun paiement n’est proposé tant qu’aucun moyen sécurisé n’est disponible."}</span>
      </div>
    </div>
  );

  useEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    headingRef.current?.focus();
    const progress = progressRef.current;
    const activeItem = progress?.querySelector<HTMLElement>('[data-state="current"]');
    if (progress && activeItem && window.matchMedia("(max-width: 600px)").matches) {
      progress.scrollTo({
        left: Math.max(0, activeItem.offsetLeft - ((progress.clientWidth - activeItem.clientWidth) / 2)),
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
    }
  }, [step]);

  useEffect(() => {
    if (!errorField) return;
    const elementId = errorFieldElementIds[errorField];
    if (!elementId) return;
    const frame = window.requestAnimationFrame(() => document.getElementById(elementId)?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [errorField, step]);

  function setField<K extends keyof OrderDraftInput>(field: K, value: OrderDraftInput[K]) {
    setForm((current) => ({ ...current, [field]: value }));
    if (field === "illustrationFormat" || field === "illustrationFormatCustom") {
      setAllowLegacyMissingIllustrationFormat(false);
    }
    setFinalizedOrder(null);
    setSaveState("dirty");
    setMessage("");
    setError("");
    setErrorField(null);
  }

  function setIllustrationEnabled(enabled: boolean) {
    setForm((current) => ({
      ...current,
      coverIncluded: enabled,
      illustrationFormat: enabled ? current.illustrationFormat : null,
      illustrationFormatCustom: enabled ? current.illustrationFormatCustom : "",
    }));
    setAllowLegacyMissingIllustrationFormat(false);
    setFinalizedOrder(null);
    setSaveState("dirty");
    setMessage("");
    setError("");
    setErrorField(null);
  }

  function setIllustrationFormat(value: OrderDraftInput["illustrationFormat"]) {
    setForm((current) => ({
      ...current,
      illustrationFormat: value,
      illustrationFormatCustom: value === "CUSTOM" ? current.illustrationFormatCustom : "",
    }));
    setAllowLegacyMissingIllustrationFormat(false);
    setFinalizedOrder(null);
    setSaveState("dirty");
    setMessage("");
    setError("");
    setErrorField(null);
  }

  function showFieldError(
    field: OrderErrorField,
    message: string,
  ) {
    setError(message);
    setErrorField(field);
    return false;
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
      return showFieldError("recipient", "Indiquez à qui ou à quoi cette histoire est destinée.");
    }
    if (step === 1 && form.brief.trim().length < orderTextLimits.briefMin) {
      return showFieldError("brief", `Racontez l’histoire en au moins ${orderTextLimits.briefMin} caractères.`);
    }
    if (step === 2 && !form.musicalDirection) {
      return showFieldError("musicalDirection", "Choisissez une direction musicale ou confiez ce choix à LNX Beats.");
    }
    if (step === 2 && form.coverIncluded && !form.illustrationFormat && !allowLegacyMissingIllustrationFormat) {
      return showFieldError("illustrationFormat", "Choisissez le format de l’illustration personnalisée.");
    }
    if (step === 2 && form.coverIncluded && form.illustrationFormat === "CUSTOM" && !form.illustrationFormatCustom.trim()) {
      return showFieldError("illustrationFormatCustom", "Précisez le format personnalisé attendu.");
    }
    if (step === 3 && pendingFiles.length && !photoRightsConfirmed) {
      setError("Confirmez que vous avez le droit de communiquer les photos sélectionnées.");
      setErrorField("photoRights");
      return false;
    }
    if (step === 4 && !account.authenticated) {
      setError("Connectez-vous ou créez un compte vérifié pour conserver et payer cette commande.");
      setErrorField("account");
      return false;
    }
    setError("");
    setErrorField(null);
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
      setForm(draftFromOrder(payload.order));
      setAllowLegacyMissingIllustrationFormat(Boolean(payload.order.coverIncluded && !payload.order.illustrationFormat));
      setOrderNumber(payload.order.orderNumber);
      setOrderStatus(payload.order.status);
      setActivePricingVersion(payload.order.pricingVersion);
      setPhotos(payload.order.photos);
      setSaveState("saved");
      setMessage("");
      journey.clear();
      router.refresh();
      return payload.order;
    } catch (caught) {
      setSaveState("error");
      setErrorField(null);
      setError(caught instanceof Error ? caught.message : "Le brouillon n’a pas pu être enregistré.");
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function uploadPhotos(targetOrderNumber?: string) {
    if (!pendingFiles.length) {
      setErrorField(null);
      setError("Choisissez au moins une photo.");
      return null;
    }
    if (!photoRightsConfirmed) {
      showFieldError("photoRights", "Confirmez que vous avez le droit de communiquer ces photos.");
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
      setErrorField(null);
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
      setErrorField(null);
      setError(caught instanceof Error ? caught.message : "La photo n’a pas pu être supprimée.");
    } finally {
      setBusy(false);
    }
  }

  async function finalize() {
    const validation = validateOrderForSubmission(form, { allowLegacyMissingIllustrationFormat });
    if (!validation.ok) {
      setError(validation.message);
      setErrorField(validation.field);
      const targetStep = errorFieldSteps[validation.field];
      if (targetStep !== undefined && targetStep !== step) moveToStep(targetStep);
      return;
    }
    if (!summaryConfirmed || !contentConfirmed || !personalUseTermsConfirmed) {
      setError("Confirmez le récapitulatif, l’usage personnel et les règles de contenu avant de continuer.");
      setErrorField("confirmations");
      const firstMissing = !summaryConfirmed
        ? "order-summary-confirmed"
        : !contentConfirmed
          ? "order-content-confirmed"
          : "order-personal-use-confirmed";
      document.getElementById(firstMissing)?.focus();
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
    setErrorField(null);
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(current.orderNumber)}/finalize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...form, personalUseTermsAccepted: true }),
      });
      const payload = await responsePayload(response);
      if (!response.ok || !payload.order) throw new Error(payload.error ?? "La commande n’a pas pu être préparée.");
      setForm(draftFromOrder(payload.order));
      setAllowLegacyMissingIllustrationFormat(Boolean(payload.order.coverIncluded && !payload.order.illustrationFormat));
      setOrderNumber(payload.order.orderNumber);
      setOrderStatus(payload.order.status);
      setActivePricingVersion(payload.order.pricingVersion);
      setFinalizedOrder(payload.order);
      setSaveState("saved");
      setMessage(hasPaymentProvider
        ? "Commande enregistrée. Vous pouvez maintenant choisir votre moyen de paiement."
        : "Commande enregistrée. Elle reste disponible dans votre espace.");
      journey.clear();
      router.refresh();
    } catch (caught) {
      setErrorField(null);
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
      setActivePricingVersion(orderOffer.pricingVersion);
      setAllowLegacyMissingIllustrationFormat(false);
      setPhotos([]);
      setPendingFiles([]);
      setStep(0);
      setSaveState("idle");
      setMessage("Brouillon supprimé.");
      journey.clear();
      router.replace("/commander");
      router.refresh();
    } catch (caught) {
      setErrorField(null);
      setError(caught instanceof Error ? caught.message : "Le brouillon n’a pas pu être supprimé.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
    <aside className="order-aside order-aside--live" aria-label="Récapitulatif de la création">
      <div className="order-aside__desktop">{liveSummaryContent}</div>
      <details className="order-aside__disclosure order-aside__mobile">
        <summary><span>Repères du projet</span><strong>{formatEuro(pricing.totalCents)}</strong></summary>
        {liveSummaryContent}
      </details>
    </aside>
    <form className="order-form order-form--connected order-form--premium" aria-busy={busy} onSubmit={(event) => event.preventDefault()}>
      <nav className="order-progress-shell" aria-label="Étapes de la commande">
        <p className="order-progress__summary" aria-live="polite">
          <span>Étape {step + 1} sur {steps.length}</span>
          <strong>{steps[step]}</strong>
          <progress max={steps.length} value={step + 1} aria-label={`Progression : étape ${step + 1} sur ${steps.length}`} />
        </p>
        <div className="order-progress" ref={progressRef}>
        {steps.map((label, index) => (
          <button
            key={label}
            type="button"
            className="order-progress__item"
            data-state={index < step ? "complete" : index === step ? "current" : "future"}
            aria-current={index === step ? "step" : undefined}
            aria-label={index < step ? `Revenir à l’étape ${index + 1} : ${label}` : `Étape ${index + 1} : ${label}`}
            onClick={() => { if (index < step) moveToStep(index); }}
            disabled={busy || Boolean(finalizedOrder) || index >= step}
          >
            <span className="order-progress__number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
            <span className="order-progress__label">{label}</span>
          </button>
        ))}
        </div>
      </nav>

      {account.authenticated && !finalizedOrder && saveState !== "idle" ? (
        <div className="order-save-status" aria-live="polite">
          <span>{saveState === "saving"
            ? "Enregistrement du brouillon…"
            : saveState === "saved"
              ? orderStatus === "AWAITING_PAYMENT" ? "Commande enregistrée" : "Brouillon enregistré"
              : saveState === "error"
                ? "Enregistrement interrompu"
                : "Modifications non enregistrées"}</span>
          {saveState === "dirty" || saveState === "error" ? (
            <button type="button" className="order-save-status__action" onClick={() => void saveDraft()} disabled={busy}>
              {orderStatus === "AWAITING_PAYMENT" ? "Enregistrer les modifications" : "Enregistrer le brouillon"}
            </button>
          ) : null}
        </div>
      ) : null}

      <fieldset className="form-step" disabled={busy} key={step}>
        {step === 0 ? (
          <>
            <header className="order-step-heading">
              <span className="order-step-heading__index" aria-hidden="true">01</span>
              <div>
                <p className="eyebrow">Le projet</p>
                <h2 ref={headingRef} tabIndex={-1}>Donnons un premier repère à votre création.</h2>
                <p className="form-step__intro">Quelques informations suffisent pour commencer. Le nom du projet vous aidera à retrouver la commande, sans devenir automatiquement le titre du morceau.</p>
              </div>
            </header>
            <div className="field">
              <label htmlFor="order-title">Nom du projet <span>(facultatif)</span></label>
              <input id="order-title" maxLength={orderTextLimits.title} value={form.title} placeholder="Ex. Une chanson pour nos vingt ans" onChange={(event) => setField("title", event.target.value)} />
              <span className="field__hint">Un repère privé visible dans votre compte et dans l’espace Admin.</span>
            </div>
            <div className="field-grid">
              <div className="field">
                <label htmlFor="order-recipient">Personne ou situation concernée *</label>
                <input id="order-recipient" required aria-invalid={errorField === "recipient"} aria-describedby={errorField === "recipient" ? "order-recipient-error" : "order-recipient-hint"} maxLength={orderTextLimits.recipient} value={form.recipient} placeholder="Ex. Camille, notre famille, un nouveau départ…" onChange={(event) => setField("recipient", event.target.value)} />
                <span className="field__hint" id="order-recipient-hint">À qui — ou à quoi — cette histoire est-elle destinée ?</span>
                {errorField === "recipient" ? <span className="field__error" id="order-recipient-error" role="alert">{error}</span> : null}
              </div>
              <div className="field">
                <label htmlFor="order-occasion">Occasion ou contexte</label>
                <input id="order-occasion" maxLength={orderTextLimits.occasion} value={form.occasion} placeholder="Ex. Anniversaire, mariage, souvenir…" onChange={(event) => setField("occasion", event.target.value)} />
                <span className="field__hint">Facultatif, mais utile pour ajuster l’intention.</span>
              </div>
            </div>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <header className="order-step-heading">
              <span className="order-step-heading__index" aria-hidden="true">02</span>
              <div>
                <p className="eyebrow">Votre histoire</p>
                <h2 ref={headingRef} tabIndex={-1}>Racontez ce qui ne doit pas être perdu.</h2>
                <p className="form-step__intro">Écrivez naturellement, comme si vous me racontiez l’histoire. Vous apportez les souvenirs et l’intention ; LNX Beats choisit les mots et construit la création musicale.</p>
              </div>
            </header>
            <div className="order-story-panel order-story-panel--primary">
              <div className="field">
                <label htmlFor="order-brief">Histoire principale *</label>
                <textarea className="order-story-textarea" id="order-brief" required aria-invalid={errorField === "brief"} aria-describedby={errorField === "brief" ? "order-brief-counter order-brief-error" : "order-brief-counter"} minLength={orderTextLimits.briefMin} maxLength={orderTextLimits.brief} value={form.brief} placeholder="Les moments importants, les traits de caractère, les souvenirs, les mots que vous aimeriez transmettre…" onChange={(event) => setField("brief", event.target.value)} />
                <span className="field__counter" id="order-brief-counter" data-invalid={form.brief.length > 0 && form.brief.trim().length < orderTextLimits.briefMin}>
                  {form.brief.length.toLocaleString("fr-FR")} / {orderTextLimits.brief.toLocaleString("fr-FR")} · minimum {orderTextLimits.briefMin} caractères
                </span>
                {errorField === "brief" ? <span className="field__error" id="order-brief-error" role="alert">{error}</span> : null}
              </div>
            </div>
            <div className="order-story-panel order-story-panel--secondary">
              <div className="field">
                <label htmlFor="order-details">Détails à préserver <span>(facultatif)</span></label>
                <textarea id="order-details" aria-describedby="order-details-counter" maxLength={orderTextLimits.importantDetails} value={form.importantDetails} placeholder="Une date, une phrase, un lieu, une anecdote ou un détail de prononciation…" onChange={(event) => setField("importantDetails", event.target.value)} />
                <span className="field__counter" id="order-details-counter">{form.importantDetails.length.toLocaleString("fr-FR")} / {orderTextLimits.importantDetails.toLocaleString("fr-FR")}</span>
              </div>
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <header className="order-step-heading">
              <span className="order-step-heading__index" aria-hidden="true">03</span>
              <div>
                <p className="eyebrow">Direction & options</p>
                <h2 ref={headingRef} tabIndex={-1}>Choisissez la couleur et les options.</h2>
                <p className="form-step__intro">Indiquez une direction, une émotion et les options utiles. Le total reste lisible à chaque décision.</p>
              </div>
            </header>
            <fieldset className="fieldset order-direction-fieldset" id="order-musical-direction" tabIndex={-1} aria-invalid={errorField === "musicalDirection"} aria-describedby={errorField === "musicalDirection" ? "order-musical-direction-error" : undefined}>
              <legend>Direction musicale *</legend>
              <p className="fieldset__intro">Choisissez un univers ou laissez LNX Beats décider selon votre histoire.</p>
              <div className="order-direction-grid">
                {musicalDirections.map((direction) => (
                  <label className="order-direction-choice" data-selected={form.musicalDirection === direction} key={direction}>
                    <input required type="radio" name="musicalDirection" checked={form.musicalDirection === direction} onChange={() => setField("musicalDirection", direction)} />
                    <span className="order-direction-choice__copy"><strong>{direction}</strong>{direction === "Je laisse LNX Beats choisir" ? <small>Une direction cohérente sera définie à partir du brief.</small> : null}</span>
                  </label>
                ))}
              </div>
              {errorField === "musicalDirection" ? <span className="field__error" id="order-musical-direction-error" role="alert">{error}</span> : null}
            </fieldset>
            <div className="field order-emotion-field">
              <label htmlFor="order-emotion">Ce que la musique doit faire ressentir</label>
              <input id="order-emotion" maxLength={orderTextLimits.emotion} value={form.emotion} placeholder="Ex. Tendre, lumineux, intense, nostalgique…" onChange={(event) => setField("emotion", event.target.value)} />
              <span className="field__hint">Une sensation suffit ; elle guidera l’écriture et l’interprétation.</span>
            </div>
            <fieldset className="fieldset order-options-fieldset">
              <legend>Options de création</legend>
              <div className="order-option-grid">
                <div className="order-option-stack order-option-stack--illustration" data-selected={form.coverIncluded}>
                  <label className="order-option-card" data-selected={form.coverIncluded}>
                    <input type="checkbox" checked={form.coverIncluded} onChange={(event) => setIllustrationEnabled(event.target.checked)} />
                    <span className="order-option-card__copy">
                      <strong>Illustration personnalisée</strong>
                      <small>Un visuel original préparé dans le format de votre choix.</small>
                    </span>
                    <span className="order-option-card__price">+ {formatEuro(orderOffer.coverCents)}</span>
                  </label>
                  {form.coverIncluded ? (
                    <fieldset className="illustration-format-panel" id="order-illustration-format" tabIndex={-1} aria-invalid={errorField === "illustrationFormat"} aria-describedby={errorField === "illustrationFormat" ? "order-illustration-format-error" : "order-illustration-format-hint"}>
                      <legend>Format de l’illustration *</legend>
                      <p id="order-illustration-format-hint">Le format ne change pas le prix.</p>
                      <div className="illustration-format-grid">
                        {orderIllustrationFormatOptions.map((option) => (
                          <label className="illustration-format-choice" data-selected={form.illustrationFormat === option.value} key={option.value}>
                            <input
                              required
                              type="radio"
                              name="illustrationFormat"
                              value={option.value}
                              checked={form.illustrationFormat === option.value}
                              onChange={() => setIllustrationFormat(option.value)}
                            />
                            <span><strong>{option.label}</strong><b>{option.ratio}</b><small>{option.description}</small></span>
                          </label>
                        ))}
                      </div>
                      {errorField === "illustrationFormat" ? <span className="field__error" id="order-illustration-format-error" role="alert">{error}</span> : null}
                      {form.illustrationFormat === "CUSTOM" ? (
                        <div className="field illustration-format-custom">
                          <label htmlFor="order-illustration-format-custom">Dimensions ou usage attendu *</label>
                          <input
                            id="order-illustration-format-custom"
                            required
                            maxLength={orderTextLimits.illustrationFormatCustom}
                            value={form.illustrationFormatCustom}
                            aria-invalid={errorField === "illustrationFormatCustom"}
                            aria-describedby={errorField === "illustrationFormatCustom" ? "order-illustration-format-custom-error" : "order-illustration-format-custom-hint"}
                            placeholder="Ex. Bannière 2560 × 1440 px"
                            onChange={(event) => setField("illustrationFormatCustom", event.target.value)}
                          />
                          <span className="field__hint" id="order-illustration-format-custom-hint">{form.illustrationFormatCustom.length} / {orderTextLimits.illustrationFormatCustom} caractères</span>
                          {errorField === "illustrationFormatCustom" ? <span className="field__error" id="order-illustration-format-custom-error" role="alert">{error}</span> : null}
                        </div>
                      ) : null}
                    </fieldset>
                  ) : null}
                </div>
                <div className="order-option-stack" data-selected={form.priorityProcessing}>
                  <label className="order-option-card" data-selected={form.priorityProcessing}>
                    <input type="checkbox" checked={form.priorityProcessing} onChange={(event) => setField("priorityProcessing", event.target.checked)} />
                    <span className="order-option-card__copy">
                      <strong>Traitement prioritaire</strong>
                      <small>{orderOffer.priorityDelay}</small>
                    </span>
                    <span className="order-option-card__price">+ {formatEuro(orderOffer.priorityCents)}</span>
                  </label>
                </div>
              </div>
            </fieldset>

            <div className="order-total order-total--compact order-total--breakdown" aria-live="polite">
              <div className="order-total__heading"><span>Total de votre création</span><strong>{formatEuro(pricing.totalCents)}</strong></div>
              <dl>
                <div><dt>Création personnelle</dt><dd>{formatEuro(pricing.basePriceCents)}</dd></div>
                {form.coverIncluded ? <div><dt>Illustration personnalisée</dt><dd>+ {formatEuro(pricing.coverPriceCents)}</dd></div> : null}
                {form.priorityProcessing ? <div><dt>Traitement prioritaire</dt><dd>+ {formatEuro(pricing.priorityPriceCents)}</dd></div> : null}
              </dl>
              <small><strong>Total maximum : {formatEuro(maximumPriceCents)}</strong> · Le total est recalculé et vérifié par LNX Studio lors de l’enregistrement.</small>
            </div>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <header className="order-step-heading">
              <span className="order-step-heading__index" aria-hidden="true">04</span>
              <div>
                <p className="eyebrow">Références privées</p>
                <h2 ref={headingRef} tabIndex={-1}>Ajoutez les images qui éclairent votre histoire.</h2>
                <p className="form-step__intro">Cette étape est facultative. Les références restent privées et servent uniquement à mieux comprendre l’univers de votre création.</p>
              </div>
            </header>
            <section className="order-photo-panel" aria-labelledby="order-photo-title">
              <div className="order-photo-panel__intro">
                <p className="auth-panel__label">Espace strictement privé</p>
                <h3 id="order-photo-title">Quelques images suffisent.</h3>
                <p>JPEG, PNG ou WebP · 10 Mo maximum par image · 10 images maximum. Chaque fichier est vérifié, réencodé et débarrassé de ses métadonnées avant stockage.</p>
              </div>
              <div className="field order-upload-field">
                <label className="order-upload-zone" htmlFor="order-photos">
                  <span className="order-upload-zone__title">Choisir des images</span>
                  <span className="order-upload-zone__meta">JPEG, PNG ou WebP · jusqu’à 10 Mo chacune</span>
                  <span className="form-button">Parcourir mes fichiers</span>
                </label>
                <input className="order-upload-input" id="order-photos" type="file" multiple accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" onChange={(event) => { setPendingFiles(Array.from(event.target.files ?? [])); setError(""); setErrorField(null); }} />
              </div>
              <label className="choice choice--full order-reference-confirmation">
                <input ref={photoRightsRef} id="order-photo-rights" aria-invalid={errorField === "photoRights"} aria-describedby={errorField === "photoRights" ? "order-photo-rights-error" : undefined} type="checkbox" checked={photoRightsConfirmed} onChange={(event) => { setPhotoRightsConfirmed(event.target.checked); setError(""); setErrorField(null); }} />
                <span>Je dispose du droit de communiquer ces photos à LNX Beats pour cette commande.</span>
              </label>
              {errorField === "photoRights" ? <span className="field__error" id="order-photo-rights-error" role="alert">{error}</span> : null}
              {account.authenticated ? <button type="button" className="form-button" onClick={() => void uploadPhotos()} disabled={busy || !pendingFiles.length}>Enregistrer les photos</button> : <p className="field__hint">Les photos sélectionnées restent uniquement en mémoire jusqu’à votre connexion.</p>}
              {pendingFiles.length ? (
                <div className="order-pending-files">
                  <strong role="status">{pendingFiles.length} image{pendingFiles.length === 1 ? "" : "s"} sélectionnée{pendingFiles.length === 1 ? "" : "s"}</strong>
                  <ul>{pendingFiles.map((file) => <li key={`${file.name}-${file.lastModified}`}>{file.name}<span>{file.type ? file.type.replace("image/", "").toUpperCase() : "FICHIER"} · {Math.ceil(file.size / 1024)} Ko</span></li>)}</ul>
                </div>
              ) : null}
              {photos.length ? (
                <ul className="order-photo-list">
                  {photos.map((photo) => (
                    <li key={photo.id}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/orders/${encodeURIComponent(orderNumber)}/photos/${photo.id}`} alt={`Photo de référence ${photo.position + 1}`} />
                      <span className="order-photo-list__meta">{photo.width} × {photo.height} · {Math.ceil(photo.sizeBytes / 1024)} Ko</span>
                      <button type="button" aria-label={`Supprimer la photo de référence ${photo.position + 1}`} onClick={() => void removePhoto(photo.id)} disabled={busy}>Supprimer</button>
                    </li>
                  ))}
                </ul>
              ) : <p className="field__hint">Aucune photo enregistrée. Cette étape reste facultative.</p>}
            </section>
          </>
        ) : null}

        {step === 4 ? (
          <>
            <header className="order-step-heading">
              <span className="order-step-heading__index" aria-hidden="true">05</span>
              <div>
                <p className="eyebrow">Votre compte</p>
                <h2 ref={headingRef} tabIndex={-1}>{account.authenticated ? "Votre espace sécurisé est prêt." : "Connectez-vous pour protéger votre brief."}</h2>
                <p className="form-step__intro">Votre compte rattache la commande, les références privées, le paiement et la livraison à une seule identité vérifiée.</p>
              </div>
            </header>
            {account.authenticated ? (
              <div className="order-auth-note order-auth-note--verified">
                <span className="order-auth-note__status">Compte vérifié</span>
                <p className="order-auth-note__identity"><strong>{account.name}</strong><span>{account.email}</span></p>
                <p>La commande, ses références privées et son paiement seront rattachés uniquement à ce compte.</p>
              </div>
            ) : (
              <div className="order-auth-note" id="order-auth-panel" tabIndex={-1}>
                <p><strong>Votre brief et vos photos sélectionnées restent en mémoire pendant ce parcours de connexion.</strong></p>
                <p>Aucune histoire ni référence privée n’est placée dans l’adresse de la page ou conservée durablement dans le navigateur.</p>
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
            <header className="order-step-heading">
              <span className="order-step-heading__index" aria-hidden="true">06</span>
              <div>
                <p className="eyebrow">Récapitulatif & paiement</p>
                <h2 ref={headingRef} tabIndex={-1}>{finalizedOrder
                  ? hasPaymentProvider ? "Votre commande est prête à être payée." : "Votre commande est enregistrée."
                  : hasPaymentProvider ? "Une dernière relecture avant le paiement." : "Une dernière relecture avant l’enregistrement."}</h2>
                <p className="form-step__intro">Vérifiez l’histoire, les choix créatifs et le total. Vous pourrez revenir aux étapes précédentes tant que la commande n’est pas finalisée.</p>
              </div>
            </header>
            <div className="order-review-grid">
              <section className="order-review-card order-review-card--wide">
                <h3 className="order-review-card__label">Projet & histoire</h3>
                <dl className="summary order-summary">
                  <div><dt>Projet</dt><dd>{form.title || "Sans titre de repère"}</dd></div>
                  <div><dt>Destinataire</dt><dd>{form.recipient}{form.occasion ? ` · ${form.occasion}` : ""}</dd></div>
                  <div><dt>Histoire</dt><dd className="summary__long">{form.brief}</dd></div>
                  {form.importantDetails ? <div><dt>Détails à préserver</dt><dd className="summary__long">{form.importantDetails}</dd></div> : null}
                </dl>
              </section>
              <section className="order-review-card">
                <h3 className="order-review-card__label">Direction artistique</h3>
                <dl className="summary order-summary">
                  <div><dt>Direction</dt><dd>{form.musicalDirection}</dd></div>
                  <div><dt>Émotion</dt><dd>{form.emotion || "Libre interprétation"}</dd></div>
                  <div><dt>Délai indicatif</dt><dd>{orderOffer.indicativeDelay}</dd></div>
                </dl>
              </section>
              <section className="order-review-card">
                <h3 className="order-review-card__label">Options & références</h3>
                <dl className="summary order-summary">
                  <div><dt>Illustration personnalisée</dt><dd>{form.coverIncluded ? "Oui" : "Non"}</dd></div>
                  {form.coverIncluded ? <div><dt>Format demandé</dt><dd>{orderIllustrationFormatLabel(form.illustrationFormat)}</dd></div> : null}
                  {form.coverIncluded && form.illustrationFormat === "CUSTOM" ? <div><dt>Précision</dt><dd>{form.illustrationFormatCustom}</dd></div> : null}
                  <div><dt>Traitement prioritaire</dt><dd>{form.priorityProcessing ? "Oui" : "Non"}</dd></div>
                  <div><dt>Références privées</dt><dd>{photos.length + pendingFiles.length}{pendingFiles.length ? " sélectionnée(s), en attente d’enregistrement" : " enregistrée(s)"}</dd></div>
                </dl>
              </section>
              <section className="order-review-card order-review-card--wide">
                <h3 className="order-review-card__label">Compte & usage</h3>
                <dl className="summary order-summary">
                  <div><dt>Compte</dt><dd>{account.authenticated ? `${account.name} · ${account.email}` : "Connexion requise"}</dd></div>
                  <div><dt>Usage compris</dt><dd>Personnel</dd></div>
                </dl>
              </section>
            </div>
            <div className="order-total order-total--breakdown order-total--final" aria-live="polite">
              <div className="order-total__heading"><span>Total de la création</span><strong>{formatEuro(pricing.totalCents)}</strong></div>
              <dl>
                <div><dt>Création personnelle</dt><dd>{formatEuro(pricing.basePriceCents)}</dd></div>
                {form.coverIncluded ? <div><dt>Illustration personnalisée</dt><dd>+ {formatEuro(pricing.coverPriceCents)}</dd></div> : null}
                {form.priorityProcessing ? <div><dt>Traitement prioritaire</dt><dd>+ {formatEuro(pricing.priorityPriceCents)}</dd></div> : null}
              </dl>
              <small><strong>Total maximum : {formatEuro(maximumPriceCents)}</strong> · {finalizedOrder ? "Total vérifié lors de l’enregistrement de la commande." : "Le total sera recalculé et vérifié lors de l’enregistrement."}</small>
            </div>

            {!finalizedOrder ? (
              <>
                <fieldset className="order-confirmations" aria-describedby={errorField === "confirmations" ? "order-confirmations-error" : undefined}>
                  <legend>Vos confirmations</legend>
                  <label className="choice choice--full">
                    <input id="order-summary-confirmed" type="checkbox" aria-invalid={errorField === "confirmations" && !summaryConfirmed} checked={summaryConfirmed} onChange={(event) => { setSummaryConfirmed(event.target.checked); setError(""); setErrorField(null); }} />
                    <span>J’ai relu l’histoire, les options et le total de cette commande.</span>
                  </label>
                  <label className="choice choice--full">
                    <input id="order-content-confirmed" type="checkbox" aria-invalid={errorField === "confirmations" && !contentConfirmed} checked={contentConfirmed} onChange={(event) => { setContentConfirmed(event.target.checked); setError(""); setErrorField(null); }} />
                    <span>Je comprends que LNX Beats peut refuser une demande illégale, haineuse, diffamatoire, harcelante ou portant atteinte aux droits d’un tiers.</span>
                  </label>
                  <label className="choice choice--full">
                    <input id="order-personal-use-confirmed" type="checkbox" aria-invalid={errorField === "confirmations" && !personalUseTermsConfirmed} checked={personalUseTermsConfirmed} onChange={(event) => { setPersonalUseTermsConfirmed(event.target.checked); setError(""); setErrorField(null); }} />
                    <span><strong>Usage personnel.</strong> {personalUseTerms.text}</span>
                  </label>
                  {errorField === "confirmations" ? <span className="field__error" id="order-confirmations-error" role="alert">{error}</span> : null}
                </fieldset>
                <button className="form-button form-button--primary order-create-button" type="button" onClick={() => void finalize()} disabled={busy}>{hasPaymentProvider ? "Enregistrer et passer au paiement" : "Enregistrer la commande"}</button>
              </>
            ) : hasPaymentProvider ? (
              <div className="order-checkout-panel">
                <p>Vous allez quitter temporairement LNX Studio pour le moyen de paiement choisi. Le retour sur le site ne suffit pas à confirmer le paiement.</p>
                <PaymentCheckoutActions orderNumber={finalizedOrder.orderNumber} amountCents={finalizedOrder.totalCents} providers={paymentProviders} />
              </div>
            ) : (
              <div className="order-checkout-panel"><p><strong>Paiement temporairement indisponible.</strong> Votre commande reste enregistrée dans votre espace.</p><Link className="form-button" href={`/compte/commandes/${encodeURIComponent(finalizedOrder.orderNumber)}`}>Voir ma commande</Link></div>
            )}
          </>
        ) : null}

        {error && (!errorField || !errorBelongsToCurrentStep || errorField === "account") ? <p className="form-message form-message--error" role="alert">{error}</p> : null}
        {message ? <p className="form-message" role="status">{message}</p> : null}

        <div className="form-navigation">
          {step > 0 && !finalizedOrder ? <button className="form-button" type="button" onClick={() => moveToStep(step - 1)} disabled={busy}>← Étape précédente</button> : <span />}
          {step < steps.length - 1 ? <button className="form-button form-button--primary" type="button" onClick={() => void nextStep()} disabled={busy}>Étape suivante →</button> : null}
        </div>
        {orderNumber && orderStatus === "DRAFT" ? <button className="order-delete-draft" type="button" onClick={() => void deleteDraft()} disabled={busy}>Supprimer ce brouillon</button> : null}
      </fieldset>
    </form>
    </>
  );
}
