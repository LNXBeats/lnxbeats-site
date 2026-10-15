export const CONSUMER_REQUEST_KINDS = ["WITHDRAWAL", "NON_CONFORMITY", "GOODWILL"] as const;
export type ConsumerRequestKind = (typeof CONSUMER_REQUEST_KINDS)[number];
export const consumerRequestLabel = (kind: string) => kind === "NON_CONFORMITY" ? "Signalement de non-conformité"
  : kind === "GOODWILL" ? "Demande de geste commercial" : "Rétractation";
export const consumerRequestDeclaration = (kind: ConsumerRequestKind) => kind === "NON_CONFORMITY"
  ? "Je signale une non-conformité du contenu numérique identifié ci-dessus et demande son examen."
  : kind === "GOODWILL" ? "Je sollicite un geste commercial pour le contrat identifié ci-dessus, distinct de l’exercice de mes droits légaux."
    : "Je vous notifie par la présente ma décision de me rétracter du contrat identifié ci-dessus, sous réserve de la vérification de son applicabilité.";
