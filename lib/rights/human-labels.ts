const distributorLabels: Readonly<Record<string, string>> = {
  distrokid: "DistroKid",
};

export function humanRightsDistributor(value: unknown, fallback = "Non renseigné") {
  const normalized = typeof value === "string" && value.trim() ? value.trim() : fallback;
  return distributorLabels[normalized.toLocaleLowerCase("fr-FR")] ?? normalized;
}
