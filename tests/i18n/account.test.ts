import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import ts from "typescript";

import { accountMessages } from "@/lib/i18n/messages-account";
import { digitalStatusMessages } from "@/lib/i18n/messages-digital-status";
import { messages } from "@/lib/i18n/messages";

const source = (path: string) => fs.readFileSync(path, "utf8");
const previous = (path: string) => execFileSync("git", ["show", `HEAD:${path}`], { encoding: "utf8" });
const auth = ["change-password-form", "email-request-form", "email-verification-result", "login-form", "logout-button", "profile-form", "registration-form", "reset-password-entry", "reset-password-form"].map(name => `components/auth/${name}.tsx`);
const rights = ["contract-acceptance-form", "rights-contact-confirmation", "rights-information-response", "rights-request-close-actions", "rights-withdrawal-form", "rights-request-form", "partnership-preauthorization-revision", "modify-unpaid-order-action"].map(name => `components/${name}.tsx`);
const pages = ["app/compte/page.tsx", "app/compte/commandes/[orderNumber]/page.tsx", "app/compte/achats/[orderNumber]/page.tsx", "app/compte/achats/[orderNumber]/sav/page.tsx", "app/compte/sav/[requestNumber]/page.tsx", "app/compte/droits/[requestNumber]/page.tsx", "app/compte/droits/[requestNumber]/verifier/page.tsx", "app/compte/commandes/[orderNumber]/droits/licence/page.tsx", "app/compte/factures/[invoiceNumber]/page.tsx", "app/compte/avoirs/[creditNoteNumber]/page.tsx", "app/compte/musique/page.tsx"];
const astFor = (text: string) => ts.createSourceFile("account.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const printer = ts.createPrinter({ removeComments: true });

function protectedCalls(text: string) {
  const ast = astFor(text);
  const found: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const name = node.expression.getText(ast);
      if (["fetch", "JSON.stringify", "useState", "requireVerifiedUser", "notFound", "getOrderForActor", "getMemberShopOrder", "getMemberShopReturn", "getInvoiceForMember", "getCreditNoteForMember", "getRightsRequestForActor", "listMemberOrders", "listMemberShopOrders", "listMemberInvoices", "listMemberWithdrawalRequests", "listRightsRequestsForActor", "listRightsRequestsForOrderActor", "listShopReturnsForOrder", "publicationLicenseEligibility", "hasCurrentEarlyPerformanceConsent", "orderCanStillBeEdited", "canResumeShopPaypalCapture", "shopReservationIsActive", "shopOrderPaymentState", "effectiveShopOrderStatus", "library", "requireDigitalEnvironment"].includes(name)
        || name.startsWith("authClient.") || ["router.push", "router.replace"].includes(name)) {
        found.push(printer.printNode(ts.EmitHint.Unspecified, node, ast));
      }
      if (name === "JSON.stringify") return;
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return found;
}

function machineFormFields(text: string) {
  const ast = astFor(text);
  const found: string[] = [];
  function visit(node: ts.Node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(ast);
      const hidden = node.attributes.properties.some(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(ast) === "type" && attribute.initializer && ts.isStringLiteral(attribute.initializer) && attribute.initializer.text === "hidden");
      for (const attribute of node.attributes.properties) {
        if (!ts.isJsxAttribute(attribute)) continue;
        const name = attribute.name.getText(ast);
        if (["action", "method", "name", "required", "min", "max", "minLength", "maxLength"].includes(name) || (name === "value" && (hidden || tag === "option"))) {
          found.push(`${tag}:${printer.printNode(ts.EmitHint.Unspecified, attribute, ast)}`);
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return found;
}

test("Compte : actions serveur et API sensibles inchangées depuis la base de release", () => {
  for (const path of ["app/compte/achats/actions.ts", "app/compte/sav/actions.ts", "app/api/auth/registration/code/route.ts", "app/api/auth/registration/state/route.ts", "app/api/auth/registration/verify/route.ts", "app/api/auth/registration/complete/route.ts", "app/api/auth/verification-email/route.ts", "lib/auth/registration.ts", "lib/auth/input.ts", "lib/orders/checkout.ts", "lib/rights/domain.ts", "lib/shop/order-presentation.ts"]) {
    assert.equal(source(path), previous(path), path);
  }
});

test("Compte : requêtes, payloads, états initiaux et gardes d’accès strictement préservés", () => {
  for (const path of [...auth, ...rights, ...pages]) {
    assert.deepEqual(protectedCalls(source(path)), protectedCalls(previous(path)), path);
  }
});

test("Compte : actions de formulaire, valeurs techniques et limites conservées", () => {
  for (const path of [...auth, ...rights, ...pages]) {
    assert.deepEqual(machineFormFields(source(path)), machineFormFields(previous(path)), path);
  }
});

test("Compte et états numériques : cinq traductions, marques et paramètres exacts", () => {
  assert.ok(Object.keys(accountMessages).length >= 705);
  for (const dictionary of [accountMessages, digitalStatusMessages]) {
    for (const [french, translations] of Object.entries(dictionary)) {
      assert.equal(translations.length, 5, french);
      const placeholders = (french.match(/\{[A-Za-z][A-Za-z0-9_]*\}/g) ?? []).sort();
      for (const translated of translations) {
        assert.ok(translated.trim(), french);
        assert.deepEqual((translated.match(/\{[A-Za-z][A-Za-z0-9_]*\}/g) ?? []).sort(), placeholders, french);
        for (const brand of ["LNX Beats", "LNX Studio", "Stripe", "PayPal", "Apple Pay"]) {
          if (french.includes(brand)) assert.ok(translated.includes(brand), `${french}: ${brand}`);
        }
      }
    }
  }
});

test("Compte : chaque libellé statique branché a ses traductions", () => {
  const dictionary = { ...messages, ...accountMessages };
  const used = new Set<string>();
  for (const path of [...auth, ...rights, ...pages]) {
    const ast = astFor(source(path));
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && node.expression.getText(ast) === "t" && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) used.add(node.arguments[0].text);
      if (ts.isJsxAttribute(node) && node.name.getText(ast) === "text" && node.initializer && ts.isStringLiteral(node.initializer)) used.add(node.initializer.text);
      ts.forEachChild(node, visit);
    }
    visit(ast);
  }
  assert.ok(used.size > 200);
  for (const key of used) assert.ok(Object.hasOwn(dictionary, key), key);
});

test("Compte : consentements français originaux et PDF immuables distincts de la langue d’interface", () => {
  const confirmations = [
    ["components/contract-acceptance-form.tsx", "J’ai affiché et vérifié l’intégralité du document, sa version et ses paramètres.", "J’accepte les Conditions particulières présentées. Je comprends qu’aucun droit ni paiement n’est actif dans cette version."],
    ["components/rights-withdrawal-form.tsx", "Je demande la rétractation de cette licence avant sa prise d’effet et son remboursement total."],
    ["app/compte/achats/[orderNumber]/sav/page.tsx", "Je confirme l’exactitude de cette demande et comprends qu’elle sera examinée avant toute décision."],
    ["app/compte/sav/[requestNumber]/page.tsx", "Je confirme l’annulation de ce dossier."],
  ];
  for (const [path, ...wordings] of confirmations) {
    const text = source(path);
    assert.ok(text.includes("ContractLanguageNotice"), path);
    assert.ok(text.includes('lang="fr" translate="no"'), path);
    for (const wording of wordings) {
      assert.ok(previous(path).includes(wording), wording);
      assert.ok(text.includes(wording), wording);
      assert.ok(!text.includes(`t("${wording}")`), wording);
      assert.ok(!text.includes(`<T text="${wording}"`), wording);
    }
  }
  const invoice = source("app/compte/factures/[invoiceNumber]/page.tsx");
  assert.ok(invoice.includes('{invoice.vatLegalNotice}'));
  assert.ok(invoice.includes('href={`/api/billing/invoices/${encodeURIComponent(invoice.invoiceNumber)}/pdf`}'));
  assert.ok(!invoice.includes("t(invoice.vatLegalNotice)"));
});

test("Compte : titres et données privées ne sont pas traduits ni interprétés comme HTML", () => {
  for (const path of [...auth, ...rights, ...pages]) {
    const text = source(path);
    for (const field of ["order.title", "request.workTitle", "project.workTitle", "workTitle", "item.productTitle", "order.brief", "session.user.name", "expectedName"]) {
      assert.ok(!text.includes(`t(${field})`), `${path}: ${field}`);
      assert.ok(!text.includes(`text={${field}}`), `${path}: ${field}`);
    }
    assert.ok(!text.includes("dangerouslySetInnerHTML"), path);
    assert.ok(!text.includes("text={<T"), path);
    assert.ok(!text.includes("<OriginalName>{<OriginalName>"), path);
  }
  assert.ok(source("components/original-name.tsx").includes('translate="no"'));
  assert.ok(!source("components/site-language.tsx").includes("dangerouslySetInnerHTML"));
});
