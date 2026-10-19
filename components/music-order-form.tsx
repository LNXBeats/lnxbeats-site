"use client";

import Link from "next/link";
import { ContractLanguageNotice, T, useSiteLanguage } from "@/components/site-language";
import { OriginalName } from "@/components/original-name";
import { localeIntl } from "@/lib/i18n/config";
import { UiIcon } from "@/components/ui-icon";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { PaymentCheckoutActions } from "@/components/payment-checkout-actions";
import { useOrderJourneyMemory } from "@/components/order-journey-provider";
import {
  orderIllustrationFormatOptions,
} from "@/data/order-illustration";
import { earlyPerformanceConsentWording, orderOffer, orderPricingForVersion } from "@/data/order-offer";
import { personalUseTerms } from "@/data/rights-offer";
import {
  calculateOrderPrice,
  orderTextLimits,
  type OrderDraftInput,
  validateOrderForSubmission,
} from "@/lib/orders/domain";
import type { SerializedOrder, SerializedOrderPhoto } from "@/lib/orders/types";
import { photoSelectionError, uploadOrderPhoto, uploadPhotoQueue, type PhotoUploadState } from "@/lib/orders/photo-upload-client";
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
  const { t, locale, money } = useSiteLanguage();
  const numberLocale = localeIntl(locale);
  const text = (source: string, values: Record<string, string | number>) => t(source).replace(/\{(\w+)\}/g, (token, key: string) => String(values[key] ?? token));
  const displayMessage = (source: string) => {
    const restored = /^Commande (.+) reprise\.$/.exec(source);
    if (restored) return text("Commande {number} reprise.", { number: restored[1] });
    const minimum = /^(?:Racontez l’histoire en au moins|L’histoire doit contenir au moins) (\d+) caractères\.$/.exec(source);
    if (minimum) return text("Racontez l’histoire en au moins {count} caractères.", { count: minimum[1] });
    const limit = /^Ce champ dépasse la limite de (.+) caractères\.$/.exec(source);
    if (limit) return text("Ce champ dépasse la limite de {count} caractères.", { count: limit[1] });
    return t(source);
  };
  const illustrationLabel = () => {
    const option = orderIllustrationFormatOptions.find(({ value }) => value === form.illustrationFormat);
    if (!option) return t(form.illustrationFormat ? "Non reconnu dans cette commande" : "Non précisé à la commande");
    return option.value === "CUSTOM"
      ? `${t(option.label)} — ${form.illustrationFormatCustom || t("précision non renseignée")}`
      : `${t(option.label)} — ${option.ratio}`;
  };
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
  const [photoStates, setPhotoStates] = useState<Map<File, PhotoUploadState>>(() => new Map());
  const [confirmedPhotoNames, setConfirmedPhotoNames] = useState<string[]>([]);
  const [photoError, setPhotoError] = useState("");
  const [photoNotice, setPhotoNotice] = useState("");
  const [photoDecisionRequired, setPhotoDecisionRequired] = useState(false);
  const [photoRightsConfirmed, setPhotoRightsConfirmed] = useState(restoringJourney ? remembered.photoRightsConfirmed : false);
  const [summaryConfirmed, setSummaryConfirmed] = useState(false);
  const [contentConfirmed, setContentConfirmed] = useState(false);
  const [personalUseTermsConfirmed, setPersonalUseTermsConfirmed] = useState(false);
  const [earlyPerformanceConsentConfirmed, setEarlyPerformanceConsentConfirmed] = useState(false);
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
  const photoUploadActive = useRef(false);
  const navigationActive = useRef(false);
  const pricing = calculateOrderPrice(form, activePricingVersion);
  const pricingConfiguration = orderPricingForVersion(activePricingVersion) ?? orderOffer;
  const maximumPriceCents = pricingConfiguration.personalBaseCents
    + pricingConfiguration.coverCents
    + pricingConfiguration.priorityCents;
  const hasPaymentProvider = paymentProviders.stripe || paymentProviders.paypal;
  const errorBelongsToCurrentStep = errorField !== null && errorFieldSteps[errorField] === step;
  const liveSummaryContent = (
    <div className="order-aside__content">
      <p className="eyebrow"><T text="Récapitulatif en temps réel"/></p>
      <dl className="order-aside__summary">
        <div><dt><T text="Création personnelle"/></dt><dd>{money(pricing.basePriceCents)}</dd></div>
        <div><dt><T text="Illustration personnalisée"/></dt><dd>{form.coverIncluded ? `+ ${money(pricing.coverPriceCents)}` : t("Non sélectionnée")}</dd></div>
        {form.coverIncluded ? <div><dt><T text="Format de l’illustration"/></dt><dd>{illustrationLabel()}</dd></div> : null}
        <div><dt><T text="Traitement prioritaire"/></dt><dd>{form.priorityProcessing ? `+ ${money(pricing.priorityPriceCents)}` : t("Non sélectionné")}</dd></div>
      </dl>
      <div className="order-aside__total"><span><T text="Total actualisé"/></span><strong>{money(pricing.totalCents)}</strong></div>
      <p className="order-aside__maximum"><T text="Total maximum :"/> {money(maximumPriceCents)}</p>
      <div className="order-aside__assurance">
        <strong>{hasPaymentProvider ? t("Paiement sécurisé") : t("Données protégées")}</strong>
        <span>{hasPaymentProvider ? t("Votre brief et vos références restent protégés.") : t("Aucun paiement n’est proposé tant qu’aucun moyen sécurisé n’est disponible.")}</span>
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
    setPhotoError("");
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
    if (photoUploadActive.current) return;
    const bounded = Math.min(Math.max(next, 0), steps.length - 1);
    setStep(bounded);
    if (bounded !== 3) setConfirmedPhotoNames([]);
    setError("");
    setErrorField(null);
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
    if (photoUploadActive.current || navigationActive.current) return;
    if (!validateCurrentStep()) return;
    navigationActive.current = true;
    try {
    let persistedOrderNumber = orderNumber;
    if (step === 3 && pendingFiles.length && account.authenticated) {
      const uploaded = await uploadPhotos();
      if (!uploaded) { setPhotoDecisionRequired(true); return; }
      persistedOrderNumber = uploaded;
    }
    if (step === 4 && account.authenticated) {
      const saved = await saveDraft();
      if (!saved) return;
      persistedOrderNumber = saved.orderNumber;
      if (pendingFiles.length) {
        const uploaded = await uploadPhotos(saved.orderNumber);
        if (!uploaded) { moveToStep(3, saved.orderNumber); setPhotoDecisionRequired(true); return; }
      }
    }
    moveToStep(step + 1, persistedOrderNumber);
    } finally { navigationActive.current = false; }
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
      if (!orderNumber) {
        // Pin the first persisted draft before clearing the pre-login journey.
        // Reloading ?reprendre=1 must not discard its brief or saved inventory.
        router.replace(`/commander?brouillon=${encodeURIComponent(payload.order.orderNumber)}&etape=${stepQueryValues[step]}`, { scroll: false });
      }
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

  async function uploadPhotos(targetOrderNumber?: string, onlyFile?: File) {
    if (photoUploadActive.current) return null;
    const selected = onlyFile ? pendingFiles.filter((file) => file === onlyFile) : pendingFiles;
    if (!selected.length) {
      setPhotoError("Choisissez au moins une photo.");
      return null;
    }
    if (!photoRightsConfirmed) {
      setPhotoError("Confirmez que vous avez le droit de communiquer ces photos, ou continuez sans les fichiers non enregistrés.");
      photoRightsRef.current?.focus();
      return null;
    }
    photoUploadActive.current = true;
    setBusy(true);
    setPhotoError("");
    setPhotoNotice("Envoi des photos une par une. Vous pouvez réessayer chaque échec sans renvoyer les réussites.");
    try {
      const current = targetOrderNumber ? { orderNumber: targetOrderNumber } : orderNumber ? { orderNumber } : await saveDraft();
      if (!current) return null;
      setBusy(true);
      const result = await uploadPhotoQueue(selected, {
        upload: (file, onStage) => uploadOrderPhoto(current.orderNumber, file, onStage),
        reconcile: () => reconcilePhotos(current.orderNumber),
        onOrder: (order) => setPhotos(order.photos),
        onState: (file, state) => setPhotoStates((states) => new Map(states).set(file, state)),
        onSaved: (file) => {
          setPendingFiles((files) => files.filter((entry) => entry !== file));
          // Confirmed files no longer need a potentially 10 MiB browser Blob.
          setPhotoStates((states) => { const next = new Map(states); next.delete(file); return next; });
          setConfirmedPhotoNames((names) => [...names, file.name].slice(-orderOffer.maxPhotos));
        },
      });
      setPhotoDecisionRequired(!result.complete);
      setPhotoNotice(result.complete
        ? "Photos privées enregistrées. Les fichiers déjà confirmés ne seront pas renvoyés."
        : "Les réussites sont conservées. Réessayez les échecs ou continuez explicitement sans les fichiers non confirmés.");
      const input = document.getElementById("order-photos");
      if (input instanceof HTMLInputElement) input.value = "";
      return result.complete ? current.orderNumber : null;
    } catch (caught) {
      setPhotoError(caught instanceof Error ? caught.message : "Envoi interrompu. Réessayez les photos restantes.");
      return null;
    } finally {
      photoUploadActive.current = false;
      setBusy(false);
    }
  }

  async function reconcilePhotos(targetOrderNumber = orderNumber) {
    if (!targetOrderNumber) return null;
    const response = await fetch(`/api/orders/${encodeURIComponent(targetOrderNumber)}`, { cache: "no-store" });
    const payload = await responsePayload(response);
    if (!response.ok || !payload.order) throw new Error("Impossible de vérifier les photos enregistrées. Reconnectez-vous puis réessayez.");
    setPhotos(payload.order.photos);
    return payload.order;
  }

  async function continueWithoutPendingPhotos() {
    if (photoUploadActive.current || navigationActive.current) return;
    navigationActive.current = true;
    setBusy(true);
    try {
      // Reconcile even if a POST response was lost. No DELETE is ever sent here.
      if (orderNumber) await reconcilePhotos();
      setPendingFiles([]);
      setPhotoStates(new Map());
      setConfirmedPhotoNames([]);
      setPhotoError("");
      setPhotoNotice("");
      setPhotoDecisionRequired(false);
      setPhotoRightsConfirmed(false);
      moveToStep(step + 1);
    } catch (caught) {
      setPhotoError(caught instanceof Error ? caught.message : "Vérification interrompue. Réessayez.");
    } finally {
      navigationActive.current = false;
      setBusy(false);
    }
  }

  function selectPhotos(selected: File[]) {
    if (photoUploadActive.current) return;
    if (selected.length + pendingFiles.length > orderOffer.maxPhotos) {
      setPhotoError("Sélectionnez au maximum dix photos en attente. Les photos déjà enregistrées comptent aussi dans la limite de la commande.");
      return;
    }
    setPendingFiles((files) => [...files, ...selected]);
    setConfirmedPhotoNames([]);
    setPhotoStates((states) => {
      const next = new Map(states);
      selected.forEach((file) => {
        const error = photoSelectionError(file);
        next.set(file, error ? { stage: "failed", error } : { stage: "waiting" });
      });
      return next;
    });
    setPhotoError("");
    setPhotoNotice("");
    setPhotoDecisionRequired(false);
  }

  async function removePhoto(assetId: string) {
    if (!orderNumber) return;
    setBusy(true);
    setPhotoError("");
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(orderNumber)}/photos/${encodeURIComponent(assetId)}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = await responsePayload(response);
        throw new Error(payload.error ?? "La photo n’a pas pu être supprimée.");
      }
      setPhotos((current) => current.filter((photo) => photo.id !== assetId));
      setPhotoStates(new Map());
      setConfirmedPhotoNames([]);
      setPhotoNotice("Photo supprimée de la commande.");
    } catch (caught) {
      setPhotoError(caught instanceof Error ? caught.message : "La photo n’a pas pu être supprimée.");
    } finally {
      setBusy(false);
    }
  }

  async function finalize() {
    if (photoUploadActive.current || navigationActive.current) return;
    const validation = validateOrderForSubmission(form, { allowLegacyMissingIllustrationFormat });
    if (!validation.ok) {
      const targetStep = errorFieldSteps[validation.field];
      if (targetStep !== undefined && targetStep !== step) moveToStep(targetStep);
      setError(validation.message);
      setErrorField(validation.field);
      return;
    }
    if (!summaryConfirmed || !contentConfirmed || !personalUseTermsConfirmed || !earlyPerformanceConsentConfirmed) {
      setError("Confirmez le récapitulatif, l’usage personnel, les règles de contenu et votre demande de commencement anticipé avant de continuer.");
      setErrorField("confirmations");
      const firstMissing = !summaryConfirmed
        ? "order-summary-confirmed"
        : !contentConfirmed
          ? "order-content-confirmed"
          : !personalUseTermsConfirmed
            ? "order-personal-use-confirmed"
            : "order-early-performance-consent";
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
      if (!uploaded) { moveToStep(3); setPhotoDecisionRequired(true); return; }
    }
    setBusy(true);
    setError("");
    setErrorField(null);
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(current.orderNumber)}/finalize`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          ...form,
          personalUseTermsAccepted: true,
          earlyPerformanceConsentAccepted: true,
        }),
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
    if (!orderNumber || orderStatus !== "DRAFT" || !window.confirm(t("Supprimer définitivement ce brouillon et ses références privées ?"))) return;
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
      setPhotoStates(new Map());
      setConfirmedPhotoNames([]);
      setPhotoError("");
      setPhotoNotice("");
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
    <aside className="order-aside order-aside--live" aria-label={t("Récapitulatif de la création")}>
      <div className="order-aside__desktop">{liveSummaryContent}</div>
      <details className="order-aside__disclosure order-aside__mobile">
        <summary><span><T text="Repères du projet"/></span><strong>{money(pricing.totalCents)}</strong></summary>
        {liveSummaryContent}
      </details>
    </aside>
    <form className="order-form order-form--connected order-form--premium" aria-busy={busy} onSubmit={(event) => event.preventDefault()}>
      <nav className="order-progress-shell" aria-label={t("Étapes de la commande")}>
        <p className="order-progress__summary" aria-live="polite">
          <span><T text="Étape"/> {step + 1} <T text="sur"/> {steps.length}</span>
          <strong>{t(steps[step])}</strong>
          <progress max={steps.length} value={step + 1} aria-label={text("Progression : étape {v0} sur {v1}", { v0: step + 1, v1: steps.length })} />
        </p>
        <div className="order-progress" ref={progressRef}>
        {steps.map((label, index) => (
          <button
            key={label}
            type="button"
            className="order-progress__item"
            data-state={index < step ? "complete" : index === step ? "current" : "future"}
            aria-current={index === step ? "step" : undefined}
            aria-label={index < step ? text("Revenir à l’étape {v0} : {v1}", { v0: index + 1, v1: t(label) }) : text("Étape {v0} : {v1}", { v0: index + 1, v1: t(label) })}
            onClick={() => { if (index < step) moveToStep(index); }}
            disabled={busy || Boolean(finalizedOrder) || index >= step}
          >
            <span className="order-progress__number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
            <span className="order-progress__label">{t(label)}</span>
          </button>
        ))}
        </div>
      </nav>

      {account.authenticated && !finalizedOrder && saveState !== "idle" ? (
        <div className="order-save-status" aria-live="polite">
          <span>{saveState === "saving"
            ? t("Enregistrement du brouillon…")
            : saveState === "saved"
              ? orderStatus === "AWAITING_PAYMENT" ? t("Commande enregistrée") : t("Brouillon enregistré")
              : saveState === "error"
                ? t("Enregistrement interrompu")
                : t("Modifications non enregistrées")}</span>
          {saveState === "dirty" || saveState === "error" ? (
            <button type="button" className="order-save-status__action" onClick={() => void saveDraft()} disabled={busy}>
              {orderStatus === "AWAITING_PAYMENT" ? t("Enregistrer les modifications") : t("Enregistrer le brouillon")}
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
                <p className="eyebrow"><T text="Le projet"/></p>
                <h2 ref={headingRef} tabIndex={-1}><T text="Donnons un premier repère à votre création."/></h2>
                <p className="form-step__intro"><T text="Quelques informations suffisent pour commencer. Le nom du projet vous aidera à retrouver la commande, sans devenir automatiquement le titre du morceau."/></p>
              </div>
            </header>
            <div className="field">
              <label htmlFor="order-title"><T text="Nom du projet"/> <span><T text="(facultatif)"/></span></label>
              <input id="order-title" maxLength={orderTextLimits.title} value={form.title} placeholder={t("Ex. Une chanson pour nos vingt ans")} onChange={(event) => setField("title", event.target.value)} />
              <span className="field__hint"><T text="Un repère privé visible dans votre compte et dans l’espace Admin."/></span>
            </div>
            <div className="field-grid">
              <div className="field">
                <label htmlFor="order-recipient"><T text="Personne ou situation concernée *"/></label>
                <input id="order-recipient" required aria-invalid={errorField === "recipient"} aria-describedby={errorField === "recipient" ? "order-recipient-error" : "order-recipient-hint"} maxLength={orderTextLimits.recipient} value={form.recipient} placeholder={t("Ex. Camille, notre famille, un nouveau départ…")} onChange={(event) => setField("recipient", event.target.value)} />
                <span className="field__hint" id="order-recipient-hint"><T text="À qui — ou à quoi — cette histoire est-elle destinée ?"/></span>
                {errorField === "recipient" ? <span className="field__error" id="order-recipient-error" role="alert">{displayMessage(error)}</span> : null}
              </div>
              <div className="field">
                <label htmlFor="order-occasion"><T text="Occasion ou contexte"/></label>
                <input id="order-occasion" maxLength={orderTextLimits.occasion} value={form.occasion} placeholder={t("Ex. Anniversaire, mariage, souvenir…")} onChange={(event) => setField("occasion", event.target.value)} />
                <span className="field__hint"><T text="Facultatif, mais utile pour ajuster l’intention."/></span>
              </div>
            </div>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <header className="order-step-heading">
              <span className="order-step-heading__index" aria-hidden="true">02</span>
              <div>
                <p className="eyebrow"><T text="Votre histoire"/></p>
                <h2 ref={headingRef} tabIndex={-1}><T text="Racontez ce qui ne doit pas être perdu."/></h2>
                <p className="form-step__intro"><T text="Écrivez naturellement, comme si vous me racontiez l’histoire. Vous apportez les souvenirs et l’intention ; LNX Beats choisit les mots et construit la création musicale."/></p>
              </div>
            </header>
            <div className="order-story-panel order-story-panel--primary">
              <div className="field">
                <label htmlFor="order-brief"><T text="Histoire principale *"/></label>
                <textarea className="order-story-textarea" id="order-brief" required aria-invalid={errorField === "brief"} aria-describedby={errorField === "brief" ? "order-brief-counter order-brief-error" : "order-brief-counter"} minLength={orderTextLimits.briefMin} maxLength={orderTextLimits.brief} value={form.brief} placeholder={t("Les moments importants, les traits de caractère, les souvenirs, les mots que vous aimeriez transmettre…")} onChange={(event) => setField("brief", event.target.value)} />
                <span className="field__counter" id="order-brief-counter" data-invalid={form.brief.length > 0 && form.brief.trim().length < orderTextLimits.briefMin}>
                  {form.brief.length.toLocaleString(numberLocale)} / {orderTextLimits.brief.toLocaleString(numberLocale)} <T text="· minimum"/> {orderTextLimits.briefMin} <T text="caractères"/> </span>
                {errorField === "brief" ? <span className="field__error" id="order-brief-error" role="alert">{displayMessage(error)}</span> : null}
              </div>
            </div>
            <div className="order-story-panel order-story-panel--secondary">
              <div className="field">
                <label htmlFor="order-details"><T text="Détails à préserver"/> <span><T text="(facultatif)"/></span></label>
                <textarea id="order-details" aria-describedby="order-details-counter" maxLength={orderTextLimits.importantDetails} value={form.importantDetails} placeholder={t("Une date, une phrase, un lieu, une anecdote ou un détail de prononciation…")} onChange={(event) => setField("importantDetails", event.target.value)} />
                <span className="field__counter" id="order-details-counter">{form.importantDetails.length.toLocaleString(numberLocale)} / {orderTextLimits.importantDetails.toLocaleString(numberLocale)}</span>
              </div>
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <header className="order-step-heading">
              <span className="order-step-heading__index" aria-hidden="true">03</span>
              <div>
                <p className="eyebrow"><T text="Direction & options"/></p>
                <h2 ref={headingRef} tabIndex={-1}><T text="Choisissez la couleur et les options."/></h2>
                <p className="form-step__intro"><T text="Indiquez une direction, une émotion et les options utiles. Le total reste lisible à chaque décision."/></p>
              </div>
            </header>
            <fieldset className="fieldset order-direction-fieldset" id="order-musical-direction" tabIndex={-1} aria-invalid={errorField === "musicalDirection"} aria-describedby={errorField === "musicalDirection" ? "order-musical-direction-error" : undefined}>
              <legend><T text="Direction musicale *"/></legend>
              <p className="fieldset__intro"><T text="Choisissez un univers ou laissez LNX Beats décider selon votre histoire."/></p>
              <div className="order-direction-grid">
                {musicalDirections.map((direction) => (
                  <label className="order-direction-choice" data-selected={form.musicalDirection === direction} key={direction}>
                    <input required type="radio" name="musicalDirection" checked={form.musicalDirection === direction} onChange={() => setField("musicalDirection", direction)} />
                    <span className="order-direction-choice__copy"><strong>{t(direction)}</strong>{direction === "Je laisse LNX Beats choisir" ? <small><T text="Une direction cohérente sera définie à partir du brief."/></small> : null}</span>
                  </label>
                ))}
              </div>
              {errorField === "musicalDirection" ? <span className="field__error" id="order-musical-direction-error" role="alert">{displayMessage(error)}</span> : null}
            </fieldset>
            <div className="field order-emotion-field">
              <label htmlFor="order-emotion"><T text="Ce que la musique doit faire ressentir"/></label>
              <input id="order-emotion" maxLength={orderTextLimits.emotion} value={form.emotion} placeholder={t("Ex. Tendre, lumineux, intense, nostalgique…")} onChange={(event) => setField("emotion", event.target.value)} />
              <span className="field__hint"><T text="Une sensation suffit ; elle guidera l’écriture et l’interprétation."/></span>
            </div>
            <fieldset className="fieldset order-options-fieldset">
              <legend><T text="Options de création"/></legend>
              <div className="order-option-grid">
                <div className="order-option-stack order-option-stack--illustration" data-selected={form.coverIncluded}>
                  <label className="order-option-card" data-selected={form.coverIncluded}>
                    <input type="checkbox" checked={form.coverIncluded} onChange={(event) => setIllustrationEnabled(event.target.checked)} />
                    <span className="order-option-card__copy">
                      <strong><T text="Illustration personnalisée"/></strong>
                      <small><T text="Un visuel original préparé dans le format de votre choix."/></small>
                    </span>
                    <span className="order-option-card__price">+ {money(orderOffer.coverCents)}</span>
                  </label>
                  {form.coverIncluded ? (
                    <fieldset className="illustration-format-panel" id="order-illustration-format" tabIndex={-1} aria-invalid={errorField === "illustrationFormat"} aria-describedby={errorField === "illustrationFormat" ? "order-illustration-format-error" : "order-illustration-format-hint"}>
                      <legend><T text="Format de l’illustration *"/></legend>
                      <p id="order-illustration-format-hint"><T text="Le format ne change pas le prix."/></p>
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
                            <span><strong>{t(option.label)}</strong><b>{t(option.ratio)}</b><small>{t(option.description)}</small></span>
                          </label>
                        ))}
                      </div>
                      {errorField === "illustrationFormat" ? <span className="field__error" id="order-illustration-format-error" role="alert">{displayMessage(error)}</span> : null}
                      {form.illustrationFormat === "CUSTOM" ? (
                        <div className="field illustration-format-custom">
                          <label htmlFor="order-illustration-format-custom"><T text="Dimensions ou usage attendu *"/></label>
                          <input
                            id="order-illustration-format-custom"
                            required
                            maxLength={orderTextLimits.illustrationFormatCustom}
                            value={form.illustrationFormatCustom}
                            aria-invalid={errorField === "illustrationFormatCustom"}
                            aria-describedby={errorField === "illustrationFormatCustom" ? "order-illustration-format-custom-error" : "order-illustration-format-custom-hint"}
                            placeholder={t("Ex. Bannière 2560 × 1440 px")}
                            onChange={(event) => setField("illustrationFormatCustom", event.target.value)}
                          />
                          <span className="field__hint" id="order-illustration-format-custom-hint">{form.illustrationFormatCustom.length} / {orderTextLimits.illustrationFormatCustom} <T text="caractères"/></span>
                          {errorField === "illustrationFormatCustom" ? <span className="field__error" id="order-illustration-format-custom-error" role="alert">{displayMessage(error)}</span> : null}
                        </div>
                      ) : null}
                    </fieldset>
                  ) : null}
                </div>
                <div className="order-option-stack" data-selected={form.priorityProcessing}>
                  <label className="order-option-card" data-selected={form.priorityProcessing}>
                    <input type="checkbox" checked={form.priorityProcessing} onChange={(event) => setField("priorityProcessing", event.target.checked)} />
                    <span className="order-option-card__copy">
                      <strong><T text="Traitement prioritaire"/></strong>
                      <small>{t(orderOffer.priorityDelay)}</small>
                    </span>
                    <span className="order-option-card__price">+ {money(orderOffer.priorityCents)}</span>
                  </label>
                </div>
              </div>
            </fieldset>

            <div className="order-total order-total--compact order-total--breakdown" aria-live="polite">
              <div className="order-total__heading"><span><T text="Total de votre création"/></span><strong>{money(pricing.totalCents)}</strong></div>
              <dl>
                <div><dt><T text="Création personnelle"/></dt><dd>{money(pricing.basePriceCents)}</dd></div>
                {form.coverIncluded ? <div><dt><T text="Illustration personnalisée"/></dt><dd>+ {money(pricing.coverPriceCents)}</dd></div> : null}
                {form.priorityProcessing ? <div><dt><T text="Traitement prioritaire"/></dt><dd>+ {money(pricing.priorityPriceCents)}</dd></div> : null}
              </dl>
              <small><strong><T text="Total maximum :"/> {money(maximumPriceCents)}</strong> <T text="· Le total est recalculé et vérifié par LNX Studio lors de l’enregistrement."/></small>
            </div>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <header className="order-step-heading">
              <span className="order-step-heading__index" aria-hidden="true">04</span>
              <div>
                <p className="eyebrow"><T text="Références privées"/></p>
                <h2 ref={headingRef} tabIndex={-1}><T text="Ajoutez les images qui éclairent votre histoire."/></h2>
                <p className="form-step__intro"><T text="Cette étape est facultative. Les références restent privées et servent uniquement à mieux comprendre l’univers de votre création."/></p>
              </div>
            </header>
            <section className="order-photo-panel" aria-labelledby="order-photo-title">
              <div className="order-photo-panel__intro">
                <p className="auth-panel__label"><T text="Espace strictement privé"/></p>
                <h3 id="order-photo-title"><T text="Quelques images suffisent."/></h3>
                <p><T text="JPEG, PNG ou WebP · 10 Mio (10 485 760 octets) maximum par image · 10 images maximum. Chaque fichier est vérifié, réencodé et débarrassé de ses métadonnées avant stockage."/></p>
                <p><T text="Après un rechargement, les photos enregistrées restent disponibles. Resélectionnez uniquement les fichiers manquants : le navigateur ne conserve pas les fichiers non envoyés."/></p>
              </div>
              <div className="field order-upload-field">
                <label className="order-upload-zone" htmlFor="order-photos">
                  <span className="order-upload-zone__title"><T text="Choisir des images"/></span>
                  <span className="order-upload-zone__meta"><T text="JPEG, PNG ou WebP · jusqu’à 10 Mio chacune"/></span>
                  <span className="form-button"><T text="Parcourir mes fichiers"/></span>
                </label>
                <input className="order-upload-input" id="order-photos" type="file" multiple accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp" onChange={(event) => { selectPhotos(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
              </div>
              <label className="choice choice--full order-reference-confirmation">
                <input ref={photoRightsRef} id="order-photo-rights" aria-invalid={Boolean(photoError) && !photoRightsConfirmed} aria-describedby={photoError ? "order-photo-error" : undefined} type="checkbox" checked={photoRightsConfirmed} onChange={(event) => { setPhotoRightsConfirmed(event.target.checked); setPhotoError(""); }} />
                <span><T text="Je dispose du droit de communiquer ces photos à LNX Beats pour cette commande."/></span>
              </label>
              {photoError ? <p className="field__error" id="order-photo-error" role="alert">{displayMessage(photoError)}</p> : null}
              {account.authenticated ? <button type="button" className="form-button" onClick={() => void uploadPhotos()} disabled={busy || !pendingFiles.length}>{photoDecisionRequired ? t("Réessayer les photos restantes") : t("Enregistrer les photos")}</button> : <p className="field__hint"><T text="Les fichiers sélectionnés seront conservés en mémoire pendant la connexion depuis ce parcours. Aucun envoi avant votre connexion et votre confirmation des droits."/></p>}
              {pendingFiles.length || photoStates.size ? (
                <div className="order-pending-files order-photo-queue">
                  <strong role="status">{text("{saved} photo(s) enregistrée(s) · {pending} à confirmer", { saved: photos.length, pending: pendingFiles.length })}</strong>
                  <ul>{Array.from(new Set([...photoStates.keys(), ...pendingFiles])).map((file, index) => {
                    const state = photoStates.get(file) ?? { stage: "waiting" };
                    const labels = { waiting: "En attente", uploading: "Envoi en cours", processing: "Traitement et enregistrement", saved: "Enregistré", failed: "Échec ou confirmation interrompue" };
                    return <li key={index} data-state={state.stage}>
                      <strong><OriginalName>{file.name}</OriginalName></strong>
                      <span>{(file.size / 1024 / 1024).toLocaleString(numberLocale, { maximumFractionDigits: 2 })} <T text="Mio"/></span>
                      <span role="status">{t(labels[state.stage])}</span>
                      {state.stage === "uploading" && state.progress ? <span>{state.progress.sent.toLocaleString(numberLocale)} / {state.progress.total.toLocaleString(numberLocale)} <T text="octets envoyés"/></span> : null}
                      {state.error ? <p>{displayMessage(state.error)}</p> : null}
                      {state.stage === "failed" && account.authenticated ? <button type="button" className="form-button" onClick={() => void uploadPhotos(undefined, file)} disabled={busy}><T text="Réessayer cette photo"/></button> : null}
                    </li>;
                  })}</ul>
                </div>
              ) : null}
              {photoNotice ? <p className="field__hint" role="status">{displayMessage(photoNotice)}</p> : null}
              {confirmedPhotoNames.length ? <ul className="order-photo-confirmed">{confirmedPhotoNames.map((name, index) => <li key={index}><OriginalName>{name}</OriginalName> <T text="— Enregistrée"/></li>)}</ul> : null}
              {pendingFiles.length ? <div className="order-photo-recovery">
                <p><T text="Les photos sont facultatives. Continuer sans les fichiers non enregistrés conserve toutes les photos déjà sauvegardées ; leur état sera vérifié avant de poursuivre."/></p>
                <button type="button" className="form-button" onClick={() => void continueWithoutPendingPhotos()} disabled={busy}><T text="Continuer sans les photos non enregistrées"/></button>
              </div> : null}
              {photos.length ? (
                <ul className="order-photo-list">
                  {photos.map((photo) => (
                    <li key={photo.id}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/orders/${encodeURIComponent(orderNumber)}/photos/${photo.id}`} alt={text("Photo de référence {v0}", { v0: photo.position + 1 })} />
                      <span className="order-photo-list__meta"><T text="Enregistrée ·"/> {photo.width} × {photo.height} · {Math.ceil(photo.sizeBytes / 1024)} <T text="Kio"/></span>
                      <button type="button" aria-label={text("Supprimer la photo de référence {v0}", { v0: photo.position + 1 })} onClick={() => void removePhoto(photo.id)} disabled={busy}><T text="Supprimer"/></button>
                    </li>
                  ))}
                </ul>
              ) : <p className="field__hint"><T text="Aucune photo enregistrée. Cette étape reste facultative."/></p>}
            </section>
          </>
        ) : null}

        {step === 4 ? (
          <>
            <header className="order-step-heading">
              <span className="order-step-heading__index" aria-hidden="true">05</span>
              <div>
                <p className="eyebrow"><T text="Votre compte"/></p>
                <h2 ref={headingRef} tabIndex={-1}>{account.authenticated ? t("Votre espace sécurisé est prêt.") : t("Connectez-vous pour protéger votre brief.")}</h2>
                <p className="form-step__intro"><T text="Votre compte rattache la commande, les références privées, le paiement et la livraison à une seule identité vérifiée."/></p>
              </div>
            </header>
            {account.authenticated ? (
              <div className="order-auth-note order-auth-note--verified">
                <span className="order-auth-note__status"><T text="Compte vérifié"/></span>
                <p className="order-auth-note__identity"><strong>{account.name}</strong><span>{account.email}</span></p>
                <p><T text="La commande, ses références privées et son paiement seront rattachés uniquement à ce compte."/></p>
              </div>
            ) : (
              <div className="order-auth-note" id="order-auth-panel" tabIndex={-1}>
                <p><strong><T text="Votre brief et vos photos sélectionnées restent en mémoire pendant ce parcours de connexion."/></strong></p>
                <p><T text="Aucune histoire ni référence privée n’est placée dans l’adresse de la page ou conservée durablement dans le navigateur."/></p>
                <div className="order-auth-actions">
                  <button className="form-button form-button--primary" type="button" onClick={() => preserveAndNavigate("/connexion")}><T text="Me connecter"/></button>
                  <button className="form-button" type="button" onClick={() => preserveAndNavigate("/inscription")}><T text="Créer mon compte"/></button>
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
                <p className="eyebrow"><T text="Récapitulatif & paiement"/></p>
                <h2 ref={headingRef} tabIndex={-1}>{finalizedOrder
                  ? hasPaymentProvider ? t("Votre commande est prête à être payée.") : t("Votre commande est enregistrée.")
                  : hasPaymentProvider ? t("Une dernière relecture avant le paiement.") : t("Une dernière relecture avant l’enregistrement.")}</h2>
                <p className="form-step__intro"><T text="Vérifiez l’histoire, les choix créatifs et le total. Vous pourrez revenir aux étapes précédentes tant que la commande n’est pas finalisée."/></p>
              </div>
            </header>
            <div className="order-review-grid">
              <section className="order-review-card order-review-card--wide">
                <h3 className="order-review-card__label"><T text="Projet & histoire"/></h3>
                <dl className="summary order-summary">
                  <div><dt><T text="Projet"/></dt><dd>{form.title ? <OriginalName>{form.title}</OriginalName> : t("Sans titre de repère")}</dd></div>
                  <div><dt><T text="Destinataire"/></dt><dd translate="no">{form.recipient}{form.occasion ? ` · ${form.occasion}` : ""}</dd></div>
                  <div><dt><T text="Histoire"/></dt><dd className="summary__long" translate="no">{form.brief}</dd></div>
                  {form.importantDetails ? <div><dt><T text="Détails à préserver"/></dt><dd className="summary__long" translate="no">{form.importantDetails}</dd></div> : null}
                </dl>
              </section>
              <section className="order-review-card">
                <h3 className="order-review-card__label"><T text="Direction artistique"/></h3>
                <dl className="summary order-summary">
                  <div><dt><T text="Direction"/></dt><dd>{t(form.musicalDirection)}</dd></div>
                  <div><dt><T text="Émotion"/></dt><dd>{form.emotion || t("Libre interprétation")}</dd></div>
                  <div><dt><T text="Délai indicatif"/></dt><dd>{t(orderOffer.indicativeDelay)}</dd></div>
                </dl>
              </section>
              <section className="order-review-card">
                <h3 className="order-review-card__label"><T text="Options & références"/></h3>
                <dl className="summary order-summary">
                  <div><dt><T text="Illustration personnalisée"/></dt><dd>{form.coverIncluded ? t("Oui") : t("Non")}</dd></div>
                  {form.coverIncluded ? <div><dt><T text="Format de l’illustration"/></dt><dd>{illustrationLabel()}</dd></div> : null}
                  <div><dt><T text="Traitement prioritaire"/></dt><dd>{form.priorityProcessing ? t("Oui") : t("Non")}</dd></div>
                  <div><dt><T text="Références privées"/></dt><dd>{photos.length + pendingFiles.length}{pendingFiles.length ? t(" sélectionnée(s), en attente d’enregistrement") : t(" enregistrée(s)")}</dd></div>
                </dl>
              </section>
              <section className="order-review-card order-review-card--wide">
                <h3 className="order-review-card__label"><T text="Compte & usage"/></h3>
                <dl className="summary order-summary">
                  <div><dt><T text="Compte"/></dt><dd>{account.authenticated ? `${account.name} · ${account.email}` : t("Connexion requise")}</dd></div>
                  <div><dt><T text="Usage compris"/></dt><dd><T text="Personnel"/></dd></div>
                </dl>
              </section>
            </div>
            <div className="order-total order-total--breakdown order-total--final" aria-live="polite">
              <div className="order-total__heading"><span><T text="Total de la création"/></span><strong>{money(pricing.totalCents)}</strong></div>
              <dl>
                <div><dt><T text="Création personnelle"/></dt><dd>{money(pricing.basePriceCents)}</dd></div>
                {form.coverIncluded ? <div><dt><T text="Illustration personnalisée"/></dt><dd>+ {money(pricing.coverPriceCents)}</dd></div> : null}
                {form.priorityProcessing ? <div><dt><T text="Traitement prioritaire"/></dt><dd>+ {money(pricing.priorityPriceCents)}</dd></div> : null}
              </dl>
              <small><strong><T text="Total maximum :"/> {money(maximumPriceCents)}</strong> · {finalizedOrder ? t("Total vérifié lors de l’enregistrement de la commande.") : t("Le total sera recalculé et vérifié lors de l’enregistrement.")}</small>
            </div>

            {!finalizedOrder ? (
              <>
                <fieldset className="order-confirmations" aria-describedby={errorField === "confirmations" ? "order-confirmations-error" : undefined}>
                  <legend><T text="Vos confirmations"/></legend>
                  <ContractLanguageNotice />
                  {locale !== "fr" ? <details className="site-language-notice"><summary>{t("Comprendre les confirmations (aide à la lecture)")}</summary><p>{t("Vous confirmez votre récapitulatif et un usage personnel. LNX Beats peut refuser les contenus illicites ou portant atteinte aux droits de tiers. Vous demandez un commencement avant 14 jours ; après exécution complète, le droit de rétractation ne peut plus être exercé. Les quatre textes français ci-dessous sont les déclarations acceptées.")}</p></details> : null}
                  <label className="choice choice--full">
                    <input id="order-summary-confirmed" type="checkbox" aria-invalid={errorField === "confirmations" && !summaryConfirmed} checked={summaryConfirmed} onChange={(event) => { setSummaryConfirmed(event.target.checked); setError(""); setErrorField(null); }} />
                    <span lang="fr" translate="no">J’ai relu l’histoire, les options et le total de cette commande.</span>
                  </label>
                  <label className="choice choice--full">
                    <input id="order-content-confirmed" type="checkbox" aria-invalid={errorField === "confirmations" && !contentConfirmed} checked={contentConfirmed} onChange={(event) => { setContentConfirmed(event.target.checked); setError(""); setErrorField(null); }} />
                    <span lang="fr" translate="no">Je comprends que LNX Beats peut refuser une demande illégale, haineuse, diffamatoire, harcelante ou portant atteinte aux droits d’un tiers.</span>
                  </label>
                  <label className="choice choice--full">
                    <input id="order-personal-use-confirmed" type="checkbox" aria-invalid={errorField === "confirmations" && !personalUseTermsConfirmed} checked={personalUseTermsConfirmed} onChange={(event) => { setPersonalUseTermsConfirmed(event.target.checked); setError(""); setErrorField(null); }} />
                    <span lang="fr" translate="no"><strong>Usage personnel.</strong> {personalUseTerms.text}</span>
                  </label>
                  <label className="choice choice--full">
                    <input id="order-early-performance-consent" type="checkbox" aria-invalid={errorField === "confirmations" && !earlyPerformanceConsentConfirmed} checked={earlyPerformanceConsentConfirmed} onChange={(event) => { setEarlyPerformanceConsentConfirmed(event.target.checked); setError(""); setErrorField(null); }} />
                    <span lang="fr" translate="no"><strong>Commencement avant 14 jours.</strong> {earlyPerformanceConsentWording}</span>
                  </label>
                  {errorField === "confirmations" ? <span className="field__error" id="order-confirmations-error" role="alert">{displayMessage(error)}</span> : null}
                </fieldset>
                <button className="form-button form-button--primary order-create-button" type="button" onClick={() => void finalize()} disabled={busy}>{hasPaymentProvider ? t("Enregistrer et passer au paiement") : t("Enregistrer la commande")}</button>
              </>
            ) : hasPaymentProvider ? (
              <div className="order-checkout-panel">
                <p><T text="Vous allez quitter temporairement LNX Studio pour le moyen de paiement choisi. Le retour sur le site ne suffit pas à confirmer le paiement."/></p>
                <PaymentCheckoutActions orderNumber={finalizedOrder.orderNumber} amountCents={finalizedOrder.totalCents} providers={paymentProviders} />
              </div>
            ) : (
              <div className="order-checkout-panel"><p><strong><T text="Paiement temporairement indisponible."/></strong> <T text="Votre commande reste enregistrée dans votre espace."/></p><Link className="form-button" href={`/compte/commandes/${encodeURIComponent(finalizedOrder.orderNumber)}`}><T text="Voir ma commande"/></Link></div>
            )}
          </>
        ) : null}

        {error && (!errorField || !errorBelongsToCurrentStep || errorField === "account") ? <p className="form-message form-message--error" role="alert">{displayMessage(error)}</p> : null}
        {message ? <p className="form-message" role="status">{displayMessage(message)}</p> : null}

        <div className="form-navigation">
          {step > 0 && !finalizedOrder ? <button className="form-button" type="button" onClick={() => moveToStep(step - 1)} disabled={busy}><UiIcon name="arrow-left" /> <T text="Étape précédente"/></button> : <span />}
          {step < steps.length - 1 ? <button className="form-button form-button--primary" type="button" onClick={() => void nextStep()} disabled={busy}><T text="Étape suivante"/> <UiIcon name="arrow-right" /></button> : null}
        </div>
        {orderNumber && orderStatus === "DRAFT" ? <button className="order-delete-draft" type="button" onClick={() => void deleteDraft()} disabled={busy}><T text="Supprimer ce brouillon"/></button> : null}
      </fieldset>
    </form>
    </>
  );
}
