import { createHash } from "node:crypto";

export type LegalDocumentStatus = "DRAFT" | "AWAITING_LEGAL_REVIEW" | "APPROVED";

export type LegalDecision = Readonly<{
  category: "LEGAL_DECISION_REQUIRED" | "ACCOUNTING_DECISION_REQUIRED" | "LOGISTICS_DECISION_REQUIRED" | "SOURCE_RECHECK_REQUIRED";
  code: string;
}>;

export type LegalSection = Readonly<{
  title: string;
  paragraphs: readonly string[];
  decisions?: readonly LegalDecision[];
}>;

export type LegalDocument = Readonly<{
  type: "LEGAL_NOTICES" | "MUSIC_TERMS" | "SHOP_TERMS" | "PRIVACY_NOTICE" | "WITHDRAWAL_NOTICE";
  version: string;
  title: string;
  status: LegalDocumentStatus;
  createdAt: string;
  effectiveAt: null;
  approvedBy: string | null;
  approvedAt: string | null;
  legalReviewReference: string | null;
  sections: readonly LegalSection[];
  hashSha256: string;
}>;

export type LegalCandidate = LegalDocument;

function candidate(
  input: Omit<LegalDocument, "hashSha256" | "legalReviewReference"> & { legalReviewReference?: string | null },
): LegalDocument {
  return Object.freeze({
    ...input,
    legalReviewReference: input.legalReviewReference ?? null,
    hashSha256: createHash("sha256").update(JSON.stringify(input), "utf8").digest("hex"),
  });
}

function revision(base: LegalCandidate, version: string, sections: readonly LegalSection[]) {
  return candidate({
    type: base.type,
    version,
    title: base.title,
    status: "AWAITING_LEGAL_REVIEW",
    createdAt,
    effectiveAt: null,
    approvedBy: null,
    approvedAt: null,
    legalReviewReference: null,
    sections,
  });
}

const createdAt = "2026-08-28T00:00:00.000Z";
const finalHumanApprovalAt = "2026-09-01T18:32:54.000Z";
const finalHumanApprover = "Ludovic Mickaël Mathon";
const finalHumanReviewReference = "Validation humaine finale par l’éditeur et exploitant — V1.1.0 — 2026-09-01";

function approvedRevision(
  base: LegalDocument,
  version: string,
  sections: readonly LegalSection[] = base.sections,
) {
  return candidate({
    type: base.type,
    version,
    title: base.title,
    status: "APPROVED",
    createdAt: finalHumanApprovalAt,
    effectiveAt: null,
    approvedBy: finalHumanApprover,
    approvedAt: finalHumanApprovalAt,
    legalReviewReference: finalHumanReviewReference,
    sections,
  });
}

export const consumerMediatorInformation = Object.freeze({
  name: "Centre de la Médiation de la Consommation de Conciliateurs de Justice — CM2C",
  addressLines: ["49 rue de Ponthieu", "75008 Paris", "France"] as const,
  phone: "01 89 47 00 14",
  phoneE164: "+33189470014",
  website: "https://www.cm2c.net/",
  conventionReviewFrom: "2029-05-27",
  conventionExpiresAt: "2029-08-27",
});

function consumerMediatorParagraph() {
  const mediator = consumerMediatorInformation;
  return `En cas de désaccord persistant, le consommateur peut saisir gratuitement le ${mediator.name}, ${mediator.addressLines.join(", ")} — ${mediator.phone} — ${mediator.website}.`;
}

export const legalNoticesCandidate = candidate({
  type: "LEGAL_NOTICES",
  version: "legal-notices-2026-01-draft",
  title: "Mentions légales",
  status: "AWAITING_LEGAL_REVIEW",
  createdAt,
  effectiveAt: null,
  approvedBy: null,
  approvedAt: null,
  sections: [
    {
      title: "Éditeur du service",
      paragraphs: [
        "LNX STUDIO est le service en ligne exploité par Ludovic Mickaël Mathon, entrepreneur individuel, sous le nom commercial LNX Beats. LNX STUDIO n’est pas une société distincte.",
        "Adresse professionnelle : 35 Impasse des Orties, 07370 Ozon, France. Contact : lnx.beats.pro@gmail.com — 06 71 66 70 32.",
        "SIREN : 106 870 850. SIRET : 106 870 850 00018. Code APE communiqué : 9003B. Numéro de TVA intracommunautaire communiqué : FR14106870850.",
        "Directeur de la publication : Ludovic Mickaël Mathon.",
      ],
      decisions: [{ category: "ACCOUNTING_DECISION_REQUIRED", code: "VAT_AND_INVOICING_STATUS" }],
    },
    {
      title: "Activité",
      paragraphs: [
        "L’activité comprend l’écriture, la composition et la création d’œuvres musicales originales avec ou sans paroles, leur exploitation numérique, ainsi que la vente de produits physiques liés à l’activité artistique, notamment des CD audio.",
      ],
    },
    {
      title: "Hébergement",
      paragraphs: [
        "L’application et sa base PostgreSQL sont hébergées par Railway. Les médias sont conservés sur Cloudflare R2. Le nom de domaine et sa zone DNS sont administrés via OVHcloud.",
        "Les dénominations légales, adresses contractuelles et localisations de traitement des fournisseurs doivent être revérifiées sur leurs documents officiels avant publication définitive.",
      ],
      decisions: [
        { category: "SOURCE_RECHECK_REQUIRED", code: "RAILWAY_LEGAL_ENTITY_AND_ADDRESS" },
        { category: "SOURCE_RECHECK_REQUIRED", code: "CLOUDFLARE_LEGAL_ENTITY_AND_ADDRESS" },
        { category: "SOURCE_RECHECK_REQUIRED", code: "OVHCLOUD_LEGAL_ENTITY_AND_ADDRESS" },
      ],
    },
    {
      title: "Propriété intellectuelle et responsabilité",
      paragraphs: [
        "Les textes, compositions, enregistrements, visuels, marques et éléments graphiques accessibles sur le site restent protégés par les droits de leurs titulaires. Leur reproduction ou exploitation hors des autorisations accordées est interdite.",
        "Les informations sont fournies avec soin. Les limitations de responsabilité ne peuvent écarter les garanties ou responsabilités impératives prévues par la loi.",
      ],
    },
    {
      title: "Réclamation et médiation",
      paragraphs: [
        "Toute réclamation préalable peut être adressée à lnx.beats.pro@gmail.com ou au 06 71 66 70 32.",
        "En cas de désaccord persistant, le consommateur peut saisir gratuitement le CM2C — Centre de la Médiation de la Consommation de Conciliateurs de Justice, 49 Rue de Ponthieu, 75008 Paris, France — https://www.cm2c.net/.",
      ],
      decisions: [{ category: "SOURCE_RECHECK_REQUIRED", code: "CM2C_CONTACT_DETAILS_BEFORE_PUBLICATION" }],
    },
  ],
});

export const musicTermsCandidate = candidate({
  type: "MUSIC_TERMS",
  version: "music-cgv-2026-01-draft",
  title: "Conditions générales — créations musicales",
  status: "AWAITING_LEGAL_REVIEW",
  createdAt,
  effectiveAt: null,
  approvedBy: null,
  approvedAt: null,
  sections: [
    {
      title: "1. Professionnel, objet et périmètre",
      paragraphs: [
        "Les présentes conditions candidates encadrent les créations musicales personnalisées proposées par Ludovic Mickaël Mathon, entrepreneur individuel, sous le nom LNX Beats, via le service LNX STUDIO.",
        "La qualification exacte de la prestation — service personnalisé, contenu numérique ou combinaison — doit être validée par le conseil juridique avant activation.",
      ],
      decisions: [{ category: "LEGAL_DECISION_REQUIRED", code: "MUSIC_CONTRACT_CLASSIFICATION" }],
    },
    {
      title: "2. Commande, brief et contenu fourni",
      paragraphs: [
        "Le client fournit un brief loyal, suffisamment précis et exploitable. Il garantit disposer des droits nécessaires sur les textes, images, sons et autres références transmis et s’interdit tout contenu illicite ou portant atteinte aux tiers.",
        "LNX Beats peut refuser ou suspendre une demande manifestement illicite, inexploitable ou contraire aux droits de tiers. Les fichiers de référence restent privés et soumis à la politique de conservation à valider.",
      ],
      decisions: [{ category: "LEGAL_DECISION_REQUIRED", code: "MUSIC_REFERENCE_FILE_RETENTION" }],
    },
    {
      title: "3. Prix et paiement",
      paragraphs: [
        "Le prix applicable est celui affiché, calculé côté serveur et accepté lors de la commande. Les options et le total sont récapitulés avant toute redirection vers le prestataire de paiement.",
        "La commande ne peut être réputée payée qu’après confirmation serveur du prestataire. Le régime de TVA et la présentation HT/TTC restent soumis à validation comptable.",
      ],
      decisions: [{ category: "ACCOUNTING_DECISION_REQUIRED", code: "VAT_AND_INVOICING_STATUS" }],
    },
    {
      title: "4. Formation, commencement et délai",
      paragraphs: [
        "Le moment exact de formation du contrat, le délai de livraison et les conditions d’un commencement d’exécution avant l’expiration du délai de rétractation doivent être approuvés avant activation.",
        "Toute demande expresse de commencement anticipé et toute reconnaissance de ses conséquences seront recueillies séparément, par cases non précochées, si la qualification juridique retenue l’exige.",
      ],
      decisions: [
        { category: "LEGAL_DECISION_REQUIRED", code: "EARLY_PERFORMANCE_OF_MUSIC_SERVICE" },
        { category: "LEGAL_DECISION_REQUIRED", code: "MUSIC_DELIVERY_DELAY" },
      ],
    },
    {
      title: "5. Retouches, demandes nouvelles et livraison",
      paragraphs: [
        "Une retouche doit rester dans le périmètre du brief accepté. Une modification substantielle du brief, de la structure ou de la direction artistique peut constituer une nouvelle demande. Le nombre, la portée et le délai des retouches doivent être validés.",
        "La livraison numérique intervient dans le Compte sécurisé. Les formats et la disponibilité du livrable sont indiqués au client ; aucun fichier privé n’est joint à un e-mail.",
      ],
      decisions: [{ category: "LEGAL_DECISION_REQUIRED", code: "MUSIC_REVISION_POLICY" }],
    },
    {
      title: "6. Rétractation et annulation",
      paragraphs: [
        "Le droit de rétractation et ses éventuelles exceptions ne peuvent être écartés automatiquement au seul motif que la création est personnalisée. L’éligibilité est examinée selon la qualification du contrat, l’état d’exécution et les consentements effectivement recueillis.",
        "Le consommateur peut utiliser la fonctionnalité en ligne de rétractation. Une demande n’entraîne aucun remboursement automatique ; elle est instruite et donne lieu à une décision tracée.",
      ],
    },
    {
      title: "7. Propriété intellectuelle et usages",
      paragraphs: [
        "Aucun transfert automatique de propriété, qualité d’auteur, quote-part, copropriété, droit SACEM ou licence commerciale n’est consenti par la commande personnelle.",
        "Toute publication, distribution, monétisation ou exploitation professionnelle nécessite l’autorisation séparée prévue par le parcours Droits & contrats. La revue humaine et juridique demeure obligatoire.",
      ],
    },
    {
      title: "8. Responsabilité, données et force majeure",
      paragraphs: [
        "Chaque partie répond de ses obligations dans les limites permises par la loi. Aucune clause ne prive le consommateur d’une garantie impérative. Les cas de force majeure sont appréciés conformément au droit applicable.",
        "Les données sont traitées conformément à la politique de confidentialité candidate. Les données de carte et mots de passe PayPal ne sont jamais stockés par LNX STUDIO.",
      ],
    },
    {
      title: "9. Réclamation, médiation, archivage et version",
      paragraphs: [
        "Une réclamation préalable doit être adressée à LNX Beats. En cas de désaccord persistant, le consommateur peut saisir gratuitement le CM2C.",
        "La commande conserve le numéro, le prix, la version et l’empreinte SHA-256 des conditions acceptées. Les règles comptables d’archivage et de facturation restent à confirmer.",
      ],
      decisions: [
        { category: "ACCOUNTING_DECISION_REQUIRED", code: "ACCOUNTING_RETENTION_AND_INVOICE_FORMAT" },
        { category: "LEGAL_DECISION_REQUIRED", code: "B2B_TERMS_SCOPE" },
      ],
    },
  ],
});

export const shopTermsCandidate = candidate({
  type: "SHOP_TERMS",
  version: "shop-cgv-2026-01-draft",
  title: "Conditions générales — Boutique physique",
  status: "AWAITING_LEGAL_REVIEW",
  createdAt,
  effectiveAt: null,
  approvedBy: null,
  approvedAt: null,
  sections: [
    {
      title: "1. Vendeur, produits et disponibilité",
      paragraphs: [
        "La Boutique est exploitée par Ludovic Mickaël Mathon, entrepreneur individuel, sous le nom LNX Beats. Elle propose des produits physiques liés à l’activité artistique, notamment des CD audio.",
        "Les caractéristiques essentielles, le prix, la quantité, la disponibilité, les visuels et la nécessité d’une livraison sont présentés avant la commande. Les visuels illustrent le produit sans masquer ses caractéristiques essentielles.",
      ],
    },
    {
      title: "2. Panier, stock et formation du contrat",
      paragraphs: [
        "Le client peut vérifier et corriger son panier avant paiement. La création technique d’une ShopOrder réserve temporairement le stock mais ne prouve pas à elle seule un paiement ni la formation définitive du contrat.",
        "Le moment exact de formation du contrat doit être aligné entre l’interface, la confirmation durable, les statuts et les présentes conditions après décision juridique.",
      ],
      decisions: [{ category: "LEGAL_DECISION_REQUIRED", code: "SHOP_CONTRACT_FORMATION_TIME" }],
    },
    {
      title: "3. Prix, TVA, livraison et total",
      paragraphs: [
        "Le prix applicable est celui affiché et accepté lors de la commande. Les quantités, sous-total, frais de livraison et total sont calculés côté serveur et récapitulés avant paiement.",
        "Le régime de TVA, les pays desservis, les délais de préparation et de livraison et l’adresse de retour doivent être confirmés avant ouverture de la Boutique.",
      ],
      decisions: [
        { category: "ACCOUNTING_DECISION_REQUIRED", code: "VAT_AND_INVOICING_STATUS" },
        { category: "LOGISTICS_DECISION_REQUIRED", code: "DELIVERY_COUNTRIES" },
        { category: "LOGISTICS_DECISION_REQUIRED", code: "HANDLING_TIME" },
        { category: "LOGISTICS_DECISION_REQUIRED", code: "DELIVERY_ESTIMATE" },
        { category: "LOGISTICS_DECISION_REQUIRED", code: "RETURN_ADDRESS" },
      ],
    },
    {
      title: "4. Commande et paiement",
      paragraphs: [
        "La case d’acceptation des CGV n’est jamais précochée. Le serveur sélectionne la version active, refuse toute version falsifiée et conserve version, empreinte SHA-256, date, utilisateur et commande.",
        "Stripe et PayPal hébergent les parcours de paiement. LNX STUDIO ne stocke ni numéro de carte complet, ni CVC, ni mot de passe PayPal. Seule une confirmation serveur authentifiée peut rendre la commande payée.",
      ],
    },
    {
      title: "5. Livraison, suivi et transfert des risques",
      paragraphs: [
        "Le transporteur, le délai et le suivi seront affichés avant paiement lorsque la logistique sera activée. Le transfert des risques au consommateur intervient lors de la prise de possession physique, sous réserve des règles impératives applicables.",
        "La future intégration Colissimo n’est pas active. Poids, emballages, paliers, signature et tarifs doivent être administrables et snapshotés dans la commande.",
      ],
      decisions: [
        { category: "LOGISTICS_DECISION_REQUIRED", code: "MINIMUM_BILLABLE_WEIGHT_150G" },
        { category: "LOGISTICS_DECISION_REQUIRED", code: "COLISSIMO_RATE_POLICY" },
        { category: "LOGISTICS_DECISION_REQUIRED", code: "COLISSIMO_SIGNATURE_POLICY" },
        { category: "LOGISTICS_DECISION_REQUIRED", code: "TRACKING_POLICY" },
      ],
    },
    {
      title: "6. Réception, rétractation et retours",
      paragraphs: [
        "Le consommateur dispose en principe d’un délai de quatorze jours à compter de la réception du bien pour exercer son droit de rétractation, sous réserve des exceptions légales applicables et de leur information préalable.",
        "Aucune exception liée à un CD descellé ou à un produit personnalisé n’est appliquée automatiquement. La politique de scellement et la charge des frais de retour doivent être validées. Les produits défectueux, non conformes, erronés ou endommagés relèvent de parcours distincts.",
      ],
      decisions: [
        { category: "LEGAL_DECISION_REQUIRED", code: "SEALED_AUDIO_PRODUCT_POLICY" },
        { category: "LEGAL_DECISION_REQUIRED", code: "WHO_PAYS_WITHDRAWAL_RETURN_COSTS" },
      ],
    },
    {
      title: "7. Garanties et service après-vente",
      paragraphs: [
        "Les biens bénéficient de la garantie légale de conformité et de la garantie des vices cachés dans les conditions prévues par la loi. Elles ne sont pas remplacées par une garantie commerciale.",
        "Le SAV, la non-conformité, l’erreur vendeur et le colis endommagé sont traités séparément d’une rétractation de convenance.",
      ],
    },
    {
      title: "8. Réclamation, médiation, données et archivage",
      paragraphs: [
        "Après une réclamation préalable auprès de LNX Beats, le consommateur peut saisir gratuitement le CM2C en cas de désaccord persistant.",
        "Les données sont traitées selon la politique de confidentialité candidate. La commande et son snapshot contractuel sont archivés selon les obligations applicables ; la règle comptable finale reste à confirmer.",
      ],
      decisions: [
        { category: "ACCOUNTING_DECISION_REQUIRED", code: "ACCOUNTING_RETENTION_AND_INVOICE_FORMAT" },
        { category: "LEGAL_DECISION_REQUIRED", code: "B2B_TERMS_SCOPE" },
      ],
    },
  ],
});

export const privacyCandidate = candidate({
  type: "PRIVACY_NOTICE",
  version: "privacy-2026-01-draft",
  title: "Politique de confidentialité",
  status: "AWAITING_LEGAL_REVIEW",
  createdAt,
  effectiveAt: null,
  approvedBy: null,
  approvedAt: null,
  sections: [
    {
      title: "Responsable du traitement",
      paragraphs: [
        "Le responsable du traitement est Ludovic Mickaël Mathon, entrepreneur individuel, LNX Beats / LNX STUDIO, 35 Impasse des Orties, 07370 Ozon, France — lnx.beats.pro@gmail.com — 06 71 66 70 32.",
      ],
    },
    {
      title: "Données et finalités",
      paragraphs: [
        "Les traitements couvrent les comptes, identifiants hachés, sessions, commandes, briefs, références privées, livrables, produits, adresses de livraison, paiements, événements fournisseurs, notifications, contrats, demandes de droits, rétractations, réclamations et journaux de sécurité.",
        "Les finalités sont la création et la sécurisation du compte, les mesures précontractuelles, l’exécution des commandes, la preuve des paiements et contrats, la livraison, le support, la prévention des abus et le respect d’obligations légales.",
      ],
    },
    {
      title: "Bases légales",
      paragraphs: [
        "Selon le traitement, la base peut être l’exécution du contrat ou de mesures précontractuelles, une obligation légale, l’intérêt légitime de sécurisation ou le consentement lorsqu’il est réellement requis. La politique de confidentialité n’est pas soumise à une case d’acceptation obligatoire pour commander.",
      ],
    },
    {
      title: "Paiements et destinataires",
      paragraphs: [
        "LNX STUDIO ne stocke pas de numéro de carte complet, CVC ou mot de passe PayPal. Les données financières conservées sont limitées au prestataire, à une référence, un statut, un montant, une devise, un événement, un incident ou un remboursement.",
        "Railway, Cloudflare R2, Resend, Stripe, PayPal et OVHcloud interviennent selon leurs rôles techniques. Le registre des sources documente leurs DPA et mécanismes de transfert à revérifier avant publication finale. Colissimo n’est pas un sous-traitant actif.",
      ],
    },
    {
      title: "Durées de conservation",
      paragraphs: [
        "Les durées sont proportionnées à la finalité, aux obligations contractuelles, comptables et probatoires. Les sessions sont limitées techniquement ; les contrats et paiements peuvent être conservés plus longtemps lorsque la loi l’exige.",
        "Les durées finales des fichiers de référence musicale et le format d’archivage comptable restent à valider. La suppression d’un compte ne supprime pas les données qui doivent être légalement conservées ; elles peuvent être restreintes ou anonymisées lorsque cela est possible.",
      ],
      decisions: [
        { category: "LEGAL_DECISION_REQUIRED", code: "MUSIC_REFERENCE_FILE_RETENTION" },
        { category: "ACCOUNTING_DECISION_REQUIRED", code: "ACCOUNTING_RETENTION_AND_INVOICE_FORMAT" },
      ],
    },
    {
      title: "Cookies et services tiers",
      paragraphs: [
        "Le site utilise des cookies strictement nécessaires à l’authentification, à la session et à la sécurité. Aucun traceur d’audience ou marketing n’a été identifié dans le code audité ; une bannière de consentement ne doit pas être ajoutée sans traceur non essentiel.",
        "Les plateformes musicales et réseaux sociaux sont liés par des liens sortants. Aucun iframe ou lecteur tiers déposant des traceurs n’a été identifié dans les pages auditées.",
      ],
    },
    {
      title: "Droits",
      paragraphs: [
        "Toute personne peut demander l’accès, la rectification, l’effacement, la limitation, l’opposition ou la portabilité lorsque ces droits s’appliquent, et retirer un consentement sans affecter la licéité antérieure.",
        "Les demandes peuvent être adressées à lnx.beats.pro@gmail.com. Une réclamation peut également être déposée auprès de la CNIL.",
      ],
    },
    {
      title: "Transferts hors EEE",
      paragraphs: [
        "Certains prestataires peuvent traiter des données hors de l’Espace économique européen. Les entités, pays, clauses contractuelles types et mesures supplémentaires doivent être vérifiés dans les DPA officiels ; aucune absence de transfert n’est affirmée sans preuve.",
      ],
      decisions: [{ category: "SOURCE_RECHECK_REQUIRED", code: "PROCESSOR_TRANSFER_MECHANISMS" }],
    },
  ],
});

export const withdrawalNoticeCandidate = candidate({
  type: "WITHDRAWAL_NOTICE",
  version: "withdrawal-2026-01-draft",
  title: "Information sur le droit de rétractation",
  status: "AWAITING_LEGAL_REVIEW",
  createdAt,
  effectiveAt: null,
  approvedBy: null,
  approvedAt: null,
  sections: [
    {
      title: "Exercer son droit",
      paragraphs: [
        "Lorsque le droit de rétractation s’applique, le consommateur peut notifier sa décision au moyen du formulaire en ligne, sans avoir à fournir de motif. La demande est horodatée et reçoit une référence.",
        "L’éligibilité, les éventuelles exceptions, le retour et le remboursement sont examinés séparément. La demande ne déclenche jamais un remboursement automatique.",
      ],
    },
    {
      title: "Accusé et sécurité",
      paragraphs: [
        "Le parcours présente un récapitulatif avant confirmation, utilise une réponse anti-énumération et conserve une preuve durable de la déclaration. Les informations d’une commande ne sont jamais révélées à partir de son seul numéro.",
      ],
    },
  ],
});

export const phase4bLegalNoticesCandidate = revision(
  legalNoticesCandidate,
  "legal-notices-2026-02-draft",
  legalNoticesCandidate.sections.map((section) => section.title === "Éditeur du service" ? {
    title: section.title,
    paragraphs: [
      "Le site est édité par Ludovic Mickaël Mathon, entrepreneur individuel, sous le nom commercial LNX Beats. LNX STUDIO désigne le service en ligne et n’est pas une société distincte.",
      "Adresse professionnelle : 35 Impasse des Orties, 07370 Ozon, France. Contact : lnx.beats.pro@gmail.com — 06 71 66 70 32.",
      "SIREN : 106 870 850. SIRET : 106 870 850 00018. Code APE : 9003B. Activité déclarée : auteur-compositeur et auteur de textes, conception et création d’œuvres musicales originales avec ou sans paroles.",
      "Forme et activité : entrepreneur individuel, activité libérale non réglementée, régime spécial BNC.",
      "Régime actuel : franchise en base de TVA, sans option d’assujettissement déclarée. Le numéro de TVA communiqué n’est pas affiché comme preuve d’assujettissement.",
      "Directeur de la publication : Ludovic Mickaël Mathon.",
    ],
  } : section),
);

export const phase4b1LegalNoticesCandidate = revision(
  phase4bLegalNoticesCandidate,
  "legal-notices-2026-03-draft",
  phase4bLegalNoticesCandidate.sections.map((section) => section.title === "Réclamation et médiation" ? {
    title: section.title,
    paragraphs: [
      "Toute réclamation préalable peut être adressée à lnx.beats.pro@gmail.com ou au 06 71 66 70 32.",
      consumerMediatorParagraph(),
    ],
    decisions: section.decisions,
  } : section),
);

export const phase4bMusicTermsCandidate = revision(
  musicTermsCandidate,
  "music-cgv-2026-02-draft",
  musicTermsCandidate.sections.map((section) => {
    if (section.title === "3. Prix et paiement") return { title: section.title, paragraphs: [
      "Le prix applicable est celui affiché, calculé côté serveur et accepté lors de la commande. Les options et le total sont récapitulés avant toute redirection vers le prestataire de paiement.",
      "Une facture ne peut être émise qu’après confirmation serveur effective du paiement. Le régime actuel est la franchise en base de TVA : aucune TVA n’est ajoutée au prix et la facture porte la mention « TVA non applicable, article 293 B du CGI ».",
    ] };
    if (section.title === "4. Formation, commencement et délai") return { title: section.title, paragraphs: [
      "Le délai indicatif de réalisation est de sept à quatorze jours après confirmation du paiement et réception d’un brief exploitable. Une situation particulière annoncée explicitement peut conduire à un délai différent.",
      "Un commencement avant l’expiration du délai de rétractation n’est possible qu’après demande expresse séparée. La qualification du contrat et la formulation exacte des conséquences restent soumises à revue juridique.",
    ], decisions: [{ category: "LEGAL_DECISION_REQUIRED" as const, code: "EARLY_PERFORMANCE_WITHDRAWAL_WORDING" }] };
    if (section.title === "5. Retouches, demandes nouvelles et livraison") return { title: section.title, paragraphs: [
      "Le prix comprend une retouche raisonnable restant dans le périmètre du brief accepté. Une modification substantielle du brief, de la structure ou de la direction artistique constitue une nouvelle demande susceptible de devis ou commande distincte.",
      "La livraison numérique intervient dans le Compte sécurisé. Les fichiers sources transmis pour le brief sont conservés jusqu’à quatre-vingt-dix jours après livraison, sauf obligation légale, litige ou demande justifiée imposant une conservation différente.",
    ] };
    if (section.title === "9. Réclamation, médiation, archivage et version") return { title: section.title, paragraphs: [
      "Une réclamation préalable doit être adressée à LNX Beats. En cas de désaccord persistant, le consommateur peut saisir gratuitement le CM2C.",
      "La commande conserve le numéro, le prix, la version et l’empreinte SHA-256 des conditions acceptées. Les factures, avoirs et pièces comptables sont conservés dix ans. Un parcours professionnel doit recueillir une identité de facturation distincte sans accorder de droits sur une simple déclaration navigateur.",
    ] };
    return section;
  }),
);

export const phase4bShopTermsCandidate = revision(
  shopTermsCandidate,
  "shop-cgv-2026-02-draft",
  shopTermsCandidate.sections.map((section) => {
    if (section.title === "3. Prix, TVA, livraison et total") return { title: section.title, paragraphs: [
      "Le prix applicable est celui affiché et accepté lors de la commande. Les quantités, sous-total, frais de livraison et total sont calculés côté serveur et snapshotés avant paiement. La facture reprend exactement ces frais sans recalcul ultérieur.",
      "Le régime actuel est la franchise en base de TVA : aucune TVA n’est ajoutée et la facture porte la mention « TVA non applicable, article 293 B du CGI ». Au lancement, la livraison est limitée à la France métropolitaine.",
      "La préparation prend normalement deux à trois jours ouvrés après paiement. Le transport prévu est Colissimo avec signature ; son délai indicatif et son coût devront être affichés avant l’obligation de paiement. En l’absence de tarif valide, le futur Checkout Production doit refuser la vente.",
    ] };
    if (section.title === "5. Livraison, suivi et transfert des risques") return { title: section.title, paragraphs: [
      "La livraison de lancement est prévue en France métropolitaine par Colissimo avec signature. La préparation LNX Beats de deux à trois jours ouvrés est distincte du délai indicatif du transporteur. Une fiche produit peut annoncer explicitement une précommande ou un délai particulier.",
      "Le transfert des risques intervient lors de la prise de possession physique, sous réserve des règles impératives. L’intégration La Poste n’est pas active : le suivi automatique futur devra conserver un fallback manuel, sans promesse d’API existante.",
      "Les poids produit, emballage et protection devront être administrables. Le poids facturable minimal décidé est de 150 g. Les grilles de transport seront versionnées et snapshotées, jamais codées en dur dans les conditions.",
    ] };
    if (section.title === "6. Réception, rétractation et retours") return { title: section.title, paragraphs: [
      "Le consommateur dispose en principe de quatorze jours à compter de la réception pour exercer son droit de rétractation. Pour une rétractation de convenance, les frais directs de retour sont à sa charge si cette information a été fournie avant la commande.",
      "Les CD audio sont expédiés scellés. L’exception légale applicable aux enregistrements audio descellés est interprétée strictement et ne supprime jamais les garanties pour défaut, non-conformité, erreur vendeur ou dommage. Le formulaire de rétractation demeure disponible pour les cas éligibles.",
      "Adresse de retour : LNX Beats, 35 Impasse des Orties, 07370 Ozon, France. Toute future modification crée une nouvelle version des conditions sans réécrire les snapshots historiques.",
    ], decisions: [{ category: "LEGAL_DECISION_REQUIRED" as const, code: "SEALED_AUDIO_WITHDRAWAL_EXACT_WORDING" }] };
    if (section.title === "8. Réclamation, médiation, données et archivage") return { title: section.title, paragraphs: [
      "Après une réclamation préalable auprès de LNX Beats, le consommateur peut saisir gratuitement le CM2C en cas de désaccord persistant.",
      "La commande et son snapshot contractuel sont archivés. Les factures, avoirs et pièces comptables sont conservés dix ans. La distinction B2C/B2B et les mentions propres au professionnel restent soumises au périmètre contractuel final.",
    ] };
    return section;
  }),
);

export const phase4bPrivacyCandidate = revision(
  privacyCandidate,
  "privacy-2026-02-draft",
  privacyCandidate.sections.map((section) => section.title === "Données et finalités" ? { title: section.title, paragraphs: [
    "Les traitements couvrent les comptes, sessions, commandes, briefs, références privées, livrables, produits, adresses de livraison et de facturation, choix B2C/B2B, paiements, factures, avoirs, notifications, contrats, rétractations, retours, réclamations et journaux de sécurité.",
    "Les finalités sont les mesures précontractuelles, l’exécution, la preuve, la facturation, la livraison, le support, la sécurité et le respect des obligations légales. Un futur numéro de suivi ne sera traité qu’après activation réelle de la logistique.",
  ] } : section.title === "Durées de conservation" ? { title: section.title, paragraphs: [
    "Les factures, avoirs et pièces comptables sont conservés dix ans. Les fichiers de référence musicale sont conservés jusqu’à quatre-vingt-dix jours après livraison, sauf obligation légale, litige ou demande justifiée imposant une durée différente.",
    "La suppression d’un compte ne supprime pas les données soumises à conservation légale ; leur accès est restreint. Les autres durées restent proportionnées à la finalité, au contrat, à la sécurité et aux délais de recours.",
  ] } : section.title === "Paiements et destinataires" ? { title: section.title, paragraphs: [
    "LNX STUDIO ne stocke pas de numéro de carte complet, CVC ou mot de passe PayPal. Les données financières et de facturation sont limitées aux références, statuts, montants, devises, événements, factures, avoirs et remboursements nécessaires.",
    "Railway, Cloudflare R2, Resend, Stripe, PayPal et OVHcloud interviennent selon leurs rôles techniques. La Poste/Colissimo n’est pas présenté comme destinataire actif tant que l’intégration n’est pas réalisée.",
  ] } : section),
);

export const releaseBPrivacyCandidate = revision(
  phase4bPrivacyCandidate,
  "privacy-2026-03-candidate",
  phase4bPrivacyCandidate.sections.map((section) => section.title === "Données et finalités" ? { title: section.title, paragraphs: [
    "Les traitements couvrent les comptes, sessions, commandes, briefs, références privées, livrables, produits, adresses de livraison et de facturation, choix B2C/B2B, paiements, factures, avoirs, notifications, contrats, rétractations, retours, réclamations et journaux de sécurité.",
    "Une demande SAV peut, au choix du client, comporter jusqu’à cinq photographies destinées à documenter un défaut, une non-conformité, une erreur ou un dommage. Elles ne sont pas requises pour déposer un message SAV.",
    "Les finalités sont les mesures précontractuelles, l’exécution, la preuve, la facturation, la livraison, le support, la sécurité et le respect des obligations légales. Un numéro de suivi manuel est traité uniquement pour une commande expédiée.",
  ] } : section.title === "Paiements et destinataires" ? { title: section.title, paragraphs: [
    "LNX STUDIO ne stocke pas de numéro de carte complet, CVC ou mot de passe PayPal. Les données financières et de facturation sont limitées aux références, statuts, montants, devises, événements, factures, avoirs et remboursements nécessaires.",
    "Railway, Cloudflare R2, Resend, Stripe, PayPal et OVHcloud interviennent selon leurs rôles techniques. Les photographies SAV sont conservées dans un stockage objet privé Cloudflare R2 et ne sont accessibles qu’au client concerné et aux administrateurs autorisés. La Poste/Colissimo n’est pas présenté comme destinataire API actif.",
  ] } : section.title === "Durées de conservation" ? { title: section.title, paragraphs: [
    "Les factures, avoirs et pièces comptables sont conservés dix ans. Les fichiers de référence musicale sont conservés jusqu’à quatre-vingt-dix jours après livraison, sauf obligation légale, litige ou demande justifiée imposant une durée différente.",
    "Les photographies facultatives d’un dossier SAV sont supprimées quatre-vingt-dix jours après la clôture du dossier. L’état de purge reste auditable sans conserver le contenu de la photographie.",
    "La suppression d’un compte ne supprime pas les données soumises à conservation légale ; leur accès est restreint. Les autres durées restent proportionnées à la finalité, au contrat, à la sécurité et aux délais de recours.",
  ] } : section),
);

export const phase4cMusicTermsCandidate = revision(
  phase4bMusicTermsCandidate,
  "music-cgv-2026-03-draft",
  phase4bMusicTermsCandidate.sections.map((section) => {
    if (section.title === "1. Professionnel, objet et périmètre") return {
      title: section.title,
      paragraphs: [
        "Les présentes conditions candidates encadrent les créations musicales personnalisées proposées par Ludovic Mickaël Mathon, entrepreneur individuel, sous le nom LNX Beats, via le service LNX STUDIO.",
        "La création musicale personnalisée LNX Beats est présentée, dans cette version candidate, principalement comme une prestation de services créatifs réalisée sur commande, donnant lieu à la livraison d’un contenu numérique.",
        "Cette qualification reste soumise à validation juridique professionnelle avant toute activation. La création musicale n’est pas présentée comme un simple bien personnalisé et l’exception applicable aux biens confectionnés selon les spécifications du consommateur ne constitue pas automatiquement le fondement d’une absence de rétractation.",
      ],
      decisions: [{ category: "LEGAL_DECISION_REQUIRED" as const, code: "MUSIC_CONTRACT_CLASSIFICATION" }],
    };
    if (section.title === "4. Formation, commencement et délai") return {
      title: section.title,
      paragraphs: [
        "Le délai indicatif de réalisation est de sept à quatorze jours après confirmation du paiement et réception d’un brief exploitable. Une situation particulière annoncée explicitement peut conduire à un délai différent.",
        "Je demande expressément que LNX Beats commence l’exécution de ma commande avant la fin du délai légal de rétractation de 14 jours. Je reconnais qu’une fois la prestation entièrement exécutée, je ne pourrai plus exercer mon droit de rétractation.",
        "Si vous exercez votre droit de rétractation après le début de l’exécution mais avant son achèvement, le montant correspondant aux prestations déjà réalisées pourra rester dû, proportionnellement au service fourni, conformément à l’article L. 221-25 du Code de la consommation.",
        "Cette demande devra être recueillie séparément, par une case non précochée, et faire l’objet d’une preuve versionnée et horodatée avant toute activation du texte.",
      ],
      decisions: [{ category: "LEGAL_DECISION_REQUIRED" as const, code: "EARLY_PERFORMANCE_WITHDRAWAL_WORDING" }],
    };
    if (section.title === "6. Rétractation et annulation") return {
      title: section.title,
      paragraphs: [
        "Le droit de rétractation et ses éventuelles exceptions ne peuvent être écartés automatiquement au seul motif que la création est personnalisée. L’éligibilité dépend notamment de la qualification du contrat, de l’état réel d’exécution et des consentements distincts effectivement recueillis.",
        "Le commencement de la prestation ne provoque pas une renonciation immédiate. Avant l’exécution complète, une rétractation peut conduire au paiement proportionnel du service déjà fourni lorsque les conditions légales sont réunies. Le consommateur peut utiliser la fonctionnalité en ligne ; sa demande est instruite et ne déclenche aucun remboursement automatique.",
      ],
      decisions: [{ category: "LEGAL_DECISION_REQUIRED" as const, code: "EARLY_PERFORMANCE_WITHDRAWAL_WORDING" }],
    };
    return section;
  }),
);

export const phase4cShopTermsCandidate = revision(
  phase4bShopTermsCandidate,
  "shop-cgv-2026-03-draft",
  phase4bShopTermsCandidate.sections.map((section) => {
    if (section.title === "2. Panier, stock et formation du contrat") return {
      title: section.title,
      paragraphs: [
        "Le client peut vérifier et corriger son panier avant paiement. La création technique d’une ShopOrder réserve temporairement le stock mais ne prouve pas à elle seule un paiement ni la formation définitive du contrat.",
        "La vente est définitivement conclue après validation du paiement et confirmation de la commande par LNX Beats. Un accusé de réception de la commande est adressé au client par voie électronique. En cas de refus ou d’échec du paiement, la commande n’est pas considérée comme définitivement validée.",
        "Le simple retour du navigateur depuis Stripe ou PayPal ne constitue jamais une preuve de paiement. Seule la confirmation serveur authentifiée et réconciliée peut rendre la commande payée.",
      ],
      decisions: [{ category: "LEGAL_DECISION_REQUIRED" as const, code: "SHOP_CONTRACT_FORMATION_TIME" }],
    };
    if (section.title === "6. Réception, rétractation et retours") return {
      title: section.title,
      paragraphs: [
        "Le consommateur dispose en principe de quatorze jours à compter de la réception pour exercer son droit de rétractation. Pour une rétractation de convenance légalement possible, les frais directs de retour sont à sa charge si cette information a été fournie avant la commande.",
        "CD et autres enregistrements audio scellés : conformément à l’article L. 221-28 du Code de la consommation, le droit de rétractation ne peut être exercé pour les enregistrements audio descellés par le consommateur après leur livraison. Tant que le produit demeure scellé, le droit de rétractation reste applicable dans les conditions légales.",
        "Cette exception ne limite jamais la garantie légale de conformité, la garantie des vices cachés ni les recours applicables aux produits défectueux, non conformes, erronés ou endommagés. Ces situations restent distinctes d’une rétractation de convenance.",
        "Adresse de retour : LNX Beats, 35 Impasse des Orties, 07370 Ozon, France. Toute future modification crée une nouvelle version des conditions sans réécrire les snapshots historiques.",
      ],
      decisions: [{ category: "LEGAL_DECISION_REQUIRED" as const, code: "SEALED_AUDIO_WITHDRAWAL_EXACT_WORDING" }],
    };
    return section;
  }),
);

export const releaseBShopTermsCandidate = revision(
  phase4cShopTermsCandidate,
  "shop-cgv-2026-04-candidate",
  phase4cShopTermsCandidate.sections.map((section) => section.title === "5. Livraison, suivi et transfert des risques" ? {
    title: section.title,
    paragraphs: [
      "La livraison de lancement est limitée à la France métropolitaine, Corse comprise, par Colissimo à domicile. La préparation LNX Beats de deux à trois jours ouvrés est distincte du délai indicatif du transporteur. Une fiche produit peut annoncer explicitement une précommande ou un délai particulier.",
      "Le transfert des risques intervient lors de la prise de possession physique, sous réserve des règles impératives. Au lancement, le numéro de suivi est saisi manuellement par un administrateur et communiqué au client ; aucun statut détaillé du transporteur n’est simulé.",
      "Les poids produit, emballage et protection sont administrables. Le poids facturable est celui des produits seuls, avec un minimum de 250 g. Le carton CD de 60 g est offert, non facturé et limité à seize articles tant que le multi-colis n’est pas disponible. Les grilles sont versionnées et snapshotées dans la commande.",
    ],
    decisions: [{ category: "LEGAL_DECISION_REQUIRED" as const, code: "SHOP_TERMS_RELEASE_B_HUMAN_APPROVAL" }],
  } : section),
);

export const phase4cWithdrawalNoticeCandidate = revision(
  withdrawalNoticeCandidate,
  "withdrawal-2026-02-draft",
  [
    withdrawalNoticeCandidate.sections[0]!,
    {
      title: "Commencement anticipé d’une prestation",
      paragraphs: [
        "La demande expresse de commencement avant la fin du délai légal de quatorze jours ne vaut pas renonciation immédiate au droit de rétractation. Une fois la prestation entièrement exécutée, la perte du droit reste soumise aux conditions légales et au consentement effectivement recueilli.",
        "En cas de rétractation après le début de l’exécution mais avant son achèvement, le montant correspondant aux prestations déjà réalisées peut rester dû proportionnellement au service fourni, conformément à l’article L. 221-25 du Code de la consommation.",
      ],
      decisions: [{ category: "LEGAL_DECISION_REQUIRED" as const, code: "EARLY_PERFORMANCE_WITHDRAWAL_WORDING" }],
    },
    {
      title: "CD et autres enregistrements audio scellés",
      paragraphs: [
        "CD et autres enregistrements audio scellés : conformément à l’article L. 221-28 du Code de la consommation, le droit de rétractation ne peut être exercé pour les enregistrements audio descellés par le consommateur après leur livraison. Tant que le produit demeure scellé, le droit de rétractation reste applicable dans les conditions légales.",
        "Les garanties légales et les recours relatifs à un produit défectueux, non conforme, erroné ou endommagé restent applicables. Les frais directs de retour à la charge du consommateur concernent uniquement une rétractation de convenance légalement possible et correctement annoncée.",
      ],
      decisions: [{ category: "LEGAL_DECISION_REQUIRED" as const, code: "SEALED_AUDIO_WITHDRAWAL_EXACT_WORDING" }],
    },
    withdrawalNoticeCandidate.sections[1]!,
  ],
);

export const finalLegalNoticesCandidate = revision(
  phase4b1LegalNoticesCandidate,
  "legal-notices-2026-04-candidate",
  phase4b1LegalNoticesCandidate.sections.map((section) => {
    if (section.title === "Hébergement") return {
      title: section.title,
      paragraphs: [
        "L’application et sa base de données PostgreSQL sont hébergées sur l’infrastructure Railway.",
        "Les médias sont conservés sur Cloudflare R2. Le nom de domaine et sa zone DNS sont administrés via OVHcloud.",
      ],
      decisions: section.decisions,
    };
    if (section.title === "Réclamation et médiation") return {
      title: section.title,
      paragraphs: [
        "Toute réclamation préalable peut être adressée à lnx.beats.pro@gmail.com ou au 06 71 66 70 32.",
        consumerMediatorParagraph(),
      ],
    };
    return section;
  }),
);

export const finalMusicTermsCandidate = revision(
  phase4cMusicTermsCandidate,
  "music-cgv-2026-04-candidate",
  phase4cMusicTermsCandidate.sections.map((section) => {
    if (section.title === "1. Professionnel, objet et périmètre") return {
      title: section.title,
      paragraphs: [
        "Les présentes conditions encadrent les créations musicales personnalisées proposées par Ludovic Mickaël Mathon, entrepreneur individuel, sous le nom LNX Beats, via le service LNX STUDIO.",
        "La création musicale personnalisée est une prestation de services créatifs réalisée sur commande et donnant lieu à la livraison d’un contenu numérique. Elle n’emporte aucun transfert automatique de droits d’auteur ou d’exploitation.",
      ],
      decisions: section.decisions,
    };
    if (section.title === "2. Commande, brief et contenu fourni") return {
      title: section.title,
      paragraphs: [
        "Le client fournit un brief loyal, suffisamment précis et exploitable. Il garantit disposer des droits nécessaires sur les textes, images, sons et autres références transmis et s’interdit tout contenu illicite ou portant atteinte aux tiers.",
        "LNX Beats peut refuser ou suspendre une demande manifestement illicite, inexploitable ou contraire aux droits de tiers. Les fichiers de référence restent privés et sont conservés selon les durées indiquées dans la politique de confidentialité.",
      ],
    };
    if (section.title === "4. Formation, commencement et délai") return {
      title: section.title,
      paragraphs: [
        "La réalisation commence après confirmation du paiement et réception d’un brief exploitable. LNX Beats finalise la commande dans un délai de quatorze jours, sauf délai différent annoncé et accepté avant le commencement de la prestation.",
        "Si le client demande un commencement avant la fin du délai légal de rétractation, cette demande expresse est recueillie séparément, sans case précochée, avec la reconnaissance qu’il perdra son droit de rétractation après l’exécution complète de la prestation.",
        "Si le client exerce son droit de rétractation après le début de l’exécution mais avant son achèvement, le montant correspondant au service déjà fourni peut rester dû proportionnellement au prix convenu, lorsque les conditions légales sont réunies.",
      ],
    };
    if (section.title === "6. Rétractation et annulation") return {
      title: section.title,
      paragraphs: [
        "Le commencement de la prestation ne provoque pas une renonciation immédiate au droit de rétractation. La perte de ce droit ne peut intervenir qu’après exécution complète et lorsque la demande expresse et la reconnaissance requises ont été recueillies.",
        "En dehors des droits légaux applicables, d’une inexécution ou d’un défaut relevant de LNX Beats, aucun remboursement de convenance n’est prévu après le commencement de la création. Le consommateur peut utiliser la fonctionnalité en ligne de rétractation ; sa demande est instruite et ne déclenche aucun remboursement automatique.",
      ],
    };
    if (section.title === "7. Propriété intellectuelle et usages") return {
      title: section.title,
      paragraphs: [
        "Aucun transfert automatique de propriété, qualité d’auteur, quote-part, copropriété, droit SACEM ou licence commerciale n’est consenti par la commande personnelle.",
        "Toute publication, distribution, monétisation ou exploitation professionnelle nécessite un accord distinct conclu dans le cadre du parcours Droits & contrats.",
      ],
    };
    if (section.title === "8. Responsabilité, données et force majeure") return {
      title: section.title,
      paragraphs: [
        "Chaque partie répond de ses obligations dans les limites permises par la loi. Aucune clause ne prive le consommateur d’une garantie impérative. Les cas de force majeure sont appréciés conformément au droit applicable.",
        "Les données sont traitées conformément à la politique de confidentialité. Les données de carte et mots de passe PayPal ne sont jamais stockés par LNX STUDIO.",
      ],
    };
    if (section.title === "9. Réclamation, médiation, archivage et version") return {
      title: section.title,
      paragraphs: [
        "Une réclamation préalable peut être adressée à LNX Beats. En cas de désaccord persistant, le consommateur peut saisir gratuitement le CM2C selon les coordonnées indiquées dans les mentions légales.",
        "La commande conserve le numéro, le prix, la version et l’empreinte des conditions acceptées. Les factures, avoirs et pièces comptables sont conservés dix ans.",
      ],
    };
    return section;
  }),
);

export const finalShopTermsCandidate = revision(
  releaseBShopTermsCandidate,
  "shop-cgv-2026-05-candidate",
  releaseBShopTermsCandidate.sections.map((section) => {
    if (section.title === "2. Panier, stock et formation du contrat") return {
      title: section.title,
      paragraphs: section.paragraphs,
    };
    if (section.title === "3. Prix, TVA, livraison et total") return {
      title: section.title,
      paragraphs: [
        "Le prix applicable est celui affiché et accepté lors de la commande. Les quantités, le sous-total, les frais de livraison et le total sont calculés côté serveur et figés avant paiement.",
        "Le régime actuel est la franchise en base de TVA : aucune TVA n’est ajoutée et la facture porte la mention « TVA non applicable, article 293 B du CGI ». La facture est émise uniquement après confirmation effective du paiement.",
        "Au lancement, la livraison est limitée à la France métropolitaine. La préparation prend normalement deux à trois jours ouvrés après paiement confirmé, sauf délai particulier clairement annoncé sur la fiche produit.",
      ],
    };
    if (section.title === "5. Livraison, suivi et transfert des risques") return {
      title: section.title,
      paragraphs: [
        "La livraison est limitée à la France métropolitaine, Corse comprise, par Colissimo à domicile, avec signature privilégiée. La préparation LNX Beats de deux à trois jours ouvrés est distincte du délai indicatif du transporteur.",
        "Le transfert des risques intervient lors de la prise de possession physique, sous réserve des règles impératives. Le numéro de suivi est communiqué au client lorsqu’il est disponible.",
        "Les frais de livraison sont calculés d’après le poids des produits, avec un minimum facturable de 250 g. Le poids de l’emballage et de la protection n’est pas facturé. Le tarif applicable est indiqué et figé avant le paiement.",
      ],
      decisions: section.decisions,
    };
    if (section.title === "6. Réception, rétractation et retours") return {
      title: section.title,
      paragraphs: [
        "Le consommateur dispose en principe de quatorze jours à compter de la réception pour exercer son droit de rétractation. Pour une rétractation de convenance légalement possible, les frais directs de retour sont à sa charge lorsque cette information a été fournie avant la commande.",
        "Les CD audio sont expédiés scellés. Le droit de rétractation ne peut être exercé pour un enregistrement audio descellé par le consommateur après sa livraison. Tant que le produit demeure scellé, ce droit reste applicable dans les conditions légales.",
        "Cette exception ne limite jamais la garantie légale de conformité, la garantie des vices cachés ni les recours applicables à un produit défectueux, non conforme, erroné ou endommagé.",
        "Adresse de retour : LNX Beats, 35 Impasse des Orties, 07370 Ozon, France.",
      ],
    };
    if (section.title === "7. Garanties et service après-vente") return {
      title: section.title,
      paragraphs: [
        "Les biens bénéficient de la garantie légale de conformité et de la garantie des vices cachés dans les conditions prévues par la loi. Elles ne sont pas remplacées par une garantie commerciale.",
        "Le SAV, la non-conformité, l’erreur vendeur et le colis endommagé sont traités séparément d’une rétractation de convenance. Le client peut déposer un message SAV sans photographie ; toute photographie jointe reste facultative.",
      ],
    };
    if (section.title === "8. Réclamation, médiation, données et archivage") return {
      title: section.title,
      paragraphs: [
        "Après une réclamation préalable auprès de LNX Beats, le consommateur peut saisir gratuitement le CM2C selon les coordonnées indiquées dans les mentions légales.",
        "La Boutique est destinée aux particuliers au lancement. La commande et son snapshot contractuel sont archivés ; les factures, avoirs et pièces comptables sont conservés dix ans.",
      ],
    };
    return section;
  }),
);

export const finalPrivacyCandidate = revision(
  releaseBPrivacyCandidate,
  "privacy-2026-04-candidate",
  releaseBPrivacyCandidate.sections.map((section) => {
    if (section.title === "Données et finalités") return {
      title: section.title,
      paragraphs: [
        "Les traitements couvrent les comptes, sessions, commandes, briefs, références privées, livrables, produits, adresses de livraison et de facturation, paiements, factures, avoirs, notifications, contrats, rétractations, retours, réclamations et journaux de sécurité.",
        "Une demande SAV peut, au choix du client, comporter jusqu’à cinq photographies destinées à documenter un défaut, une non-conformité, une erreur ou un dommage. Elles ne sont pas requises pour déposer un message SAV.",
        "Les finalités sont les mesures précontractuelles, l’exécution, la preuve, la facturation, la livraison, le support, la sécurité et le respect des obligations légales. Un numéro de suivi est traité uniquement pour une commande expédiée.",
      ],
    };
    if (section.title === "Paiements et destinataires") return {
      title: section.title,
      paragraphs: [
        "LNX STUDIO ne stocke pas de numéro de carte complet, CVC ou mot de passe PayPal. Les données financières et de facturation sont limitées aux références, statuts, montants, devises, événements, factures, avoirs et remboursements nécessaires.",
        "Railway intervient pour l’hébergement, Cloudflare R2 pour le stockage des médias privés et publics, Resend pour les e-mails transactionnels, Stripe et PayPal pour les paiements, et OVHcloud pour le domaine et le DNS. Les informations nécessaires à la livraison sont transmises à La Poste/Colissimo lorsqu’une commande physique est expédiée.",
        "Les photographies SAV sont facultatives, stockées dans un espace privé Cloudflare R2 et accessibles uniquement au client concerné et aux administrateurs autorisés.",
      ],
    };
    if (section.title === "Transferts hors EEE") return {
      title: section.title,
      paragraphs: [
        "Certains prestataires internationaux sont susceptibles de traiter des données en dehors de l’Espace économique européen. Les lieux de traitement et garanties applicables dépendent du service concerné et de sa documentation contractuelle. Des informations complémentaires peuvent être demandées à LNX Beats à l’adresse indiquée dans la présente politique.",
      ],
      decisions: section.decisions,
    };
    return section;
  }),
);

export const finalWithdrawalNoticeCandidate = revision(
  phase4cWithdrawalNoticeCandidate,
  "withdrawal-2026-03-candidate",
  phase4cWithdrawalNoticeCandidate.sections.map((section) => {
    if (section.title === "Commencement anticipé d’une prestation") return {
      title: section.title,
      paragraphs: section.paragraphs,
    };
    if (section.title === "CD et autres enregistrements audio scellés") return {
      title: section.title,
      paragraphs: section.paragraphs,
    };
    if (section.title === "Accusé et sécurité") return {
      title: "Réception et traitement de la demande",
      paragraphs: [
        "La demande reçoit une référence et un accusé de réception consultable de manière sécurisée. Son éligibilité, les éventuelles exceptions, le retour et le remboursement sont examinés séparément.",
      ],
    };
    return section;
  }),
);

export const approvedLegalNotices = approvedRevision(
  finalLegalNoticesCandidate,
  "legal-notices-2026-04-approved",
);

export const approvedMusicTerms = approvedRevision(
  finalMusicTermsCandidate,
  "music-cgv-2026-04-approved",
);

export const approvedShopTerms = approvedRevision(
  finalShopTermsCandidate,
  "shop-cgv-2026-05-approved",
  finalShopTermsCandidate.sections.map((section) => section.title === "5. Livraison, suivi et transfert des risques" ? {
    title: section.title,
    paragraphs: [
      "La livraison est effectuée par Colissimo à domicile avec signature. Elle est limitée à la France métropolitaine, Corse comprise. La préparation LNX Beats de deux à trois jours ouvrés est distincte du délai indicatif du transporteur.",
      ...section.paragraphs.slice(1),
    ],
    decisions: section.decisions,
  } : section),
);

export const approvedPrivacyNotice = approvedRevision(
  finalPrivacyCandidate,
  "privacy-2026-04-approved",
);

export const approvedWithdrawalNotice = approvedRevision(
  finalWithdrawalNoticeCandidate,
  "withdrawal-2026-03-approved",
);

export const legalCandidates = Object.freeze([
  finalLegalNoticesCandidate,
  finalMusicTermsCandidate,
  finalShopTermsCandidate,
  finalPrivacyCandidate,
  finalWithdrawalNoticeCandidate,
]);

export const approvedLegalDocuments = Object.freeze([
  approvedLegalNotices,
  approvedMusicTerms,
  approvedShopTerms,
  approvedPrivacyNotice,
  approvedWithdrawalNotice,
]);

export const publicLegalDocuments = approvedLegalDocuments;

export const legalCandidateHistory = Object.freeze([
  legalNoticesCandidate,
  phase4bLegalNoticesCandidate,
  phase4b1LegalNoticesCandidate,
  finalLegalNoticesCandidate,
  musicTermsCandidate,
  phase4bMusicTermsCandidate,
  phase4cMusicTermsCandidate,
  finalMusicTermsCandidate,
  shopTermsCandidate,
  phase4bShopTermsCandidate,
  phase4cShopTermsCandidate,
  releaseBShopTermsCandidate,
  finalShopTermsCandidate,
  privacyCandidate,
  phase4bPrivacyCandidate,
  releaseBPrivacyCandidate,
  finalPrivacyCandidate,
  withdrawalNoticeCandidate,
  phase4cWithdrawalNoticeCandidate,
  finalWithdrawalNoticeCandidate,
  approvedLegalNotices,
  approvedMusicTerms,
  approvedShopTerms,
  approvedPrivacyNotice,
  approvedWithdrawalNotice,
]);

export function assertCandidateLegalRegistry() {
  for (const document of legalCandidates) {
    if (document.status !== "DRAFT" && document.status !== "AWAITING_LEGAL_REVIEW") {
      throw new Error("Phase 4 legal documents must remain non-active candidates.");
    }
    if (document.effectiveAt || document.approvedAt || document.approvedBy) {
      throw new Error("Phase 4 legal documents cannot carry activation or approval evidence.");
    }
  }
  return legalCandidates;
}

export function assertApprovedLegalRegistry() {
  for (const document of approvedLegalDocuments) {
    if (document.status !== "APPROVED") {
      throw new Error("Final legal documents must be approved.");
    }
    if (!document.approvedAt || !document.approvedBy || !document.legalReviewReference) {
      throw new Error("Approved legal documents require complete human approval evidence.");
    }
    if (document.effectiveAt !== null) {
      throw new Error("Approved legal documents cannot become active without a separate activation step.");
    }
  }
  return approvedLegalDocuments;
}
