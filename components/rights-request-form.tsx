"use client";

import { T, useSiteLanguage } from "@/components/site-language";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";

import { rightsOffers, rightsPlatforms, type RightsOfferType } from "@/data/rights-offer";
import { OriginalName } from "@/components/original-name";

const platformLabels = {
  SPOTIFY: "Spotify",
  APPLE_MUSIC: "Apple Music",
  DEEZER: "Deezer",
  YOUTUBE: "YouTube",
  AMAZON_MUSIC: "Amazon Music",
  TIKTOK: "TikTok",
  INSTAGRAM: "Instagram",
  OTHER: "Autres",
} as const;

const contributionLabels = {
  NONE: "Aucune contribution créative",
  STORY_BRIEF_ONLY: "Histoire / brief uniquement",
  LYRICS_FULL: "Paroles entièrement fournies",
  LYRICS_PARTIAL: "Paroles partiellement fournies",
  LYRICS_CO_WRITTEN: "Paroles coécrites",
  MELODY: "Mélodie fournie",
  MUSICAL_COMPOSITION: "Composition musicale",
  ARRANGEMENT: "Arrangement",
  INSTRUMENTAL: "Instrumental",
  ARTISTIC_DIRECTION: "Direction artistique",
  VOICE: "Voix",
  MIX_MASTER: "Mix / master",
  INSTRUMENTS: "Instruments",
  PRODUCTION: "Production",
  OTHER: "Autre contribution",
} as const;

type Props = {
  type: RightsOfferType;
  orderNumber: string;
  orderTitle: string;
  account: { firstName: string; lastName: string; artistName: string; email: string };
};

export function RightsRequestForm({ type, orderNumber, orderTitle, account }: Props) {
  const { t, money } = useSiteLanguage();
  const router = useRouter();
  const partnership = type === "EXPLOITATION_PARTNERSHIP";
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [party, setParty] = useState({
    partyType: "INDIVIDUAL",
    firstName: account.firstName,
    lastName: account.lastName,
    artistName: account.artistName,
    companyName: "",
    legalForm: "",
    legalRepresentative: "",
    streetAddress: "",
    postalCode: "",
    city: "",
    country: "FR",
    siret: "",
    vatNumber: "",
    contractEmail: account.email,
    phone: "",
  });
  const [project, setProject] = useState({
    workTitle: orderTitle,
    publicationName: orderTitle,
    artistName: account.artistName || account.firstName,
    distributor: "",
    platforms: ["SPOTIFY"] as string[],
    otherPlatforms: "",
    targetDate: "",
    monetized: false,
    territory: "Monde entier",
    duration: "5 ans",
    clips: "",
    socialNetworks: "",
    advertising: false,
    contentId: false,
    modifications: "",
    credits: "",
  });
  const [contribution, setContribution] = useState({ kind: "STORY_BRIEF_ONLY", description: "J’ai fourni l’histoire et les intentions du projet.", claimedPercentage: "", evidenceNote: "" });
  const [study, setStudy] = useState({
    lyricsAuthor: "",
    lyricsProvided: "",
    lyricRewrites: "",
    lyricsClaimedPercentage: "",
    melody: "",
    harmony: "",
    structure: "",
    arrangement: "",
    instrumental: "",
    compositionClaimedPercentage: "",
    artisticDirection: "",
    voice: "",
    mixMaster: "",
    instruments: "",
    production: "",
    toolsUsed: "",
    aiKnown: false,
    humanCreativeContribution: "",
    sacemMember: false,
    sacemIdentifier: "",
    otherCollective: "",
    relatedWorks: "",
    desiredSplit: "",
  });
  const price = rightsOffers.PUBLICATION_LICENSE.priceCents;
  const partyIsIndividual = party.partyType === "INDIVIDUAL" || party.partyType === "SOLE_PROPRIETOR";
  const steps = useMemo(() => ["Coordonnées", "Projet", "Contributions", "Vérification"], []);

  function setPartyField(field: string, value: string) { setParty((current) => ({ ...current, [field]: value })); }
  function setProjectField(field: string, value: string | boolean | string[]) { setProject((current) => ({ ...current, [field]: value })); }
  function setStudyField(field: string, value: string | boolean) { setStudy((current) => ({ ...current, [field]: value })); }
  function togglePlatform(platform: string) {
    setProject((current) => ({
      ...current,
      platforms: current.platforms.includes(platform) ? current.platforms.filter((item) => item !== platform) : [...current.platforms, platform],
    }));
  }

  function validateStep() {
    if (step === 0 && (!party.streetAddress || !party.postalCode || !party.city || !party.contractEmail || (partyIsIndividual ? !party.firstName || !party.lastName : !party.companyName || !party.legalRepresentative))) {
      setError("Complétez les coordonnées contractuelles obligatoires.");
      return false;
    }
    if (step === 1 && (!project.workTitle || !project.artistName || !project.platforms.length || !project.territory || !project.duration)) {
      setError("Complétez l’identité du projet, les plateformes, le territoire et la durée souhaitée.");
      return false;
    }
    if (step === 2 && (!contribution.description || (partnership && (!study.lyricsAuthor || !study.lyricsProvided || !study.toolsUsed || !study.humanCreativeContribution)))) {
      setError("Décrivez précisément les contributions et l’apport créatif humain.");
      return false;
    }
    setError("");
    return true;
  }

  async function submit() {
    if (!validateStep()) return;
    setBusy(true);
    setError("");
    try {
      const body = {
        type,
        party,
        project,
        contributions: [{ ...contribution, claimedPercentage: contribution.claimedPercentage ? Number(contribution.claimedPercentage) : null }],
        partnership: partnership ? { ...study, lyricsClaimedPercentage: study.lyricsClaimedPercentage ? Number(study.lyricsClaimedPercentage) : null, compositionClaimedPercentage: study.compositionClaimedPercentage ? Number(study.compositionClaimedPercentage) : null } : null,
      };
      const response = await fetch(`/api/orders/${encodeURIComponent(orderNumber)}/rights`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({})) as { request?: { requestNumber: string }; error?: string };
      if (!response.ok || !payload.request) throw new Error(payload.error ?? "La demande n’a pas pu être enregistrée.");
      router.push(`/compte/droits/${encodeURIComponent(payload.request.requestNumber)}/verifier`);
      router.refresh();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "La demande n’a pas pu être enregistrée.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rights-form">
      <nav className="rights-form__progress" aria-label={t("Progression de la demande")}>
        {steps.map((label, index) => <button type="button" key={t(label)} aria-current={step === index ? "step" : undefined} className={index <= step ? "is-active" : ""} disabled={index > step || busy} onClick={() => setStep(index)}>{index + 1}. {t(label)}</button>)}
      </nav>
      <header className="rights-form__header">
        <p className="eyebrow">{partnership ? <T text="Partenariat d’exploitation" /> : <T text="Licence de publication" />}</p>
        <h1>{partnership ? <T text="Étudier un projet de droits partagé." /> : <T text="Préparer votre demande de publication." />}</h1>
        <p><T text="Commande" />{" "}{orderNumber} <T text="· montant cible futur" />{" "}{money(price)} <T text="· aucun paiement à cette étape." /></p>
      </header>

      {step === 0 ? <section aria-labelledby="rights-party-title">
        <h2 id="rights-party-title"><T text="Coordonnées contractuelles" /></h2>
        <p><T text="Ces données sont privées et distinctes de votre profil public. Aucune pièce d’identité n’est demandée." /></p>
        <div className="field"><label htmlFor="rights-party-type"><T text="Type de partie" /></label><select id="rights-party-type" value={party.partyType} onChange={(event) => setPartyField("partyType", event.target.value)}><option value="INDIVIDUAL">{t("Particulier")}</option><option value="SOLE_PROPRIETOR">{t("Entrepreneur individuel")}</option><option value="COMPANY">{t("Société")}</option><option value="ASSOCIATION_OR_OTHER">{t("Association / autre personne morale")}</option></select></div>
        {partyIsIndividual ? <div className="field-grid"><div className="field"><label htmlFor="rights-first-name"><T text="Prénom *" /></label><input id="rights-first-name" required maxLength={100} value={party.firstName} onChange={(event) => setPartyField("firstName", event.target.value)} /></div><div className="field"><label htmlFor="rights-last-name"><T text="Nom *" /></label><input id="rights-last-name" required maxLength={100} value={party.lastName} onChange={(event) => setPartyField("lastName", event.target.value)} /></div></div> : <><div className="field"><label htmlFor="rights-company"><T text="Raison sociale *" /></label><input id="rights-company" required maxLength={240} value={party.companyName} onChange={(event) => setPartyField("companyName", event.target.value)} /></div><div className="field-grid"><div className="field"><label htmlFor="rights-legal-form"><T text="Forme juridique" /></label><input id="rights-legal-form" maxLength={120} value={party.legalForm} onChange={(event) => setPartyField("legalForm", event.target.value)} /></div><div className="field"><label htmlFor="rights-representative"><T text="Représentant légal *" /></label><input id="rights-representative" required maxLength={200} value={party.legalRepresentative} onChange={(event) => setPartyField("legalRepresentative", event.target.value)} /></div></div></>}
        <div className="field"><label htmlFor="rights-artist-name"><T text="Nom d’artiste" /></label><input id="rights-artist-name" maxLength={180} value={party.artistName} onChange={(event) => setPartyField("artistName", event.target.value)} /></div>
        <div className="field"><label htmlFor="rights-address"><T text="Adresse / siège *" /></label><input id="rights-address" required maxLength={300} value={party.streetAddress} onChange={(event) => setPartyField("streetAddress", event.target.value)} /></div>
        <div className="field-grid"><div className="field"><label htmlFor="rights-postal"><T text="Code postal *" /></label><input id="rights-postal" required maxLength={24} value={party.postalCode} onChange={(event) => setPartyField("postalCode", event.target.value)} /></div><div className="field"><label htmlFor="rights-city"><T text="Ville *" /></label><input id="rights-city" required maxLength={140} value={party.city} onChange={(event) => setPartyField("city", event.target.value)} /></div><div className="field"><label htmlFor="rights-country"><T text="Pays (ISO) *" /></label><input id="rights-country" required maxLength={2} value={party.country} onChange={(event) => setPartyField("country", event.target.value.toUpperCase())} /></div></div>
        {!partyIsIndividual ? <div className="field-grid"><div className="field"><label htmlFor="rights-siret">SIRET</label><input id="rights-siret" inputMode="numeric" maxLength={14} value={party.siret} onChange={(event) => setPartyField("siret", event.target.value)} /></div><div className="field"><label htmlFor="rights-vat"><T text="Numéro de TVA" /></label><input id="rights-vat" maxLength={32} value={party.vatNumber} onChange={(event) => setPartyField("vatNumber", event.target.value)} /></div></div> : null}
        <div className="field-grid"><div className="field"><label htmlFor="rights-email"><T text="E-mail contractuel *" /></label><input id="rights-email" required type="email" maxLength={320} value={party.contractEmail} onChange={(event) => setPartyField("contractEmail", event.target.value)} /></div><div className="field"><label htmlFor="rights-phone"><T text="Téléphone" /></label><input id="rights-phone" type="tel" maxLength={40} value={party.phone} onChange={(event) => setPartyField("phone", event.target.value)} /></div></div>
      </section> : null}

      {step === 1 ? <section aria-labelledby="rights-project-title"><h2 id="rights-project-title"><T text="Identité et exploitation envisagée" /></h2>
        <div className="field-grid"><div className="field"><label htmlFor="rights-work-title"><T text="Titre de la création *" /></label><input id="rights-work-title" required maxLength={240} value={project.workTitle} onChange={(event) => setProjectField("workTitle", event.target.value)} /></div><div className="field"><label htmlFor="rights-publication-name"><T text="Nom de publication" /></label><input id="rights-publication-name" maxLength={240} value={project.publicationName} onChange={(event) => setProjectField("publicationName", event.target.value)} /></div><div className="field"><label htmlFor="rights-project-artist"><T text="Nom d’artiste *" /></label><input id="rights-project-artist" required maxLength={180} value={project.artistName} onChange={(event) => setProjectField("artistName", event.target.value)} /></div><div className="field"><label htmlFor="rights-distributor"><T text="Distributeur envisagé" /></label><input id="rights-distributor" maxLength={180} value={project.distributor} onChange={(event) => setProjectField("distributor", event.target.value)} /></div></div>
        <fieldset className="fieldset"><legend><T text="Plateformes souhaitées *" /></legend><div className="choice-grid">{rightsPlatforms.map((platform) => <label className="choice" key={platform}><input type="checkbox" checked={project.platforms.includes(platform)} onChange={() => togglePlatform(platform)} /><span>{t(platformLabels[platform])}</span></label>)}</div></fieldset>
        {project.platforms.includes("OTHER") ? <div className="field"><label htmlFor="rights-other-platforms"><T text="Autres plateformes *" /></label><input id="rights-other-platforms" required maxLength={500} value={project.otherPlatforms} onChange={(event) => setProjectField("otherPlatforms", event.target.value)} /></div> : null}
        <div className="field-grid"><div className="field"><label htmlFor="rights-target-date"><T text="Date envisagée" /></label><input id="rights-target-date" type="date" value={project.targetDate} onChange={(event) => setProjectField("targetDate", event.target.value)} /></div><div className="field"><label htmlFor="rights-territory"><T text="Territoire contractuel" /></label><input id="rights-territory" readOnly value={t(project.territory)} /></div><div className="field"><label htmlFor="rights-duration"><T text="Durée contractuelle" /></label><input id="rights-duration" readOnly value={t(project.duration)} /></div></div>
        <div className="choice-grid"><label className="choice"><input type="checkbox" checked={project.monetized} onChange={(event) => setProjectField("monetized", event.target.checked)} /><span><T text="Exploitation monétisée envisagée" /></span></label><label className="choice"><input type="checkbox" checked={project.advertising} onChange={(event) => setProjectField("advertising", event.target.checked)} /><span><T text="Publicité / sponsoring envisagé" /></span></label><label className="choice"><input type="checkbox" checked={project.contentId} onChange={(event) => setProjectField("contentId", event.target.checked)} /><span><T text="Content ID envisagé" /></span></label></div>
        <div className="field"><label htmlFor="rights-clips"><T text="Clips / vidéos envisagés" /></label><textarea id="rights-clips" maxLength={1000} value={project.clips} onChange={(event) => setProjectField("clips", event.target.value)} /></div><div className="field"><label htmlFor="rights-social"><T text="Réseaux sociaux" /></label><textarea id="rights-social" maxLength={1000} value={project.socialNetworks} onChange={(event) => setProjectField("socialNetworks", event.target.value)} /></div><div className="field"><label htmlFor="rights-modifications"><T text="Modifications du morceau envisagées" /></label><textarea id="rights-modifications" maxLength={2000} value={project.modifications} onChange={(event) => setProjectField("modifications", event.target.value)} /></div><div className="field"><label htmlFor="rights-credits"><T text="Crédits souhaités" /></label><textarea id="rights-credits" maxLength={1000} value={project.credits} onChange={(event) => setProjectField("credits", event.target.value)} /></div>
      </section> : null}

      {step === 2 ? <section aria-labelledby="rights-contribution-title"><h2 id="rights-contribution-title"><T text="Contributions déclarées" /></h2><p><T text="Cette déclaration est votre affirmation. Elle ne vaut pas reconnaissance juridique automatique par LNX Beats." /></p>
        <div className="field"><label htmlFor="rights-contribution-kind"><T text="Avez-vous personnellement contribué à l’écriture ou à la composition ? *" /></label><select id="rights-contribution-kind" value={contribution.kind} onChange={(event) => setContribution((current) => ({ ...current, kind: event.target.value }))}>{Object.entries(contributionLabels).map(([value, label]) => <option value={value} key={value}>{t(label)}</option>)}</select></div><div className="field"><label htmlFor="rights-contribution-description"><T text="Expliquez votre contribution *" /></label><textarea id="rights-contribution-description" required maxLength={4000} value={contribution.description} onChange={(event) => setContribution((current) => ({ ...current, description: event.target.value }))} /></div><div className="field-grid"><div className="field"><label htmlFor="rights-claimed-percent"><T text="Pourcentage estimé revendiqué (facultatif)" /></label><input id="rights-claimed-percent" type="number" min="0" max="100" step="1" value={contribution.claimedPercentage} onChange={(event) => setContribution((current) => ({ ...current, claimedPercentage: event.target.value }))} /></div><div className="field"><label htmlFor="rights-evidence"><T text="Justificatifs ou commentaires" /></label><textarea id="rights-evidence" maxLength={4000} value={contribution.evidenceNote} onChange={(event) => setContribution((current) => ({ ...current, evidenceNote: event.target.value }))} /></div></div>
        {partnership ? <div className="rights-form__study"><h3><T text="Étude approfondie" /></h3>{[["lyricsAuthor", "Auteur initial des paroles *"], ["lyricsProvided", "Textes fournis *"], ["lyricRewrites", "Réécritures"], ["melody", "Mélodie fournie"], ["harmony", "Harmonie"], ["structure", "Structure"], ["arrangement", "Arrangement"], ["instrumental", "Instrumental"], ["artisticDirection", "Direction artistique"], ["voice", "Voix / interprétation"], ["mixMaster", "Mix / master"], ["instruments", "Instruments"], ["production", "Production"], ["toolsUsed", "Outils humains et logiciels utilisés *"], ["humanCreativeContribution", "Description de l’apport créatif humain *"], ["relatedWorks", "Œuvres déjà déclarées en lien avec le projet"], ["desiredSplit", "Répartition souhaitée (non contraignante)"]].map(([field, label]) => <div className="field" key={field}><label htmlFor={`rights-${field}`}>{t(label)}</label><textarea id={`rights-${field}`} maxLength={4000} value={String(study[field as keyof typeof study])} onChange={(event) => setStudyField(field, event.target.value)} /></div>)}<div className="field-grid"><div className="field"><label htmlFor="rights-lyrics-percent"><T text="Pourcentage estimé revendiqué sur les paroles" /></label><input id="rights-lyrics-percent" type="number" min="0" max="100" value={study.lyricsClaimedPercentage} onChange={(event) => setStudyField("lyricsClaimedPercentage", event.target.value)} /></div><div className="field"><label htmlFor="rights-composition-percent"><T text="Pourcentage estimé revendiqué sur la composition" /></label><input id="rights-composition-percent" type="number" min="0" max="100" value={study.compositionClaimedPercentage} onChange={(event) => setStudyField("compositionClaimedPercentage", event.target.value)} /></div></div><div className="choice-grid"><label className="choice"><input type="checkbox" checked={study.aiKnown} onChange={(event) => setStudyField("aiKnown", event.target.checked)} /><span><T text="Intervention d’IA connue" /></span></label><label className="choice"><input type="checkbox" checked={study.sacemMember} onChange={(event) => setStudyField("sacemMember", event.target.checked)} /><span><T text="Je suis membre de la SACEM" /></span></label></div><div className="field-grid"><div className="field"><label htmlFor="rights-sacem-id"><T text="Identifiant SACEM (facultatif)" /></label><input id="rights-sacem-id" maxLength={80} value={study.sacemIdentifier} onChange={(event) => setStudyField("sacemIdentifier", event.target.value)} /></div><div className="field"><label htmlFor="rights-other-collective"><T text="Autre société de gestion" /></label><input id="rights-other-collective" maxLength={180} value={study.otherCollective} onChange={(event) => setStudyField("otherCollective", event.target.value)} /></div></div><p className="rights-form__warning"><T text="Aucune contribution IA n’est automatiquement déclarable. Seul un apport créatif humain réel peut être étudié, au cas par cas." /></p></div> : null}
      </section> : null}

      {step === 3 ? <section aria-labelledby="rights-review-title"><h2 id="rights-review-title"><T text="Vérifiez avant d’enregistrer." /></h2><p><T text="Vous pourrez corriger vos coordonnées sur l’écran suivant avant de les confirmer. Le PDF généré sera un projet non actif." /></p><dl className="order-detail__facts"><div><dt><T text="Commande" /></dt><dd>{orderNumber}</dd></div><div><dt><T text="Offre" /></dt><dd>{partnership ? <T text="Partenariat d’exploitation" /> : <T text="Licence de publication" />}</dd></div><div><dt><T text="Montant cible futur" /></dt><dd>{money(price)}</dd></div><div><dt><T text="Création" /></dt><dd><OriginalName>{project.workTitle}</OriginalName></dd></div><div><dt><T text="Partie" /></dt><dd>{partyIsIndividual ? `${party.firstName} ${party.lastName}` : party.companyName}</dd></div><div><dt><T text="Territoire" /></dt><dd>{t(project.territory)}</dd></div><div><dt><T text="Durée" /></dt><dd>{t(project.duration)}</dd></div><div><dt><T text="Plateformes" /></dt><dd>{project.platforms.map((item) => t(platformLabels[item as keyof typeof platformLabels])).join(", ")}</dd></div></dl><div className="rights-form__warning"><strong><T text="Important." /></strong> <T text="Aucune qualité d’auteur, quote-part SACEM, répartition 70/30, licence active ou paiement ne résulte de cette demande." /></div><button className="form-button form-button--primary" type="button" onClick={() => void submit()} disabled={busy}>{busy ? t("ENREGISTREMENT…") : <T text="ENREGISTRER ET VÉRIFIER MES COORDONNÉES" />}</button></section> : null}
      {error ? <p className="form-message form-message--error" role="alert">{<T text={error} />}</p> : null}
      <div className="form-navigation">{step > 0 ? <button className="form-button" type="button" disabled={busy} onClick={() => { setError(""); setStep((current) => current - 1); }}><T text="← Retour" /></button> : <span />}{step < steps.length - 1 ? <button className="form-button form-button--primary" type="button" disabled={busy} onClick={() => { if (validateStep()) setStep((current) => current + 1); }}><T text="Continuer →" /></button> : null}</div>
    </div>
  );
}
