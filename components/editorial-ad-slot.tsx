import "server-only";
import { Container } from "@/components/container";
import { allowsAdSlot, isQaAdsEnvironment, qaAdSlotEnabled, type AdSlot } from "@/lib/ads/policy";
import { QaLabMetrics } from "@/components/qa-lab-metrics";
import styles from "./editorial-ad-slot.module.css";

/** Internal visual placeholder only: no scripts, iframe, storage, link or ad network call. */
export function EditorialAdSlot({ pathname, slot }: { pathname: string; slot: AdSlot }) {
  const enabled = qaAdSlotEnabled(pathname, slot, process.env);
  const metrics = process.env.SEO_QA_LAB_METRICS === "true" && isQaAdsEnvironment(process.env) && allowsAdSlot(pathname, slot);
  if (!enabled && !metrics) return null;
  return <>
    {metrics ? <QaLabMetrics mode={enabled ? "placeholder" : "off"} /> : null}
    {enabled ? <aside className={styles.section} aria-label="Emplacement publicitaire de démonstration" data-ad-slot={slot} data-ad-mode="qa">
    <Container><div className={styles.placeholder}>
      <span className={styles.label}>Publicité · aperçu QA</span>
      <span>Emplacement réservé à la revue visuelle</span>
      <small>Aucune annonce réelle. Aucun suivi publicitaire.</small>
    </div></Container>
  </aside> : null}</>;
}
