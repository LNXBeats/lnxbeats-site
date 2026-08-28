"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

export function PaypalReturnCapture({
  orderNumber,
  providerOrderId,
  target = "music",
}: {
  orderNumber: string;
  providerOrderId: string;
  target?: "music" | "shop";
}) {
  const router = useRouter();
  const started = useRef(false);
  const [message, setMessage] = useState("Confirmation PayPal en cours…");

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void (async () => {
      try {
        const response = await fetch(
          target === "shop"
            ? `/api/shop/orders/${encodeURIComponent(orderNumber)}/payments/paypal/capture`
            : `/api/orders/${encodeURIComponent(orderNumber)}/payments/paypal/capture`,
          {
            method: "POST",
            headers: { "content-type": "application/json", accept: "application/json" },
            body: JSON.stringify({ providerOrderId }),
          },
        );
        const body = await response.json().catch(() => null) as { confirmed?: unknown; pending?: unknown; code?: unknown } | null;
        if (!response.ok) {
          if (body?.code === "PAYMENT_ALREADY_COMPLETED") {
            setMessage("Le paiement de cette commande est déjà confirmé.");
            router.refresh();
            return;
          }
          throw new Error("La confirmation PayPal n’est pas encore disponible. Aucun nouveau paiement n’est nécessaire.");
        }
        setMessage(body?.confirmed === true ? "Paiement PayPal confirmé." : "Paiement reçu par PayPal, confirmation serveur en cours…");
        router.refresh();
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "La confirmation PayPal reste en attente.");
      }
    })();
  }, [orderNumber, providerOrderId, router, target]);

  return <p className="form-message" role="status">{message}</p>;
}
