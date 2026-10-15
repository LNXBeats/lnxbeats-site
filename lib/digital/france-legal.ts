import { createHash } from "node:crypto";
import { approvedLegalNotices, approvedWithdrawalNotice, consumerMediatorInformation } from "@/data/legal";
import { digitalMusicTermsDraft, DIGITAL_MUSIC_TERMS_DRAFT_TEXT_HASH } from "./digital-legal";

/** Separate proposal. Importing this file never approves terms, tax or a territory. */
export const DIGITAL_FRANCE_TERMS_VERSION = "digital-music-france-cgv-20261015-draft-01";
export const DIGITAL_FRANCE_IMMEDIATE_SUPPLY_DRAFT = "Je demande expressément que la fourniture des contenus numériques commandés commence avant la fin du délai de rétractation de quatorze jours.";
export const DIGITAL_FRANCE_WITHDRAWAL_ACKNOWLEDGEMENT_DRAFT = "Je reconnais que je perdrai mon droit de rétractation lorsque la fourniture aura commencé, après mon consentement exprès et la confirmation de cet accord sur un support durable. Mes garanties légales restent applicables.";

export const DIGITAL_FRANCE_PROPOSED_SCOPE = Object.freeze({
  marketCode: "FR-MET", marketCodeIsInternal: true, countryCode: "FR", customerType: "B2C",
  description: "France métropolitaine, Corse comprise — périmètre commercial retenu par LNX Beats, mise en œuvre soumise au contrôle juridique",
  excludes: Object.freeze(["OVERSEAS", "FOREIGN_MARKETS", "B2B"]),
  commercialScopeUserConfirmed: true, legalGeographicRestrictionApproved: false, approvedForLive: false,
});
export const DIGITAL_FRANCE_COMMERCIAL_DECISIONS = Object.freeze({
  provenance: "USER_CONFIRMED" as const, privateUseOnly: true, separatePublicOrCommercialAuthorisationRequired: true,
  collaborationRightsVerifiedBeforeSale: true, collaborationProofsPrivateAdminOnly: true,
  changeOfMindRefundIndividualReview: true, automaticCommercialRefundAfterValidImmediateSupply: false,
  mandatoryConsumerRightsPreserved: true, legallyApproved: false,
});

const seller = approvedLegalNotices.sections.find(section => section.title === "Éditeur du service");
if (!seller || seller.paragraphs.length < 3) throw new Error("Existing approved seller identity is required.");
const sellerParagraphs = Object.freeze(seller.paragraphs.slice(0, 3));
const mediator = consumerMediatorInformation;
const references = Object.freeze({
  seller: Object.freeze({ version: approvedLegalNotices.version, hashSha256: approvedLegalNotices.hashSha256 }),
  withdrawalInformation: Object.freeze({ version: approvedWithdrawalNotice.version, hashSha256: approvedWithdrawalNotice.hashSha256, informationPath: "/retractation" }),
  previousDigitalDraft: Object.freeze({ version: digitalMusicTermsDraft.version, hashSha256: digitalMusicTermsDraft.hashSha256, textHashSha256: DIGITAL_MUSIC_TERMS_DRAFT_TEXT_HASH }),
});

const sections = [
  { title: "1. Vendeur et objet", paragraphs: [
    "BROUILLON DE REVUE — ces conditions ne sont pas encore approuvées pour une vente réelle. Elles concernent uniquement la musique du catalogue fournie par téléchargement à des particuliers. Elles ne remplacent pas les conditions approuvées des créations sur commande, de la Boutique physique, des licences d’exploitation ou du soutien.",
    ...sellerParagraphs,
    "Le professionnel désigné ci-dessus répond de la fourniture et des garanties légales. Ses coordonnées servent aussi aux demandes de service après-vente, de conformité et de rétractation. Les mentions légales existantes restent consultables à /mentions-legales.",
  ] },
  { title: "2. Périmètre de lancement retenu", paragraphs: [
    "Le périmètre commercial retenu par LNX Beats concerne les particuliers résidant et facturés en France métropolitaine, Corse comprise. Cette décision de lancement est confirmée ; sa mise en œuvre reste soumise au contrôle juridique. Les marchés d’outre-mer, étrangers et professionnels ne sont pas ouverts par ce brouillon. FR-MET est seulement un code de marché interne : ce n’est pas un code pays officiel ni une autorisation générale de la France.",
    "Les modalités de cette limitation commerciale doivent être vérifiées au regard des règles françaises et européennes de non-discrimination et de géoblocage, sans redemander la décision commerciale déjà prise. L’exception visant certains contenus protégés par le droit d’auteur ne dispense pas automatiquement de toutes ces règles. Ce document n’approuve pas une interdiction générale fondée sur la résidence.",
    "Le catalogue reste consultable sans filtrage par nationalité ou adresse IP. Les informations territoriales demandées au paiement doivent être exactes et limitées à ce qui est nécessaire ; ni la nationalité, ni le seul pays d’une carte bancaire ne déterminent l’accès au catalogue ou une décision d’achat.",
  ] },
  { title: "3. Musique, formats et compatibilité", paragraphs: [
    "La fiche présente les titres, la composition exacte de l’album, les versions et les caractéristiques essentielles disponibles avant la commande. Un inédit peut être vendu sans distribution préalable sur une plateforme externe, sous réserve des droits nécessaires.",
    "Une œuvre ou un master réalisé en collaboration ne peut être proposé à la vente qu’après vérification des droits nécessaires sur l’œuvre, l’enregistrement, les contributions, samples et interventions concernés. Les justificatifs restent privés dans l’Admin ; un état de droits non validé bloque la commercialisation. L’historique des preuves et décisions est conservé.",
    "Chaque titre acquis comprend son fichier WAV et son fichier MP3, sans supplément lié au format. L’album acquis comprend les fichiers individuels des titres qui le composent et deux archives distinctes : ZIP WAV et ZIP MP3. Le nombre de titres est celui annoncé et enregistré lors de l’achat ; aucun nombre fixe de pistes n’est promis pour tous les albums.",
    "Les extraits publics, distincts des fichiers complets, ne dépassent pas soixante secondes. Un navigateur ou lecteur compatible WAV/MP3, une connexion Internet et un espace de stockage suffisant sont nécessaires ; les ZIP doivent être décompressés. Les caractéristiques utiles du WAV, du MP3 et les éventuelles restrictions sont présentées avant l’achat. Aucun abonnement de streaming n’est requis pour lire un fichier déjà téléchargé.",
  ] },
  { title: "4. Compte, prix et commande", paragraphs: [
    "L’achat nécessite un compte actif et une adresse e-mail vérifiée. Le panier numérique est distinct du panier physique : aucun transport, stock physique ou produit matériel n’est ajouté par l’achat de musique téléchargeable.",
    "Les prix de chaque titre et de chaque album sont fixés librement par LNX Beats, indépendamment les uns des autres. Le client ne choisit pas un montant libre : il accepte le prix récapitulé avant paiement. Aucun tarif de lancement n’est fixé par ce brouillon ; les montants de démonstration restent fictifs.",
    "Avant de confirmer la commande avec obligation de paiement, le client peut vérifier et corriger son panier. Le récapitulatif indique le total en euros, le crédit de complément éventuel et la présentation fiscale applicable après validation. Aucun taux de TVA, exemption ou mention fiscale du nouveau commerce numérique n’est approuvé par les présentes conditions.",
    "Une évolution ultérieure du prix ou du catalogue ne modifie pas une acquisition déjà confirmée. Si le prix ou le contenu change avant confirmation, le serveur recalcule le devis ; le client doit accepter le nouveau récapitulatif avant tout nouvel engagement.",
  ] },
  { title: "5. Compléter un album", paragraphs: [
    "Pour les titres admissibles déjà acquis séparément, le complément déduit uniquement les sommes réellement payées et non remboursées attribuables à ces titres. Les prix d’origine peuvent différer, notamment en présence de promotions historiques ; les prix courants des titres ne remplacent pas la preuve de la somme payée.",
    "Le récapitulatif présente le prix actuel de l’album, les titres pris en compte, les crédits retenus et le solde. Une même acquisition ne peut servir deux fois ; les engagements concurrents et remboursements sont contrôlés côté serveur. Les calculs utilisent les centimes exacts, sans crédit réutilisable ni remise rétroactive implicite sur les achats précédents.",
    "Un album déjà acquis n’est pas facturé une seconde fois. Si les titres sont possédés séparément, le devis vérifie les versions et la composition ; un changement de master, un contenu non admissible, une preuve ambiguë ou un solde nul ou négatif ne déclenche aucun paiement automatique et nécessite une revue. L’évolution future d’un album n’est pas incluse rétroactivement.",
  ] },
  { title: "6. Paiement, confirmation et fourniture", paragraphs: [
    "Stripe et PayPal interviennent comme prestataires de paiement, sans devenir automatiquement vendeurs de la musique. Seule une confirmation vérifiée côté serveur, concordante sur le montant, la devise, le compte marchand et les références, permet de confirmer le règlement. Un retour navigateur, une approbation ou une URL de succès ne prouve pas un encaissement.",
    "Après confirmation du règlement, LNX Beats remet sur un support durable la confirmation contractuelle avec les contenus et versions acquis, les présentes conditions dans leur version acceptée, le prix et les consentements recueillis. Les e-mails transactionnels et documents téléchargeables sont distincts des communications marketing. La facture et les éventuels avoirs sont conservés dans Ma musique, sans réécriture des factures antérieures.",
    "La fourniture immédiate n’est engagée qu’après le recueil séparé des choix requis et la remise de leur confirmation durable. L’accès aux fichiers est accordé dans la bibliothèque après les contrôles serveur et l’étape explicite de commencement prévue au parcours. La définition exacte de cette étape et de sa preuve reste à approuver pour ce lancement.",
    DIGITAL_FRANCE_IMMEDIATE_SUPPLY_DRAFT, DIGITAL_FRANCE_WITHDRAWAL_ACKNOWLEDGEMENT_DRAFT,
  ] },
  { title: "7. Rétractation", paragraphs: [
    "Pour ce contrat de contenu numérique sans support matériel, le consommateur dispose en principe de quatorze jours à compter de la conclusion du contrat pour notifier sa rétractation, sans avoir à donner de motif.",
    "L’exception de l’article L. 221-28, 13° du Code de la consommation ne s’applique que si la fourniture a commencé avant la fin de ce délai, après le consentement exprès préalable du client, sa reconnaissance de la perte de son droit et la confirmation de cet accord sur un support durable conformément à l’article L. 221-13. L’acceptation des CGV ou le seul paiement ne remplace pas ces conditions cumulatives. Si elles ne sont pas réunies, la perte du droit n’est pas présumée.",
    "Le client peut adresser une déclaration non ambiguë au contact postal ou électronique du vendeur, en identifiant le contrat et son nom. Il peut utiliser le modèle joint, sans y être obligé. Les informations et le formulaire existants sont accessibles à /retractation ; leur prise en charge explicite des achats numériques doit être raccordée et vérifiée avant ouverture, et n’est pas présentée ici comme déjà opérationnelle.",
    "Lorsqu’une rétractation valable est exercée, les sommes dues sont remboursées sans retard injustifié et au plus tard quatorze jours après notification, par le même moyen de paiement sauf accord exprès sur un autre moyen sans frais. Aucune clause générale de non-remboursement n’est opposée. Les garanties légales demeurent applicables même lorsque l’exception au droit de rétractation est acquise.",
  ] },
  { title: "8. Licence personnelle et versions", paragraphs: [
    "La licence retenue par LNX Beats autorise exclusivement l’écoute, le téléchargement et la conservation des fichiers acquis pour un usage privé. Elle n’autorise aucune diffusion publique, redistribution, publication, synchronisation, monétisation ou exploitation commerciale. Ces utilisations nécessitent des autorisations spécifiques séparées. Aucun droit d’auteur ou droit voisin n’est cédé. Les usages et droits résultant de dispositions impératives restent préservés ; la rédaction contractuelle est encore soumise à revue juridique.",
    "Les fichiers et la composition acquis sont figés au moment de l’achat. Un nouveau master, une réédition ou un remaster n’est pas ajouté automatiquement. Cette conservation ne supprime pas l’obligation de remédier à une non-conformité ni de fournir les mises à jour légalement nécessaires.",
    "Les liens privés temporaires peuvent être renouvelés ; tant que le service de bibliothèque fonctionne et que les droits concernés restent actifs, aucune limite arbitraire du nombre de re-téléchargements n’est imposée. Le client est invité à conserver ses fichiers. Il n’est pas promis un hébergement perpétuel ; une fin de service doit préserver les droits impératifs et faire l’objet de modalités validées avant lancement.",
  ] },
  { title: "9. Garanties légales des contenus numériques — encadré de revue", paragraphs: [
    "Pour un contenu fourni en une fois, LNX Beats répond des défauts de conformité présents lors de la fourniture et apparaissant dans les deux ans qui la suivent. Le défaut apparu pendant les douze premiers mois est présumé exister lors de la fourniture, sauf preuve contraire. Ces deux durées ne doivent pas être confondues.",
    "Le consommateur peut demander une mise en conformité sans frais, sans retard injustifié et sans inconvénient majeur. Dans les cas prévus par la loi, notamment impossibilité, refus ou absence de correction appropriée, il peut demander une réduction du prix ou la résolution du contrat. L’appréciation d’un défaut mineur et les modalités des remboursements suivent les règles légales, non une exclusion générale des remboursements.",
    "Les corrections et mises à jour nécessaires au maintien de la conformité restent dues selon les règles applicables ; elles sont distinctes d’une nouvelle édition artistique commerciale. Les autres garanties impératives, dont celle des vices cachés lorsqu’elle s’applique, ne sont pas écartées.",
    "Ce résumé doit être relu et complété par l’encadré réglementaire applicable à une fourniture ponctuelle, prévu à l’article D. 211-3 et son annexe, dans la mise en forme finale des CGV. Il n’est pas présenté comme une reproduction certifiée de cet encadré. Pour toute demande, utiliser les coordonnées du vendeur indiquées au début du document.",
  ] },
  { title: "10. Remboursements, documents et incidents", paragraphs: [
    "Une demande de remboursement pour un simple changement d’avis fait l’objet d’un examen individuel. Lorsque la fourniture immédiate a légalement entraîné la perte du droit de rétractation, aucun remboursement commercial automatique n’est accordé pour ce seul motif. Cette politique ne limite ni le droit de rétractation lorsqu’il subsiste, ni les garanties légales, ni aucun autre remboursement ou recours imposé par la loi.",
    "Un remboursement confirmé est rattaché à l’achat concerné et donne lieu au justificatif et à l’avoir appropriés ; le paiement initial, la facture et l’historique restent conservés. Une réduction de prix ne vaut pas automatiquement résolution ni retrait de tous les droits.",
    "En cas de résolution, les conséquences sur la licence et les nouveaux téléchargements des contenus concernés sont appliquées selon les règles légales et les droits effectivement affectés. Les autres achats ne sont pas supprimés. Une contestation ou contradiction de paiement est examinée et tracée ; elle ne justifie pas une double capture, un remboursement improvisé ni une suppression des preuves.",
  ] },
  { title: "11. Réclamation, médiation et règlement des litiges", paragraphs: [
    "Une réclamation préalable peut être adressée aux coordonnées professionnelles indiquées ci-dessus. Le consommateur conserve ses recours judiciaires et les protections impératives applicables ; aucune compétence exclusive au siège du vendeur n’est imposée par ce brouillon.",
    `Après cette démarche préalable, le consommateur peut recourir gratuitement au ${mediator.name}, ${mediator.addressLines.join(", ")} — ${mediator.phone} — ${mediator.website}, dans les conditions d’admissibilité de la médiation.`,
    "CM2C est déjà le médiateur désigné de LNX Beats : aucune nouvelle adhésion n’est proposée. La couverture du nouveau téléchargement numérique doit être confirmée dans la convention existante si nécessaire. Aucune ancienne plateforme européenne de règlement en ligne devenue indisponible n’est présentée comme un recours actuel.",
  ] },
  { title: "Annexe — modèle de notification de rétractation", paragraphs: [
    "À l’attention du vendeur et aux coordonnées indiquées au début de ces conditions : je vous notifie ma rétractation du contrat portant sur le téléchargement musical suivant : [titre ou album et référence de commande].",
    "Commande conclue le : [date]. Nom du consommateur : [nom]. Adresse du consommateur : [adresse]. Date de la déclaration : [date]. Signature uniquement si ce modèle est remis sur papier.",
    "Envoyer ce modèle seulement lorsque vous souhaitez exercer le droit de rétractation applicable. Vous pouvez aussi utiliser toute déclaration non ambiguë. L’accusé de réception de la demande ne préjuge pas de son éligibilité et ne remplace pas le remboursement lorsqu’il est dû.",
  ] },
] as const;

const payload = Object.freeze({
  type: "DIGITAL_MUSIC_TERMS_FRANCE" as const, version: DIGITAL_FRANCE_TERMS_VERSION,
  title: "Conditions de vente de musique numérique — France métropolitaine et Corse — brouillon de revue",
  status: "DRAFT" as const, createdAt: "2026-10-15T00:00:00.000Z", effectiveAt: null, approvedAt: null, approvedBy: null,
  legalReviewReference: null, fiscalReviewReference: null, approvedForLive: false, userApprovalRecorded: false, userApprovalScope: "TERMS_TEXT_ONLY" as const,
  proposedScope: DIGITAL_FRANCE_PROPOSED_SCOPE, commercialDecisions: DIGITAL_FRANCE_COMMERCIAL_DECISIONS, existingProofReferences: references,
  sections: Object.freeze(sections.map(section => Object.freeze({ title: section.title, paragraphs: Object.freeze([...section.paragraphs]) }))),
  reviewRequired: Object.freeze(["FR_DIGITAL_TERMS_LEGAL_REVIEW", "FR_GEOGRAPHIC_RESTRICTION_NON_DISCRIMINATION", "FR_DIGITAL_TAX_AND_INVOICE_WORDING",
    "FR_DIGITAL_WITHDRAWAL_ONLINE_ROUTE", "FR_IMMEDIATE_SUPPLY_AND_DURABLE_CONFIRMATION", "FR_D211_3_STATUTORY_GUARANTEE_BOX",
    "FR_LICENSE_AND_SERVICE_END", "CM2C_EXISTING_CONVENTION_DIGITAL_SCOPE", "FR_REAL_PRICES_AND_COMPLETION_POLICY"]),
});

export const digitalFranceTermsDraft = Object.freeze({ ...payload, hashSha256: createHash("sha256").update(JSON.stringify(payload), "utf8").digest("hex") });
export const DIGITAL_FRANCE_TERMS_TEXT = digitalFranceTermsDraft.sections.map(section => `${section.title}\n${section.paragraphs.join("\n")}`).join("\n\n");
export const DIGITAL_FRANCE_TERMS_TEXT_HASH = createHash("sha256").update(DIGITAL_FRANCE_TERMS_TEXT, "utf8").digest("hex");
