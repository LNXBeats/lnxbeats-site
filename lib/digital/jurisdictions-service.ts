import "server-only";
import type { DigitalCountryTaxRule, Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";
import { requireDigitalEnvironment } from "./domain";
import { assertDigitalJurisdictionDecision, evaluateDigitalJurisdiction, revalidateDigitalJurisdiction,
  type DigitalCountryTaxRuleView, type DigitalJurisdictionInput, type DigitalJurisdictionSnapshot, type DigitalTaxRule } from "./jurisdictions";

export function digitalCountryRuleView(row: DigitalCountryTaxRule): DigitalCountryTaxRuleView {
  return { ...row, status: row.status as DigitalCountryTaxRuleView["status"], decision: row.decision as DigitalCountryTaxRuleView["decision"],
    approvalScope: row.approvalScope as DigitalCountryTaxRuleView["approvalScope"], reviewedAt: row.reviewedAt?.toISOString() ?? null,
    validFrom: row.validFrom?.toISOString() ?? null, expiresAt: row.expiresAt?.toISOString() ?? null, taxRule: row.taxRule as DigitalTaxRule | null };
}
type RuleClient = Pick<Prisma.TransactionClient, "digitalCountryTaxRule">;
export async function loadDigitalCountryTaxRule(countryCode: string, subdivisionCode = "", client: RuleClient = prisma) {
  // No country fallback: a US country row never substitutes for an unreviewed US state.
  const row = await client.digitalCountryTaxRule.findFirst({ where: { countryCode, subdivisionCode, customerType: "B2C" }, orderBy: { version: "desc" } });
  return row ? digitalCountryRuleView(row) : null;
}
export async function assertDigitalCheckoutJurisdiction(input: DigitalJurisdictionInput, client: RuleClient = prisma, ruleOverride?: DigitalCountryTaxRuleView) {
  requireDigitalEnvironment();
  // Overrides are internal injected fixtures; evaluateDigitalJurisdiction still requires TEST + explicit QA capability.
  const rule = ruleOverride ?? await loadDigitalCountryTaxRule(input.countryCode, input.subdivisionCode ?? "", client);
  return assertDigitalJurisdictionDecision(evaluateDigitalJurisdiction(input, rule));
}
export async function revalidateDigitalCheckoutJurisdiction(snapshot: DigitalJurisdictionSnapshot, input: DigitalJurisdictionInput, client: RuleClient = prisma, ruleOverride?: DigitalCountryTaxRuleView) {
  requireDigitalEnvironment();
  const rule = ruleOverride ?? await loadDigitalCountryTaxRule(input.countryCode, input.subdivisionCode ?? "", client);
  return revalidateDigitalJurisdiction(snapshot, input, rule);
}
