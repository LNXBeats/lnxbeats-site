import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import ts from "typescript";
import { messages } from "@/lib/i18n/messages";

const path = "components/creations/creation-media-stage.tsx";
const current = fs.readFileSync(path, "utf8");
function controls(source: string) {
  const ast = ts.createSourceFile("stage.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const bodies: string[] = [];
  function visit(n: ts.Node) {
    if (ts.isCallExpression(n) && ["useEffect", "useCallback", "useMemo"].includes(n.expression.getText(ast))) bodies.push(n.getText(ast));
    if (ts.isJsxAttribute(n) && /^on[A-Z]/.test(n.name.getText(ast))) bodies.push(n.getText(ast));
    if (ts.isFunctionDeclaration(n) && n.name && ["updateAudioPosition", "railKeyboard", "matchesCreationFilter", "selectionFromAction"].includes(n.name.text)) bodies.push(n.getText(ast));
    ts.forEachChild(n, visit);
  }
  visit(ast);
  return bodies;
}
test("Créations : moteur, callbacks, reprise, focus, filtres et lecture inchangés", () => {
  const original = execFileSync("git", ["show", `HEAD:${path}`], { encoding: "utf8" });
  const before = controls(original), after = controls(current);
  assert.ok(before.length >= 30);
  assert.deepEqual(after, before);
});
test("Créations : libellés branchés complets, titres et collaborateurs jamais traduits", () => {
  const ast = ts.createSourceFile("stage.tsx", current, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const keys = new Set<string>();
  function display(n: ts.Node) {
    if (ts.isStringLiteral(n)) keys.add(n.text);
    if (ts.isConditionalExpression(n)) { display(n.whenTrue); display(n.whenFalse); }
  }
  function visit(n: ts.Node) {
    if (ts.isCallExpression(n) && n.expression.getText(ast) === "t" && n.arguments[0]) display(n.arguments[0]);
    if (ts.isJsxAttribute(n) && n.name.getText(ast) === "text" && n.initializer && ts.isStringLiteral(n.initializer)) keys.add(n.initializer.text);
    ts.forEachChild(n, visit);
  }
  visit(ast);
  for (const key of keys) assert.ok(messages[key], key);
  for (const value of ["selected.title", "creation.title", "activeCreation.title", "displayedAudio.title"]) assert.ok(!current.includes(`t(${value})`), value);
  assert.ok(current.includes('<OriginalName>{selected.title}</OriginalName>'));
  assert.ok(current.includes('<OriginalName>{creation.title}</OriginalName>'));
  assert.ok(current.includes('values={{ selected: selected.title, active: activeCreation.title }}'));
  const commander = fs.readFileSync("app/commander/page.tsx", "utf8");
  assert.ok(commander.includes('<h1><T text="Commander une création"/>.</h1>'));
});
