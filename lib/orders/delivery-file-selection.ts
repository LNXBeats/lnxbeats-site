import { orderOffer } from "@/data/order-offer";

type DeliveryFileCandidate = Readonly<{
  name: string;
  size: number;
  type: string;
}>;

export type DeliveryFileSelection =
  | Readonly<{ ok: true; format: "MP3" | "WAV" | "FLAC" | "ZIP" | "PDF" | "JPEG" | "PNG" }>
  | Readonly<{ ok: false; message: string }>;

const mp3MimeTypes = new Set(["audio/mpeg", "audio/mp3", "audio/x-mpeg"]);
const wavMimeTypes = new Set(["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"]);
const allowed = {
  mp3: { format: "MP3", mimeTypes: mp3MimeTypes },
  wav: { format: "WAV", mimeTypes: wavMimeTypes },
  flac: { format: "FLAC", mimeTypes: new Set(["audio/flac", "audio/x-flac"]) },
  zip: { format: "ZIP", mimeTypes: new Set(["application/zip"]) },
  pdf: { format: "PDF", mimeTypes: new Set(["application/pdf"]) },
  jpg: { format: "JPEG", mimeTypes: new Set(["image/jpeg"]) },
  jpeg: { format: "JPEG", mimeTypes: new Set(["image/jpeg"]) },
  png: { format: "PNG", mimeTypes: new Set(["image/png"]) },
} as const;

export function validateDeliveryFileSelection(file: DeliveryFileCandidate): DeliveryFileSelection {
  if (!Number.isSafeInteger(file.size) || file.size <= 0) {
    return { ok: false, message: "Le fichier sélectionné est vide." };
  }
  if (file.size > orderOffer.maxDeliveryBytes) {
    return { ok: false, message: "Le livrable doit peser au maximum 200 Mo." };
  }
  const extension = file.name.includes(".") ? file.name.split(".").pop()?.toLowerCase() ?? "" : "";
  const definition = allowed[extension as keyof typeof allowed];
  if (!definition) {
    return { ok: false, message: "Choisissez un fichier MP3, WAV, FLAC, ZIP, PDF, JPEG ou PNG." };
  }
  const mimeType = file.type.trim().toLowerCase();
  // Safari may leave File.type empty for a local audio file. The extension is
  // sufficient for this advisory UI check; the server still verifies MIME,
  // signature and a complete FFmpeg decode before any R2/DB persistence.
  if (mimeType && !definition.mimeTypes.has(mimeType as never)) {
    return { ok: false, message: "Le type du fichier ne correspond pas à son extension." };
  }
  return { ok: true, format: definition.format };
}

export function deliveryFileSizeLabel(sizeBytes: number) {
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} Mo`;
}
