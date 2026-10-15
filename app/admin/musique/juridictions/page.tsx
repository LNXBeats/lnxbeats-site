import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireAdmin } from "@/lib/auth/session";
import { prisma } from "@/lib/prisma";
import { requireDigitalEnvironment } from "@/lib/digital/domain";
import { digitalMusicTermsDraft, digitalPrivacyAddendumDraft } from "@/lib/digital/digital-legal";
import {digitalFranceTermsDraft} from "@/lib/digital/france-legal";
import {DIGITAL_FRANCE_LAUNCH_DRAFT_RULE} from "@/lib/digital/france-launch-policy";
import styles from "@/components/digital.module.css";
import admin from "@/components/digital-admin.module.css";
export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Registre pays DCN — lecture seule", robots: { index: false, follow: false } };
const PAGE_SIZE = 30;
export default async function Page({ searchParams }: { searchParams: Promise<{ pays?: string; page?: string }> }) {
  try { requireDigitalEnvironment(); } catch { notFound(); }
  await requireAdmin();
  const query = await searchParams, country = query.pays && /^[A-Z]{2}$/.test(query.pays) ? query.pays : undefined;
  const page = query.page && /^[1-9]\d{0,2}$/.test(query.page) ? Number(query.page) : 1;
  const where = country ? { countryCode: country } : {};
  const [rules, count] = await Promise.all([prisma.digitalCountryTaxRule.findMany({ where, orderBy: [{ countryCode: "asc" }, { subdivisionCode: "asc" }, { version: "desc" }], skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }), prisma.digitalCountryTaxRule.count({ where })]);
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE)), url = (n: number) => `/admin/musique/juridictions?page=${n}${country ? `&pays=${country}` : ""}`;
  return <div className={`admin-main ${admin.workflow}`}><header className="admin-page-heading"><div><p className="admin-kicker">DCN · B2C · lecture seule</p><h1>Pays, fiscalité et contrats.</h1></div><Link className="admin-row-action" href="/admin/musique">Retour à la musique numérique</Link></header>
    <p className={admin.banner}>Lancement retenu : particuliers résidant en France métropolitaine, Corse comprise. Paiements LIVE fermés ; outre-mer et étranger non ouverts. Stripe et PayPal restent les prestataires ; aucune intégration Merchant of Record pour ce lancement.</p>
    <section className={styles.panel}><h2>Préparation France métropolitaine et Corse</h2><p>{DIGITAL_FRANCE_LAUNCH_DRAFT_RULE.status} · {DIGITAL_FRANCE_LAUNCH_DRAFT_RULE.decision} · portée {DIGITAL_FRANCE_LAUNCH_DRAFT_RULE.approvalScope} — plan seulement, non inséré dans le registre.</p><p>FR-MET est un code de marché interne, pas une subdivision ISO officielle. Aucune autorisation générique FR ne remplace ce périmètre. Une déclaration ou un code postal ne suffit pas : une preuve de résidence indépendante, liée au compte et vérifiée côté serveur, demeure nécessaire avant une nouvelle opération.</p><p>Fiscalité, CGV et configuration de lancement restent à valider séparément. Aucun taux, exemption ou accord LIVE n’est présumé et aucun bouton d’approbation n’est disponible ici.</p></section>
    <section className={styles.panel}><h2>Registre versionné</h2><p className={styles.muted}>Une nouvelle version conserve la précédente. Le rôle de l’application peut seulement consulter ces politiques : aucun bouton d’approbation ni activation fiscale ici.</p>
      <form method="get" className={styles.actions}><label htmlFor="countryCode">Pays ISO<input id="countryCode" name="pays" maxLength={2} pattern="[A-Z]{2}" defaultValue={country} placeholder="FR" /></label><button className="admin-row-action" type="submit">Filtrer</button><Link className="admin-row-action" href="/admin/musique/juridictions">Tous les pays</Link></form>
      {rules.map(rule => <article className={styles.panel} key={rule.id}><h3>{rule.countryCode}{rule.subdivisionCode ? ` · ${rule.subdivisionCode}` : ""} — version {rule.version}</h3><p>{rule.customerType} · {rule.decision} · {rule.status} · portée {rule.approvalScope}</p><p>{rule.notes}</p><p>Fiscalité : {rule.fiscalApproved ? "preuve enregistrée" : "non approuvée"} · Contrat : {rule.legalApproved ? "preuve enregistrée" : "non approuvé"} · Paiement : {rule.paymentApproved ? "preuve enregistrée" : "non approuvé"}</p><small>Référence de politique : {rule.id}<br />CGV : {rule.termsVersion ?? "non validées"} · langue : {rule.languageCode ?? "non validée"}<br />Revue : {rule.reviewedAt?.toISOString() ?? "à effectuer"} · expiration : {rule.expiresAt?.toISOString() ?? "à définir après revue"}</small></article>)}
      {!rules.length ? <p>Aucune règle enregistrée pour ce filtre : checkout bloqué.</p> : null}
      <nav className={admin.pagination} aria-label="Pages des politiques pays">{page > 1 ? <Link className="admin-row-action" href={url(page - 1)}>Précédent</Link> : null}<span>Page {page} / {pages} · {count} règle(s)</span>{page < pages ? <Link className="admin-row-action" href={url(page + 1)}>Suivant</Link> : null}</nav>
    </section>
    {[digitalFranceTermsDraft, digitalPrivacyAddendumDraft].map(document => <section className={styles.panel} key={document.version}><h2>{document.title}</h2><p className={styles.note}>{document.status} — jamais activé, jamais assimilé aux CGV historiques approuvées.</p><p><small>{document.version}<br />SHA‑256 : {document.hashSha256}</small></p><details><summary>Lire le document candidat</summary>{document.sections.map(section => <section key={section.title}><h3>{section.title}</h3>{section.paragraphs.map(paragraph => <p key={paragraph}>{paragraph}</p>)}</section>)}</details><details><summary>Validations restantes du nouveau document</summary><ul>{document.reviewRequired.map(code => <li key={code}>{code}</li>)}</ul></details></section>)}
    <details className={styles.panel}><summary>Ancien brouillon QA conservé, non remplacé dans les achats historiques</summary><p>{digitalMusicTermsDraft.version} · SHA‑256 {digitalMusicTermsDraft.hashSha256}</p><p>Les snapshots déjà acceptés conservent leur texte exact. Le nouveau brouillon France doit être validé puis raccordé aux seules nouvelles commandes avant lancement ; sa lecture ne l’active pas.</p></details>
  </div>;
}
