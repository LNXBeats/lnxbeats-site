import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import ts from "typescript";
import { commanderMessages } from "@/lib/i18n/messages-commander";
import { messages } from "@/lib/i18n/messages";

const form = fs.readFileSync("components/music-order-form.tsx", "utf8");
const dictionary = { ...messages, ...commanderMessages };
const ast = ts.createSourceFile("form.tsx", form, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

test("Commander : cinq traductions complètes et paramètres conservés", () => {
  for (const [source, translations] of Object.entries(commanderMessages)) {
    assert.equal(translations.length, 5, source);
    const tokens = [...source.matchAll(/\{\w+\}/g)].map(m => m[0]).sort();
    for (const value of translations) {
      assert.ok(value.trim(), source);
      assert.deepEqual([...value.matchAll(/\{\w+\}/g)].map(m => m[0]).sort(), tokens, source);
      if (source.includes("LNX Beats")) assert.ok(value.includes("LNX Beats"), source);
    }
  }
});

test("Commander : tous les libellés statiques branchés disposent de traductions", () => {
  const used = new Set<string>();
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ["t", "text"].includes(node.expression.getText(ast)) && node.arguments[0] && ts.isStringLiteral(node.arguments[0])) used.add(node.arguments[0].text);
    if (ts.isJsxAttribute(node) && node.name.getText(ast) === "text" && node.initializer && ts.isStringLiteral(node.initializer)) used.add(node.initializer.text);
    ts.forEachChild(node, visit);
  }
  visit(ast);
  for (const phrase of used) assert.ok(dictionary[phrase], phrase);
  assert.ok(used.size > 130);
});

test("Commander : choix français transmis inchangés, aucun titre saisi ne passe au dictionnaire", () => {
  assert.ok(form.includes('setField("musicalDirection", direction)'));
  assert.ok(form.includes('setIllustrationFormat(option.value)'));
  assert.ok(form.includes('body: JSON.stringify(form)'));
  assert.ok(form.includes('personalUseTermsAccepted: true'));
  assert.ok(form.includes('earlyPerformanceConsentAccepted: true'));
  assert.ok(form.includes('<OriginalName>{form.title}</OriginalName>'));
  for (const value of ["form.title", "form.brief", "form.recipient", "form.emotion", "form.importantDetails", "account.name", "file.name"]) assert.ok(!form.includes(`t(${value})`), value);
});

test("Commander : textes acceptés français originaux distincts de l’aide de lecture", () => {
  assert.ok(form.includes('<span lang="fr" translate="no"><strong>Usage personnel.</strong> {personalUseTerms.text}</span>'));
  assert.ok(form.includes('<span lang="fr" translate="no"><strong>Commencement avant 14 jours.</strong> {earlyPerformanceConsentWording}</span>'));
  assert.ok(form.includes("ContractLanguageNotice"));
  assert.ok(form.includes("Comprendre les confirmations (aide à la lecture)"));
  assert.ok(!form.includes("t(personalUseTerms.text)"));
  assert.ok(!form.includes("t(earlyPerformanceConsentWording)"));
});
