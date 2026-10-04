export type MerchantMetadata = {
  merchantMpn?: string | null;
  merchantGtin?: string | null;
  merchantColor?: string | null;
  merchantIdentifiersAbsent?: boolean;
};

export function isValidGtin(value: string) {
  if (!/^(?:\d{8}|\d{12}|\d{13}|\d{14})$/.test(value) || /^0+$/.test(value)) return false;
  const digits = [...value].map(Number);
  const check = digits.pop()!;
  const sum = digits.reverse().reduce((total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1), 0);
  return (10 - sum % 10) % 10 === check;
}

export function parseMerchantMetadata(input: Record<string, unknown>): MerchantMetadata {
  const result: MerchantMetadata = {};
  for (const [key, max] of [["merchantMpn", 70], ["merchantGtin", 14], ["merchantColor", 100]] as const) {
    if (!(key in input)) continue; // Old callers cannot erase existing metadata.
    const value = input[key];
    if (value !== null && typeof value !== "string") throw new Error("Attribut Merchant invalide.");
    const normalized = typeof value === "string" ? value.trim() : "";
    if (normalized.length > max || /[\u0000-\u001f\u007f]/.test(normalized)) throw new Error("Attribut Merchant invalide.");
    if (key === "merchantGtin" && normalized && !isValidGtin(normalized)) throw new Error("Le GTIN et sa clé de contrôle sont invalides.");
    result[key] = normalized || null;
  }
  if ("merchantIdentifiersAbsent" in input) {
    const value = input.merchantIdentifiersAbsent;
    if (![true, false, "on", "false"].includes(value as boolean | string)) throw new Error("Confirmation Merchant invalide.");
    result.merchantIdentifiersAbsent = value === true || value === "on";
  }
  if (result.merchantIdentifiersAbsent && (result.merchantMpn || result.merchantGtin)) throw new Error("Un identifiant renseigné ne peut pas être déclaré absent.");
  return result;
}
