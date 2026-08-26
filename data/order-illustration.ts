import type { OrderIllustrationFormat } from "@/lib/orders/domain";

export const orderIllustrationFormatOptions = [
  {
    value: "SQUARE",
    label: "Carré",
    ratio: "1:1",
    description: "Pochette, profil et plateformes musicales.",
  },
  {
    value: "VERTICAL",
    label: "Vertical",
    ratio: "9:16",
    description: "Stories, Reels et formats plein écran.",
  },
  {
    value: "LANDSCAPE",
    label: "Paysage",
    ratio: "16:9",
    description: "YouTube, écrans et visuels horizontaux.",
  },
  {
    value: "PORTRAIT",
    label: "Portrait",
    ratio: "4:5",
    description: "Publications verticales et réseaux sociaux.",
  },
  {
    value: "CUSTOM",
    label: "Autre format",
    ratio: "Sur mesure",
    description: "Précisez librement les dimensions attendues.",
  },
] as const satisfies ReadonlyArray<{
  value: OrderIllustrationFormat;
  label: string;
  ratio: string;
  description: string;
}>;

export function orderIllustrationFormatLabel(
  format: OrderIllustrationFormat | null | undefined,
) {
  if (!format) return "Non renseigné";
  if (format === "CUSTOM") return "Autre format";
  const option = orderIllustrationFormatOptions.find((candidate) => candidate.value === format);
  return option ? `${option.label} — ${option.ratio}` : "Non renseigné";
}
