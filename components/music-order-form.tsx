"use client";

import { useEffect, useRef, useState } from "react";

const genres = [
  "Rap français",
  "Boom bap",
  "Rap moderne",
  "Pop",
  "Soul / R&B",
  "Rock",
  "Électro",
  "Acoustique",
  "Chanson / variété",
  "Cinématographique",
];

const moods = ["Émouvant", "Drôle", "Énergique", "Romantique", "Sombre", "Nostalgique", "Festif", "Motivant"];

type ProjectForm = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  recipient: string;
  occasion: string;
  story: string;
  importantDetails: string;
  wordsToInclude: string;
  avoid: string;
  genre: string;
  letLnxChoose: boolean;
  moods: string[];
  rights: "personal" | "commercial";
  files: string[];
  termsAccepted: boolean;
};

const initialForm: ProjectForm = {
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  recipient: "",
  occasion: "",
  story: "",
  importantDetails: "",
  wordsToInclude: "",
  avoid: "",
  genre: "",
  letLnxChoose: false,
  moods: [],
  rights: "personal",
  files: [],
  termsAccepted: false,
};

const stepLabels = ["Identité", "Projet", "Style & droits", "Récapitulatif"];

export function MusicOrderForm() {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<ProjectForm>(initialForm);
  const stepRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const initialized = useRef(false);

  useEffect(() => {
    if (initialized.current) headingRef.current?.focus();
    initialized.current = true;
  }, [step]);

  function setField<K extends keyof ProjectForm>(field: K, value: ProjectForm[K]) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function validateStep() {
    const fields = stepRef.current?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      "input, textarea, select",
    );
    if (!fields) return true;

    for (const field of fields) {
      if (!field.checkValidity()) {
        field.reportValidity();
        field.focus();
        return false;
      }
    }

    if (step === 2 && !form.letLnxChoose && !form.genre) {
      document.getElementById("genre-choice")?.focus();
      return false;
    }

    return true;
  }

  function nextStep() {
    if (!validateStep()) return;
    setStep((current) => Math.min(current + 1, stepLabels.length - 1));
  }

  function previousStep() {
    setStep((current) => Math.max(current - 1, 0));
  }

  function toggleMood(mood: string) {
    setForm((current) => ({
      ...current,
      moods: current.moods.includes(mood)
        ? current.moods.filter((item) => item !== mood)
        : [...current.moods, mood],
    }));
  }

  return (
    <form className="order-form" onSubmit={(event) => event.preventDefault()} noValidate={false}>
      <div className="order-progress" aria-label="Progression du formulaire">
        {stepLabels.map((label, index) => (
          <div key={label} className={`order-progress__item ${index <= step ? "is-active" : ""}`} aria-current={index === step ? "step" : undefined}>
            {String(index + 1).padStart(2, "0")} <span>· {label}</span>
          </div>
        ))}
      </div>

      <div ref={stepRef} className="form-step" key={step}>
        {step === 0 ? (
          <>
            <p className="eyebrow" aria-live="polite">Étape 1 sur 4</p>
            <h2 ref={headingRef} tabIndex={-1}>Parlez-nous de vous.</h2>
            <p className="form-step__intro">Ces informations serviront au suivi du projet lorsqu’un système de commande sécurisé sera activé.</p>
            <div className="field-grid">
              <div className="field">
                <label htmlFor="first-name">Prénom *</label>
                <input id="first-name" required autoComplete="given-name" value={form.firstName} onChange={(event) => setField("firstName", event.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="last-name">Nom *</label>
                <input id="last-name" required autoComplete="family-name" value={form.lastName} onChange={(event) => setField("lastName", event.target.value)} />
              </div>
            </div>
            <div className="field-grid">
              <div className="field">
                <label htmlFor="email">E-mail *</label>
                <input id="email" type="email" required autoComplete="email" value={form.email} onChange={(event) => setField("email", event.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="phone">Téléphone</label>
                <input id="phone" type="tel" autoComplete="tel" value={form.phone} onChange={(event) => setField("phone", event.target.value)} />
              </div>
            </div>
            <div className="field-grid">
              <div className="field">
                <label htmlFor="recipient">Destinataire de la musique *</label>
                <input id="recipient" required placeholder="Prénom, couple, équipe…" value={form.recipient} onChange={(event) => setField("recipient", event.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="occasion">Occasion</label>
                <input id="occasion" placeholder="Anniversaire, mariage, surprise…" value={form.occasion} onChange={(event) => setField("occasion", event.target.value)} />
              </div>
            </div>
          </>
        ) : null}

        {step === 1 ? (
          <>
            <p className="eyebrow" aria-live="polite">Étape 2 sur 4</p>
            <h2 ref={headingRef} tabIndex={-1}>Racontez votre histoire.</h2>
            <p className="form-step__intro">Donnez les détails qui rendent cette histoire unique. Le brief reste local à votre navigateur dans cette V0.1 et n’est pas envoyé.</p>
            <div className="field">
              <label htmlFor="story">Histoire à raconter *</label>
              <textarea id="story" required minLength={30} placeholder="Le contexte, les personnes, les souvenirs, ce que vous ressentez…" value={form.story} onChange={(event) => setField("story", event.target.value)} />
              <span className="field__hint">Minimum 30 caractères pour préparer un brief exploitable.</span>
            </div>
            <div className="field">
              <label htmlFor="important-details">Informations importantes</label>
              <textarea id="important-details" placeholder="Dates, lieux, anecdotes ou traits de caractère…" value={form.importantDetails} onChange={(event) => setField("importantDetails", event.target.value)} />
            </div>
            <div className="field-grid">
              <div className="field">
                <label htmlFor="words">Mots ou prénoms à intégrer</label>
                <textarea id="words" value={form.wordsToInclude} onChange={(event) => setField("wordsToInclude", event.target.value)} />
              </div>
              <div className="field">
                <label htmlFor="avoid">Éléments à éviter</label>
                <textarea id="avoid" value={form.avoid} onChange={(event) => setField("avoid", event.target.value)} />
              </div>
            </div>
          </>
        ) : null}

        {step === 2 ? (
          <>
            <p className="eyebrow" aria-live="polite">Étape 3 sur 4</p>
            <h2 ref={headingRef} tabIndex={-1}>Donnez le ton.</h2>
            <p className="form-step__intro">Choisissez une direction ou laissez LNX Beats trouver le style qui sert le mieux votre histoire.</p>
            <fieldset className="fieldset" id="genre-choice" tabIndex={-1}>
              <legend>Genre musical *</legend>
              <div className="choice-grid">
                {genres.map((genre) => (
                  <label className="choice" key={genre}>
                    <input
                      type="radio"
                      name="genre"
                      value={genre}
                      checked={form.genre === genre && !form.letLnxChoose}
                      onChange={() => setForm((current) => ({ ...current, genre, letLnxChoose: false }))}
                    />
                    <span>{genre}</span>
                  </label>
                ))}
                <label className="choice choice--full">
                  <input
                    type="checkbox"
                    checked={form.letLnxChoose}
                    onChange={(event) => setForm((current) => ({ ...current, letLnxChoose: event.target.checked, genre: event.target.checked ? "" : current.genre }))}
                  />
                  <span>Je laisse LNX Beats choisir le style qui correspond le mieux à mon histoire</span>
                </label>
              </div>
              {!form.letLnxChoose && !form.genre ? <span className="field__hint">Sélectionnez un style ou confiez ce choix à LNX Beats.</span> : null}
            </fieldset>

            <fieldset className="fieldset">
              <legend>Émotion / ambiance — plusieurs choix possibles</legend>
              <div className="choice-grid">
                {moods.map((mood) => (
                  <label className="choice" key={mood}>
                    <input type="checkbox" checked={form.moods.includes(mood)} onChange={() => toggleMood(mood)} />
                    <span>{mood}</span>
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset className="fieldset">
              <legend>Droits envisagés</legend>
              <div className="choice-grid">
                <label className="choice">
                  <input type="radio" name="rights" checked={form.rights === "personal"} onChange={() => setField("rights", "personal")} />
                  <span>Usage personnel</span>
                </label>
                <label className="choice">
                  <input type="radio" name="rights" checked={form.rights === "commercial"} onChange={() => setField("rights", "commercial")} />
                  <span>Droits commerciaux à discuter</span>
                </label>
              </div>
              <span className="field__hint">Le périmètre juridique et les conditions commerciales définitives seront précisés dans un prochain sprint.</span>
            </fieldset>

            <div className="field">
              <label htmlFor="files">Photos, documents ou références</label>
              <div className="upload-field">
                <div>
                  <input
                    id="files"
                    type="file"
                    multiple
                    accept="image/jpeg,image/png,image/webp,application/pdf,text/plain,audio/mpeg,audio/mp4,audio/wav"
                    onChange={(event) => setField("files", Array.from(event.target.files ?? []).map((file) => file.name))}
                  />
                  <p>Aucun fichier n’est téléversé dans cette V0.1.</p>
                </div>
              </div>
            </div>
          </>
        ) : null}

        {step === 3 ? (
          <>
            <p className="eyebrow" aria-live="polite">Étape 4 sur 4</p>
            <h2 ref={headingRef} tabIndex={-1}>Votre projet, en un regard.</h2>
            <p className="form-step__intro">Vérifiez la structure du brief. Aucune donnée n’est enregistrée ni transmise dans cette version.</p>
            <dl className="summary">
              <div><dt>Client</dt><dd>{form.firstName} {form.lastName}</dd></div>
              <div><dt>Contact</dt><dd>{form.email}{form.phone ? ` · ${form.phone}` : ""}</dd></div>
              <div><dt>Projet</dt><dd>Pour {form.recipient}{form.occasion ? ` · ${form.occasion}` : ""}</dd></div>
              <div><dt>Direction</dt><dd>{form.letLnxChoose ? "Choix confié à LNX Beats" : form.genre}</dd></div>
              <div><dt>Ambiance</dt><dd>{form.moods.length ? form.moods.join(", ") : "À définir avec LNX Beats"}</dd></div>
              <div><dt>Droits</dt><dd>{form.rights === "personal" ? "Usage personnel" : "Usage commercial à cadrer"}</dd></div>
              <div><dt>Fichiers</dt><dd>{form.files.length ? form.files.join(", ") : "Aucun fichier sélectionné"}</dd></div>
            </dl>
            <label className="choice choice--full">
              <input type="checkbox" checked={form.termsAccepted} onChange={(event) => setField("termsAccepted", event.target.checked)} />
              <span>J’ai vérifié ce récapitulatif et je comprends que les conditions définitives devront être acceptées avant une future commande.</span>
            </label>
            <p className="terms-note">Paiement prévu à terme : PayPal ou virement bancaire. Aucun paiement, aucune commande et aucune persistance ne sont actifs dans cette V0.1.</p>
            <div className="form-navigation">
              <button className="form-button" type="button" onClick={previousStep}>← Modifier</button>
              <button className="form-button form-button--primary" type="button" disabled>Passage au paiement — bientôt</button>
            </div>
          </>
        ) : (
          <div className="form-navigation">
            {step > 0 ? <button className="form-button" type="button" onClick={previousStep}>← Retour</button> : <span />}
            <button className="form-button form-button--primary" type="button" onClick={nextStep}>Continuer →</button>
          </div>
        )}
      </div>
    </form>
  );
}
