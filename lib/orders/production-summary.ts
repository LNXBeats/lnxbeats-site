import { orderIllustrationFormatLabel, orderIllustrationFormatOptions } from "@/data/order-illustration";

export type OrderProductionInput = Readonly<{
  coverIncluded: boolean;
  illustrationFormat: string | null | undefined;
  illustrationFormatCustom?: string | null;
}>;

function savedIllustrationFormatLabel(order: OrderProductionInput) {
  if (!order.illustrationFormat) return "Non précisé à la commande";
  const option = orderIllustrationFormatOptions.find(({ value }) => value === order.illustrationFormat);
  if (!option) return "Non reconnu dans cette commande";
  if (option.value === "CUSTOM") {
    const precision = order.illustrationFormatCustom?.trim();
    return precision ? `Autre format — ${precision}` : "Autre format — précision non renseignée";
  }
  return orderIllustrationFormatLabel(option.value);
}

/** Present saved choices only; a historical option is never a current deliverable. */
export function getOrderProductionSummary(order: OrderProductionInput) {
  const hasSavedFormat = Boolean(order.illustrationFormat || order.illustrationFormatCustom?.trim());
  return {
    illustrationLabel: order.coverIncluded ? "Demandée" : "Non demandée",
    formatLabel: order.coverIncluded ? savedIllustrationFormatLabel(order) : null,
    historicalFormatLabel: !order.coverIncluded && hasSavedFormat ? savedIllustrationFormatLabel(order) : null,
  };
}
