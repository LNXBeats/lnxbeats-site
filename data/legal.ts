import { createHash } from "node:crypto";

export type LegalCandidateStatus = "DRAFT" | "AWAITING_LEGAL_REVIEW";

export type LegalDecision = Readonly<{
  category: "LEGAL_DECISION_REQUIRED" | "ACCOUNTING_DECISION_REQUIRED" | "LOGISTICS_DECISION_REQUIRED" | "SOURCE_RECHECK_REQUIRED";
  code: string;
}>;

export type LegalSection = Readonly<{
  title: string;
  paragraphs: readonly string[];
  decisions?: readonly LegalDecision[];
}>;

export type LegalCandidate = Readonly<{
  type: "LEGAL_NOTICES" | "MUSIC_TERMS" | "SHOP_TERMS" | "PRIVACY_NOTICE" | "WITHDRAWAL_NOTICE";
  version: string;
  title: string;
  status: LegalCandidateStatus;
  createdAt: string;
  effectiveAt: null;
  approvedBy: null;
  approvedAt: null;
  sections: readonly LegalSection[];
  hashSha256: string;
}>;

function candidate(input: Omit<LegalCandidate, "hashSha256">): LegalCandidate {
  return Object.freeze({
    ...input,
    hashSha256: createHash("sha256").update(JSON.stringify(input), "utf8").digest("hex"),
  });
}

const createdAt = "2026-08-28T00:00:00.000Z";

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

export const legalCandidates = Object.freeze([
  legalNoticesCandidate,
  musicTermsCandidate,
  shopTermsCandidate,
  privacyCandidate,
  withdrawalNoticeCandidate,
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
