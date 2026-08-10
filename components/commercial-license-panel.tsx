"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { CommercialLicenseStatus } from "@/data/order-offer";
import { formatEuro } from "@/lib/orders/domain";
import type { SerializedCommercialLicense, SerializedOrder } from "@/lib/orders/types";

const statusLabels: Record<CommercialLicenseStatus, string> = {
  REQUESTED: "Demande reçue",
  CONTRACT_PENDING: "Contrat en préparation",
  PAYMENT_PENDING: "Paiement en attente",
  ACTIVE: "Droits actifs",
  REJECTED: "Demande refusée",
  CANCELLED: "Demande annulée",
};

async function responsePayload(response: Response) {
  return response.json().catch(() => ({})) as Promise<{ order?: SerializedOrder; error?: string }>;
}

export function CommercialLicensePanel({
  orderNumber,
  initialLicense,
  initialCanRequest,
}: {
  orderNumber: string;
  initialLicense: SerializedCommercialLicense | null;
  initialCanRequest: boolean;
}) {
  const router = useRouter();
  const [license, setLicense] = useState(initialLicense);
  const [canRequest, setCanRequest] = useState(initialCanRequest);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function requestRights() {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(orderNumber)}/commercial-license`, {
        method: "POST",
      });
      const payload = await responsePayload(response);
      if (!response.ok || !payload.order) {
        throw new Error(payload.error ?? "La demande de droits n’a pas pu être enregistrée.");
      }
      setLicense(payload.order.commercialLicenses[0] ?? null);
      setCanRequest(false);
      setMessage("Votre demande de droits a été transmise. Aucun paiement ni contrat n’a été déclenché.");
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "La demande de droits n’a pas pu être enregistrée.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="order-detail__section commercial-license" aria-labelledby="commercial-license-title">
      <p className="auth-panel__label">Après la livraison</p>
      <h2 id="commercial-license-title">Votre création est livrée.</h2>
      <p>Votre commande comprend actuellement un usage personnel.</p>
      <p className="commercial-license__question">Vous souhaitez publier ou monétiser ce morceau&nbsp;?</p>

      {license ? (
        <dl className="commercial-license__status">
          <div><dt>Dernière demande</dt><dd>{statusLabels[license.status]}</dd></div>
          <div><dt>Extension de droits</dt><dd>{formatEuro(license.priceCents)}</dd></div>
          <div><dt>Contrat</dt><dd>{license.contractRequired ? "Spécifique et requis" : "Non requis"}</dd></div>
          <div><dt>Demandée le</dt><dd>{new Date(license.requestedAt).toLocaleDateString("fr-FR")}</dd></div>
        </dl>
      ) : null}

      <details className="commercial-license__details">
        <summary>Découvrir les droits d’exploitation</summary>
        <div>
          <p>Extension proposée à <strong>1 500 €</strong>, séparément du prix de la création.</p>
          <p>Elle prépare la publication ou la monétisation sur les plateformes et supports convenus dans le contrat.</p>
          <p><strong>Cession/licence exclusive de droits patrimoniaux d’exploitation, selon contrat spécifique.</strong> Le droit moral reste hors de ce dispositif.</p>
          <p>Aucune part SACEM automatique. Une éventuelle répartition dépend d’une contribution réelle et d’un accord distinct.</p>
          <p>Le contrat et le paiement ne sont pas encore disponibles dans cette version.</p>
          {canRequest ? (
            <button className="form-button form-button--primary" type="button" onClick={() => void requestRights()} disabled={busy}>
              {busy ? "Transmission…" : "Demander l’extension de droits"}
            </button>
          ) : null}
        </div>
      </details>
      {message ? <p className="form-message" role="status">{message}</p> : null}
      {error ? <p className="form-message form-message--error" role="alert">{error}</p> : null}
    </section>
  );
}
