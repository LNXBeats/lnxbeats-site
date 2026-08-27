import type { Metadata } from "next";

import { AdminBackLink } from "@/components/admin-back-link";
import { requireAdmin } from "@/lib/auth/session";
import {
  centsToAdminInput,
  formatEuroCents,
  MUSIC_PRICING_ACTIVATION_CONFIRMATION,
} from "@/lib/pricing/domain";
import { getAdminMusicPricingOverview } from "@/lib/pricing/service";

import { PricingActivationForm } from "./pricing-activation-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Tarifs" };

const dateFormatter = new Intl.DateTimeFormat("fr-FR", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Europe/Paris",
});

const feedback: Record<string, { role: "status" | "alert"; message: string }> = {
  "version-activee": {
    role: "status",
    message: "La nouvelle version tarifaire est active pour la fondation V1.1.",
  },
  "aucun-changement": { role: "alert", message: "Aucun tarif n’a changé." },
  "conflit-recharger": {
    role: "alert",
    message: "Une autre version a été activée. Rechargez les tarifs avant de recommencer.",
  },
  "confirmation-requise": {
    role: "alert",
    message: "La confirmation explicite est requise.",
  },
  "origine-refusee": { role: "alert", message: "Cette requête a été refusée." },
  "activation-refusee": {
    role: "alert",
    message: "La nouvelle version n’a pas été activée. Vérifiez les montants.",
  },
};

export default async function AdminPricingPage({
  searchParams,
}: {
  searchParams: Promise<{ etat?: string }>;
}) {
  await requireAdmin();
  const params = await searchParams;
  const overview = await getAdminMusicPricingOverview();
  const notice = params.etat ? feedback[params.etat] : undefined;

  return (
    <div className="admin-main">
      <AdminBackLink href="/admin">Retour à l’Administration</AdminBackLink>
      <header className="admin-page-heading">
        <div>
          <p className="admin-kicker">Configuration financière</p>
          <h1>Tarifs musicaux.</h1>
        </div>
        <div className="admin-page-heading__actions">
          <p>Chaque activation crée une version immuable et conserve l’historique des tarifs.</p>
        </div>
      </header>

      {notice ? <p className="admin-feedback" role={notice.role}>{notice.message}</p> : null}

      {!overview ? (
        <section className="admin-catalogue-notice" aria-labelledby="pricing-unavailable-title">
          <div>
            <p className="admin-section-label">Configuration absente</p>
            <h2 id="pricing-unavailable-title">Activation impossible.</h2>
          </div>
          <p>La version tarifaire initiale doit être installée et vérifiée avant toute activation Admin.</p>
        </section>
      ) : (
        <>
          <section className="admin-catalogue-notice" aria-labelledby="active-pricing-title">
            <div>
              <p className="admin-section-label">Tarifs actuels · révision {overview.configuration.revision}</p>
              <h2 id="active-pricing-title">{overview.configuration.activeVersion.version}</h2>
            </div>
            <dl>
              <div><dt>Création musicale</dt><dd>{formatEuroCents(overview.configuration.activeVersion.basePriceCents)}</dd></div>
              <div><dt>Illustration</dt><dd>{formatEuroCents(overview.configuration.activeVersion.coverPriceCents)}</dd></div>
              <div><dt>Priorité</dt><dd>{formatEuroCents(overview.configuration.activeVersion.priorityPriceCents)}</dd></div>
              <div><dt>Activation</dt><dd>{overview.configuration.activeVersion.activatedAt ? dateFormatter.format(overview.configuration.activeVersion.activatedAt) : "Non documentée"}</dd></div>
            </dl>
          </section>

          <section className="admin-list-window" aria-labelledby="new-pricing-title">
            <div className="admin-list-window__heading">
              <h2 id="new-pricing-title">Préparer une nouvelle version</h2>
              <span>EUR · centimes exacts</span>
            </div>
            <PricingActivationForm
              expectedRevision={overview.configuration.revision}
              confirmationValue={MUSIC_PRICING_ACTIVATION_CONFIRMATION}
              current={{
                basePrice: centsToAdminInput(overview.configuration.activeVersion.basePriceCents),
                coverPrice: centsToAdminInput(overview.configuration.activeVersion.coverPriceCents),
                priorityPrice: centsToAdminInput(overview.configuration.activeVersion.priorityPriceCents),
              }}
            />
            <p>
              <strong>Gate V1.1 :</strong> Commander et les paiements restent sur la tarification legacy tant que le cutover financier dédié n’a pas été validé. Cette page ne modifie aucun snapshot existant.
            </p>
          </section>

          <section className="admin-list-window" aria-labelledby="pricing-history-title">
            <div className="admin-list-window__heading">
              <h2 id="pricing-history-title">Historique immuable</h2>
              <span>{overview.versions.length} version{overview.versions.length === 1 ? "" : "s"}</span>
            </div>
            <ul className="admin-catalogue-list">
              {overview.versions.map((version) => (
                <li key={version.id}>
                  <div>
                    <strong>{version.version}</strong>
                    <small>{version.status === "ACTIVE" ? "Active" : "Retirée"} · {version.source === "IMPORTED" ? "Import V1" : "Administration"}</small>
                  </div>
                  <dl>
                    <div><dt>Création</dt><dd>{formatEuroCents(version.basePriceCents)}</dd></div>
                    <div><dt>Illustration</dt><dd>{formatEuroCents(version.coverPriceCents)}</dd></div>
                    <div><dt>Priorité</dt><dd>{formatEuroCents(version.priorityPriceCents)}</dd></div>
                    <div><dt>Créée</dt><dd>{dateFormatter.format(version.createdAt)}</dd></div>
                  </dl>
                </li>
              ))}
            </ul>
          </section>

          <section className="admin-list-window" aria-labelledby="pricing-audit-title">
            <div className="admin-list-window__heading">
              <h2 id="pricing-audit-title">Journal des activations</h2>
              <span>{overview.activations.length} événement{overview.activations.length === 1 ? "" : "s"}</span>
            </div>
            <ul className="admin-catalogue-list">
              {overview.activations.map((activation) => (
                <li key={activation.id}>
                  <div>
                    <strong>{activation.previousVersion?.version ?? "Initialisation"} → {activation.activatedVersion.version}</strong>
                    <small>Révision {activation.configurationRevision} · {dateFormatter.format(activation.occurredAt)}</small>
                  </div>
                  <p>{activation.actorAdmin?.displayName?.trim() || "Initialisation système"}</p>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
