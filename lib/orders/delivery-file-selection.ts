import { orderOffer } from "@/data/order-offer";

type DeliveryFileCandidate = Readonly<{
  name: string;
  size: number;
  type: string;
}>;

export type DeliveryFileSelection =
  | Readonly<{ ok: true; format: "MP3" | "WAV" }>
  | Readonly<{ ok: false; message: string }>;

const mp3MimeTypes = new Set(["audio/mpeg", "audio/mp3", "audio/x-mpeg"]);
const wavMimeTypes = new Set(["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"]);

export function validateDeliveryFileSelection(file: DeliveryFileCandidate): DeliveryFileSelection {
  if (!Number.isSafeInteger(file.size) || file.size <= 0) {
    return { ok: false, message: "Le fichier sélectionné est vide." };
  }
  if (file.size > orderOffer.maxDeliveryBytes) {
    return { ok: false, message: "Le master doit peser au maximum 200 Mo." };
  }
  const extension = file.name.includes(".") ? file.name.split(".").pop()?.toLowerCase() ?? "" : "";
  const format = extension === "mp3" ? "MP3" : extension === "wav" ? "WAV" : null;
  if (!format) {
    return { ok: false, message: "Choisissez un fichier MP3 ou WAV." };
  }
  const mimeType = file.type.trim().toLowerCase();
  // Safari may leave File.type empty for a local audio file. The extension is
  // sufficient for this advisory UI check; the server still verifies MIME,
  // signature and a complete FFmpeg decode before any R2/DB persistence.
  if (mimeType && !(format === "MP3" ? mp3MimeTypes : wavMimeTypes).has(mimeType)) {
    return { ok: false, message: "Le type du fichier ne correspond pas à son extension MP3/WAV." };
  }
  return { ok: true, format };
}

export function deliveryFileSizeLabel(sizeBytes: number) {
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} Mo`;
}
