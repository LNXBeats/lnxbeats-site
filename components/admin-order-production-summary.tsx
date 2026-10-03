import { getOrderProductionSummary, type OrderProductionInput } from "@/lib/orders/production-summary";

type AdminOrderProductionSummaryProps = {
  order: OrderProductionInput;
  referencePhotoCount: number;
};

export function AdminOrderProductionSummary({ order, referencePhotoCount }: AdminOrderProductionSummaryProps) {
  const production = getOrderProductionSummary(order);
  return (
    <section className="admin-order-production" aria-labelledby="admin-order-production-title">
      <h2 id="admin-order-production-title">À produire</h2>
      <dl>
        <div><dt>Illustration</dt><dd>{production.illustrationLabel}</dd></div>
        <div><dt>Photos de référence</dt><dd>{referencePhotoCount} enregistrée{referencePhotoCount === 1 ? "" : "s"}</dd></div>
        {production.formatLabel ? <div className="admin-order-production__format"><dt>Format de l’illustration</dt><dd>{production.formatLabel}</dd></div> : null}
      </dl>
      {production.historicalFormatLabel ? (
        <details className="admin-order-production__history">
          <summary>Ancien choix d’illustration — non applicable</summary>
          <p>{production.historicalFormatLabel}</p>
          <small>Illustration non commandée : ce choix historique n’est pas un livrable dû.</small>
        </details>
      ) : null}
    </section>
  );
}
