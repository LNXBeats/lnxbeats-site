import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file: string) => readFile(new URL(`../../${file}`, import.meta.url), "utf8");

test("support page is gated, factual and distinct from commercial checkouts", async () => {
  const page = await read("app/soutenir/page.tsx");
  assert.match(page, /if \(!isSupportEnabled\(\)\) notFound\(\)/);
  assert.match(page, /Un soutien libre, sans contrepartie/);
  assert.match(page, /aucun achat ou prestation/);
  assert.match(page, /aucun reçu fiscal ni à aucune réduction d’impôt/);
  assert.doesNotMatch(page, /Charity|tax.deductible|non remboursable|leaderboard|donateur/);
  assert.match(page, /pathname: "\/soutenir"/);
  assert.match(page, /robots: \{ index: false, follow: false \}/);
});

test("support confirmation never treats a redirect as financial proof", async () => {
  const [page, client] = await Promise.all([read("app/soutenir/confirmation/[id]/page.tsx"), read("components/support-confirmation.tsx")]);
  assert.match(page, /index: false, follow: false/);
  assert.match(client, /Le retour sur cette page ne prouve pas un paiement réussi/);
  assert.match(client, /cache: "no-store"/);
  assert.doesNotMatch(client, /setInterval|autoPlay|searchParams.*(?:paid|success)/);
  assert.match(client, /Confirmer mon soutien PayPal/);
  assert.match(client, /n’est ni une facture de vente ni un reçu fiscal/);
});

test("support navigation and sitemap stay conditional; confirmation is never indexed", async () => {
  const sitemap = await read("app/sitemap.ts");
  assert.match(sitemap, /if \(isSupportEnabled\(\)\) entries.push/);
  assert.doesNotMatch(sitemap, /\/confirmation/);
});

test("support Admin views and export require Admin; refund action rechecks origin", async () => {
  for (const file of ["app/admin/soutiens/page.tsx", "app/admin/soutiens/[id]/page.tsx", "app/api/admin/support/export/route.ts", "app/admin/soutiens/actions.ts"]) {
    assert.match(await read(file), /await requireAdmin\(\)/, file);
  }
  const action = await read("app/admin/soutiens/actions.ts");
  assert.match(action, /isSameOriginMutation/);
  assert.match(action, /adminId: session.user.id/);
  const detail = await read("app/admin/soutiens/[id]/page.tsx");
  assert.match(detail, /REMBOURSER \{entry.id\}/);
  const exportRoute = await read("app/api/admin/support/export/route.ts");
  assert.match(exportRoute, /private, no-store/);
  assert.match(exportRoute, /Content-Disposition/);
  assert.match(exportRoute, /replaceAll/);
});
