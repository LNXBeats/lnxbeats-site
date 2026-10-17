"use client";

import { useEffect, useRef, useState } from "react";
import { digitalPaypalButtonOptions, digitalPaypalDocumentNonce, digitalPaypalRenderStatus, loadDigitalPaypalSdk, type DigitalPaypalButtonStatus, type DigitalPaypalCreatedOrder, type DigitalPaypalSdk } from "@/lib/digital/paypal-sdk-browser";
import { digitalCheckoutPreflightRefused } from "@/lib/digital/request-error";

export type DigitalPaypalButtonsProps = {
  ready: boolean; clientId: string | null; nonce?: string | null;
  canStart?: () => boolean;
  createOrder: () => Promise<DigitalPaypalCreatedOrder>;
  onApprove: (order: DigitalPaypalCreatedOrder) => Promise<void>;
  onCancel: (order: DigitalPaypalCreatedOrder | null) => void;
  onError: () => void;
};

export function DigitalPaypalButtons(props: DigitalPaypalButtonsProps) {
  const callbacks = useRef(props), container = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0), [status, setStatus] = useState<DigitalPaypalButtonStatus>("loading");
  useEffect(() => { callbacks.current = props; });
  useEffect(() => {
    if (!props.ready || !props.clientId || !container.current) return;
    let disposed = false, buttons: ReturnType<DigitalPaypalSdk["Buttons"]> | undefined;
    const target = container.current;
    void Promise.resolve().then(() => {
      const nonce = digitalPaypalDocumentNonce(document);
      // A prop from another RSC response cannot replace this document's nonce.
      return loadDigitalPaypalSdk(props.clientId!, nonce);
    }).then(async sdk => {
      if (disposed) return;
      buttons = sdk.Buttons(digitalPaypalButtonOptions({
        active: () => !disposed,
        ready: () => callbacks.current.ready,
        canStart: () => callbacks.current.canStart?.() ?? true,
        createOrder: async () => {
          try { return await callbacks.current.createOrder(); }
          catch (error) {
            // Keep the rejected SDK promise cached. Only the explicit button below
            // recreates Buttons; never retry an ambiguous provider result here.
            if (!disposed && digitalCheckoutPreflightRefused(error)) setStatus("preflight");
            throw error;
          }
        },
        onApprove: order => callbacks.current.onApprove(order),
        onCancel: order => callbacks.current.onCancel(order),
        onError: () => callbacks.current.onError(),
      }));
      if (!buttons.isEligible()) { setStatus("ineligible"); return; }
      await buttons.render(target);
      if (!disposed) setStatus(current => digitalPaypalRenderStatus(current, "ready"));
    }).catch(() => { if (!disposed) setStatus(current => digitalPaypalRenderStatus(current, "error")); });
    return () => { disposed = true; void buttons?.close().catch(() => {}); };
  }, [props.ready, props.clientId, attempt]);
  if (!props.ready) return <p role="status">Complétez l’adresse et les confirmations pour afficher le bouton PayPal sécurisé.</p>;
  if (!props.clientId) return <p role="status">PayPal est temporairement indisponible. Vous pouvez choisir le paiement par carte.</p>;
  return <div aria-label="Paiement sécurisé PayPal">
    <div ref={container} hidden={status === "preflight"} />
    {status === "loading" ? <p role="status">Chargement du bouton PayPal sécurisé…</p> : null}
    {status === "ineligible" ? <p role="status">PayPal n’est pas disponible sur cet appareil. Vous pouvez choisir le paiement par carte.</p> : null}
    {status === "preflight" ? <div role="status"><p>La préparation a été refusée avant l’ouverture de PayPal. Vérifiez le message, puis réessayez lorsque le problème est résolu.</p><button type="button" onClick={() => { setStatus("loading"); setAttempt(value => value + 1); }}>Réessayer la préparation PayPal</button></div> : null}
    {status === "error" ? <div role="status"><p>Le bouton PayPal n’a pas pu être chargé. Réessayez ou rechargez cette page, puis choisissez la carte si nécessaire. Aucun nouveau paiement n’a été lancé.</p><button type="button" onClick={() => { setStatus("loading"); setAttempt(value => value + 1); }}>Réessayer le chargement PayPal</button></div> : null}
  </div>;
}
